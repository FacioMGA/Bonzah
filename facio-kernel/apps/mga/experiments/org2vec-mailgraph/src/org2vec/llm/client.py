"""Single LLM provider abstraction.

Order of preference:

1. Azure OpenAI (if ``AZURE_OPENAI_API_KEY`` is set)
2. OpenAI (if ``OPENAI_API_KEY`` is set)
3. Offline replay (if ``ORG2VEC_OFFLINE=1`` or the above are absent)

Every chat completion and embedding call is hashed by input and persisted under
``artifacts/llm-cache/``. Re-running the same call is free and deterministic,
which is what makes the three-mode eval reproducible.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv()

CACHE_DIR = Path(__file__).resolve().parents[3] / "artifacts" / "llm-cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class LLMConfig:
    provider: str  # "azure" | "openai" | "offline"
    chat_model: str
    embed_model: str
    temperature: float = 0.0
    seed: int = 20260528


def _config() -> LLMConfig:
    offline = os.getenv("ORG2VEC_OFFLINE", "0") == "1"
    azure_key = os.getenv("AZURE_OPENAI_API_KEY", "").strip()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()

    temperature = float(os.getenv("ORG2VEC_TEMPERATURE", "0.0"))
    seed = int(os.getenv("ORG2VEC_SEED", "20260528"))

    if offline or (not azure_key and not openai_key):
        return LLMConfig("offline", "offline-cache", "offline-cache", temperature, seed)
    if azure_key:
        return LLMConfig(
            "azure",
            os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT", "gpt-4o-mini"),
            os.getenv("AZURE_OPENAI_EMBED_DEPLOYMENT", "text-embedding-3-small"),
            temperature,
            seed,
        )
    return LLMConfig(
        "openai",
        os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini"),
        os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small"),
        temperature,
        seed,
    )


# Lazy clients: we don't import openai unless we actually need to call it.
_openai_client = None
_azure_client = None


def _get_openai_client():
    global _openai_client
    if _openai_client is None:
        from openai import OpenAI

        _openai_client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _openai_client


def _get_azure_client():
    global _azure_client
    if _azure_client is None:
        from openai import AzureOpenAI

        _azure_client = AzureOpenAI(
            api_key=os.environ["AZURE_OPENAI_API_KEY"],
            api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2024-08-01-preview"),
            azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
        )
    return _azure_client


def _cache_key(kind: str, payload: dict[str, Any]) -> Path:
    blob = json.dumps(payload, sort_keys=True, default=str).encode()
    digest = hashlib.sha256(blob).hexdigest()[:24]
    return CACHE_DIR / f"{kind}-{digest}.json"


def _read_cache(path: Path) -> Any | None:
    if not path.exists():
        return None
    return json.loads(path.read_text())


def _write_cache(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, default=str))


# ---------------------------------------------------------------------------
# Chat: JSON-mode by default. We never accept free-form strings as contracts.
# ---------------------------------------------------------------------------


def chat_json(
    *,
    system: str,
    user: str,
    schema_hint: str = "",
    tag: str = "chat",
) -> dict[str, Any]:
    """Return a JSON object from the chat model.

    The cache key includes the model name, system, user, schema hint and the
    config seed/temperature so any change invalidates only what it should.
    """
    cfg = _config()
    payload = {
        "kind": "chat",
        "provider": cfg.provider,
        "model": cfg.chat_model,
        "system": system,
        "user": user,
        "schema_hint": schema_hint,
        "temperature": cfg.temperature,
        "seed": cfg.seed,
        "tag": tag,
    }
    path = _cache_key("chat", payload)
    cached = _read_cache(path)
    if cached is not None:
        return cached  # type: ignore[no-any-return]

    if cfg.provider == "offline":
        raise RuntimeError(
            "ORG2VEC_OFFLINE=1 or no LLM credentials configured, and no cached "
            f"response for {tag!r}. Run once with credentials to populate the cache."
        )

    client = _get_azure_client() if cfg.provider == "azure" else _get_openai_client()
    full_user = user if not schema_hint else f"{user}\n\nReturn JSON only matching:\n{schema_hint}"
    resp = client.chat.completions.create(
        model=cfg.chat_model,
        temperature=cfg.temperature,
        seed=cfg.seed,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": full_user},
        ],
    )
    content = resp.choices[0].message.content or "{}"
    try:
        out = json.loads(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"LLM returned non-JSON for tag={tag!r}: {content[:200]!r}") from exc
    _write_cache(path, out)
    return out


# ---------------------------------------------------------------------------
# Embeddings: cached per-text.
# ---------------------------------------------------------------------------


OFFLINE_EMBED_DIM = 256


def _offline_embed(text: str, dim: int = OFFLINE_EMBED_DIM) -> list[float]:
    """Deterministic pseudo-embedding for offline mode.

    Hashes 3-grams into a fixed-dim vector. Not semantically rich, but
    consistent — same input → same vector, different inputs → distinguishable
    vectors. Lets the FAISS store and the eval harness work end-to-end without
    a network call, while still being clearly inferior to real embeddings in
    eval results.
    """
    import hashlib

    vec = [0.0] * dim
    tokens = text.lower().split()
    grams: list[str] = list(tokens)
    for i in range(len(tokens) - 1):
        grams.append(tokens[i] + " " + tokens[i + 1])
    for g in grams:
        h = int.from_bytes(hashlib.sha1(g.encode()).digest()[:4], "big")
        vec[h % dim] += 1.0
    # L2 normalize
    norm = sum(v * v for v in vec) ** 0.5 or 1.0
    return [v / norm for v in vec]


def embed(texts: list[str], *, tag: str = "embed") -> list[list[float]]:
    cfg = _config()
    out: list[list[float] | None] = [None] * len(texts)
    misses: list[int] = []
    miss_payloads: list[dict[str, Any]] = []

    for i, text in enumerate(texts):
        payload = {
            "kind": "embed",
            "provider": cfg.provider,
            "model": cfg.embed_model,
            "text": text,
        }
        path = _cache_key("embed", payload)
        cached = _read_cache(path)
        if cached is not None:
            out[i] = cached
        else:
            misses.append(i)
            miss_payloads.append(payload)

    if misses:
        if cfg.provider == "offline":
            # Deterministic offline fallback: lets the pipeline complete without
            # a network call. Vectors are written to the cache so first online
            # run replaces them transparently.
            for offset, idx in enumerate(misses):
                vec = _offline_embed(texts[idx])
                out[idx] = vec
                path = _cache_key("embed", miss_payloads[offset])
                _write_cache(path, vec)
        else:
            client = _get_azure_client() if cfg.provider == "azure" else _get_openai_client()
            miss_texts = [texts[i] for i in misses]
            resp = client.embeddings.create(model=cfg.embed_model, input=miss_texts)
            for offset, idx in enumerate(misses):
                vec = resp.data[offset].embedding
                out[idx] = vec
                path = _cache_key("embed", miss_payloads[offset])
                _write_cache(path, vec)

    return [v for v in out if v is not None]  # type: ignore[misc]


def provider_label() -> str:
    return _config().provider

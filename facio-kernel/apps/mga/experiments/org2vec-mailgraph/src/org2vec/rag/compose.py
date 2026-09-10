"""RAG composer.

Builds an evidence pack from a hybrid retriever, calls the LLM in JSON-only
mode against a versioned prompt, validates the result against the Pydantic
spine, then runs ``rag/verify.py`` to reject any unsupported citation.

Three modes are exposed so the eval harness can call all three through one
function with one knob:

- ``"chatgpt_only"`` — no retrieval, no evidence pack.
- ``"manual_rag"``  — retrieval over rules only.
- ``"mailgraph"``   — retrieval over emails + rules + graph hops.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import ValidationError

from org2vec.llm.client import chat_json
from org2vec.models import EvidenceItem, EvidencePack, ThreadAnalysis
from org2vec.rag.verify import filter_unsupported_citations
from org2vec.retrieve.hybrid import HybridRetriever

PROMPT_DIR = Path(__file__).resolve().parent / "prompts"


Mode = Literal["chatgpt_only", "manual_rag", "mailgraph"]


SCHEMA_HINT = """{
  "thread_id": string,
  "claim_refs": [string, ...],
  "timeline": [],
  "missing_information": [
    {
      "document": string,
      "requested_at": "YYYY-MM-DD" | null,
      "received": boolean,
      "rationale": string,
      "citation": { "kind": "email"|"rule", "thread_id"?: string, "message_id"?: string, "doc_id"?: string, "chunk_id"?: string, "quote": string }
    }
  ],
  "authority_flags": [
    {
      "kind": "estimate_exceeds_authority" | "settlement_exceeds_authority" | "complaint_received" | "bi_potential" | "fraud_indicator" | "tp_recovery_required" | "endorsement_condition_unmet",
      "rationale": string,
      "threshold": number | null,
      "observed": number | null,
      "endorsement_code": string | null,
      "citation": { ... }
    }
  ],
  "liability_positions": [
    { "posture": "accepted"|"denied"|"reserved"|"split"|"unknown", "rationale": string, "citation": { ... } }
  ],
  "recommended_next_actions": [
    { "action": string, "priority": "low"|"medium"|"high", "rationale": string, "citation": { ... } }
  ]
}
"""


def _format_evidence(pack: EvidencePack) -> str:
    out: list[str] = []
    for it in pack.items:
        if it.kind == "email":
            out.append(
                f"[email] thread_id={it.parent_id} message_id={it.id}\n{it.text[:1200]}\n"
            )
        else:
            out.append(
                f"[rule]  doc_id={it.parent_id} chunk_id={it.id} ({it.source_label})\n{it.text[:1200]}\n"
            )
    return "\n---\n".join(out)


def _load(template: str) -> str:
    return (PROMPT_DIR / template).read_text()


def answer(
    *,
    mode: Mode,
    question: str,
    claim_id: str,
    thread_id: str | None = None,
    retriever: HybridRetriever | None = None,
) -> ThreadAnalysis:
    """Run a single RAG answer in the requested mode.

    Always returns a validated ``ThreadAnalysis`` with citation-pruned content
    (unsupported citations are dropped, not patched).
    """
    if mode == "chatgpt_only":
        pack = EvidencePack(question=question, items=[])
    elif mode == "manual_rag":
        assert retriever is not None
        pack = retriever.retrieve(question, kinds=("rule",), claim_id=claim_id, thread_id=thread_id)
    elif mode == "mailgraph":
        assert retriever is not None
        pack = retriever.retrieve(
            question, kinds=("email", "rule"), claim_id=claim_id, thread_id=thread_id
        )
    else:  # pragma: no cover
        raise ValueError(f"unknown mode {mode!r}")

    system = _load("system.md")
    user = _load("answer.md").format(
        question=question,
        claim_id=claim_id,
        evidence=_format_evidence(pack) or "(no evidence provided)",
        schema=SCHEMA_HINT,
    )

    raw = chat_json(system=system, user=user, schema_hint=SCHEMA_HINT, tag=f"rag:{mode}:{claim_id}")
    raw.setdefault("thread_id", thread_id or claim_id)
    raw.setdefault("claim_refs", [claim_id])
    raw.setdefault("timeline", [])
    raw.setdefault("liability_positions", [])
    raw.setdefault("missing_information", [])
    raw.setdefault("authority_flags", [])
    raw.setdefault("recommended_next_actions", [])
    raw.setdefault("entities", [])

    try:
        analysis = ThreadAnalysis.model_validate(raw)
    except ValidationError as exc:
        debug = Path("artifacts/llm-cache") / f"INVALID-rag-{mode}-{claim_id}.json"
        debug.parent.mkdir(parents=True, exist_ok=True)
        debug.write_text(json.dumps(raw, indent=2, default=str))
        raise RuntimeError(
            f"Invalid LLM JSON for mode={mode!r} claim={claim_id!r}; see {debug}"
        ) from exc

    return filter_unsupported_citations(analysis, pack)


__all__ = ["Mode", "answer"]

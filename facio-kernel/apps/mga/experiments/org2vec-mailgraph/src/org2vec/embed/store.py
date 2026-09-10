"""FAISS-backed vector store with a jsonl metadata sidecar.

A single store holds two kinds of items:

- ``email`` — one row per email message in any ingested thread.
- ``rule`` — one row per KB chunk under ``corpus/kb/``.

The sidecar carries ``(kind, id, parent_id, text, source_label)`` per row.
Adding new items is incremental — re-indexing the whole corpus is not required.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

import faiss
import numpy as np

from org2vec.llm.client import embed

INDEX_DIR = Path(__file__).resolve().parents[3] / "artifacts" / "index"
INDEX_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class StoreItem:
    kind: str  # "email" | "rule"
    id: str
    parent_id: str
    text: str
    source_label: str


class VectorStore:
    """Tiny FAISS wrapper. The cache + jsonl-sidecar make this all-on-disk."""

    def __init__(self, name: str = "main"):
        self.name = name
        self.index_path = INDEX_DIR / f"{name}.faiss"
        self.meta_path = INDEX_DIR / f"{name}.meta.jsonl"
        self._index: faiss.IndexFlatIP | None = None
        self._items: list[StoreItem] = []
        self._dim: int | None = None
        if self.index_path.exists() and self.meta_path.exists():
            self._load()

    # ------------------------------------------------------------------ I/O
    def _load(self) -> None:
        self._index = faiss.read_index(str(self.index_path))
        self._dim = self._index.d
        with self.meta_path.open() as f:
            self._items = [StoreItem(**json.loads(line)) for line in f if line.strip()]

    def _save(self) -> None:
        assert self._index is not None
        faiss.write_index(self._index, str(self.index_path))
        with self.meta_path.open("w") as f:
            for it in self._items:
                f.write(json.dumps(asdict(it)) + "\n")

    # ------------------------------------------------------------------ build
    def add(self, items: list[StoreItem]) -> None:
        if not items:
            return
        # De-dup by (kind, id) so re-ingestion is idempotent.
        existing = {(it.kind, it.id) for it in self._items}
        fresh = [it for it in items if (it.kind, it.id) not in existing]
        if not fresh:
            return
        vecs = np.array(embed([it.text for it in fresh], tag=f"store:{self.name}")).astype("float32")
        # cosine similarity via L2-normalized inner product.
        norms = np.linalg.norm(vecs, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        vecs = vecs / norms
        if self._index is None:
            self._dim = vecs.shape[1]
            self._index = faiss.IndexFlatIP(self._dim)
        self._index.add(vecs)  # type: ignore[arg-type]
        self._items.extend(fresh)
        self._save()

    # ------------------------------------------------------------------ search
    def search(self, query: str, *, kind: str | None = None, k: int = 10) -> list[tuple[StoreItem, float]]:
        if not self._items or self._index is None:
            return []
        qv = np.array(embed([query], tag="store:query")).astype("float32")
        qv /= np.linalg.norm(qv, axis=1, keepdims=True) + 1e-9
        # Over-fetch so we can apply kind filter post-hoc.
        scores, idxs = self._index.search(qv, k * 4 if kind else k)
        out: list[tuple[StoreItem, float]] = []
        for j, score in zip(idxs[0], scores[0]):
            if j < 0 or j >= len(self._items):
                continue
            it = self._items[j]
            if kind and it.kind != kind:
                continue
            out.append((it, float(score)))
            if len(out) >= k:
                break
        return out

    @property
    def items(self) -> list[StoreItem]:
        return list(self._items)


# ---------------------------------------------------------------------------
# Convenience builders.
# ---------------------------------------------------------------------------


def build_from_threads(threads, store: VectorStore | None = None) -> VectorStore:
    """Add every message of every thread as an email-kind item."""
    store = store or VectorStore()
    items: list[StoreItem] = []
    for t in threads:
        for m in t.messages:
            label = f"{t.thread_id}/{m.message_id} — {m.subject}"
            items.append(
                StoreItem(
                    kind="email",
                    id=m.message_id,
                    parent_id=t.thread_id,
                    text=f"Subject: {m.subject}\nFrom: {m.sender}\n\n{m.body}",
                    source_label=label,
                )
            )
    store.add(items)
    return store


def build_from_kb(kb_dir: Path, store: VectorStore | None = None) -> VectorStore:
    """Add every md chunk under ``corpus/kb/`` as a rule-kind item.

    A chunk file looks like::

        ---
        doc_id: ...
        chunk_id: ...
        title: ...
        source: ...
        ---

        body...
    """
    store = store or VectorStore()
    items: list[StoreItem] = []
    for path in sorted(kb_dir.glob("*.md")):
        text = path.read_text()
        meta: dict[str, str] = {}
        body = text
        if text.startswith("---"):
            end = text.find("---", 3)
            if end != -1:
                for line in text[3:end].splitlines():
                    if ":" in line:
                        k, _, v = line.partition(":")
                        meta[k.strip()] = v.strip()
                body = text[end + 3 :].strip()
        items.append(
            StoreItem(
                kind="rule",
                id=meta.get("chunk_id", path.stem),
                parent_id=meta.get("doc_id", path.parent.name),
                text=body,
                source_label=meta.get("source", path.name),
            )
        )
    store.add(items)
    return store

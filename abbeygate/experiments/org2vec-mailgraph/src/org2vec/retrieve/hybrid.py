"""Hybrid retriever: dense + BM25 + (optionally) graph hops, fused by RRF.

Reciprocal Rank Fusion (RRF) is the boring, brilliant choice: each retriever
votes a ranked list; the fused score for an item is the sum over retrievers
of ``1 / (k + rank)``. It needs no training, handles missing retrievers, and
beats any single retriever on this kind of corpus (entity-heavy, short).

The retriever returns an ``EvidencePack`` — the same shape the RAG composer
and citation verifier consume.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from rank_bm25 import BM25Okapi

from org2vec.embed.store import StoreItem, VectorStore
from org2vec.models import EvidenceItem, EvidencePack


def _tokenize(text: str) -> list[str]:
    return [w for w in (text.lower().split()) if w]


@dataclass
class RetrievalConfig:
    k_dense: int = 12
    k_bm25: int = 12
    k_final: int = 12
    rrf_k: int = 60  # standard RRF smoothing constant


class HybridRetriever:
    def __init__(self, store: VectorStore, *, graph=None, config: RetrievalConfig | None = None):
        self.store = store
        self.graph = graph
        self.config = config or RetrievalConfig()
        self._bm25_index: BM25Okapi | None = None
        self._bm25_items: list[StoreItem] = []
        self._rebuild_bm25()

    def _rebuild_bm25(self) -> None:
        self._bm25_items = self.store.items
        if not self._bm25_items:
            self._bm25_index = None
            return
        self._bm25_index = BM25Okapi([_tokenize(it.text) for it in self._bm25_items])

    # ---------------------------------------------------------------- search
    def retrieve(
        self,
        question: str,
        *,
        kinds: Iterable[str] = ("email", "rule"),
        thread_id: str | None = None,
        claim_id: str | None = None,
    ) -> EvidencePack:
        kinds_set = set(kinds)
        ranked: dict[tuple[str, str], dict] = {}

        # Dense — over-fetch then filter.
        for kind in kinds_set:
            for rank, (it, score) in enumerate(
                self.store.search(question, kind=kind, k=self.config.k_dense)
            ):
                key = (it.kind, it.id)
                slot = ranked.setdefault(key, {"item": it, "dense": None, "bm25": None, "graph": None})
                slot["dense"] = rank
                slot["dense_score"] = score

        # BM25
        if self._bm25_index is not None:
            scores = self._bm25_index.get_scores(_tokenize(question))
            scored = sorted(
                ((self._bm25_items[i], s, i) for i, s in enumerate(scores) if s > 0),
                key=lambda x: x[1],
                reverse=True,
            )
            rank = 0
            for it, s, _ in scored:
                if it.kind not in kinds_set:
                    continue
                key = (it.kind, it.id)
                slot = ranked.setdefault(key, {"item": it, "dense": None, "bm25": None, "graph": None})
                slot["bm25"] = rank
                slot["bm25_score"] = s
                rank += 1
                if rank >= self.config.k_bm25:
                    break

        # Graph hops — boost messages that share a claim_id-neighbour with the
        # currently-open claim (added in v0.2 via graph/query.py).
        if self.graph is not None and (claim_id or thread_id):
            try:
                from org2vec.graph.query import related_messages

                related = related_messages(self.graph, claim_id=claim_id, thread_id=thread_id, limit=12)
                for rank, (kind, _id) in enumerate(related):
                    key = (kind, _id)
                    if key in ranked:
                        ranked[key]["graph"] = rank
                    else:
                        item = next(
                            (it for it in self.store.items if it.kind == kind and it.id == _id),
                            None,
                        )
                        if item is None:
                            continue
                        ranked[key] = {
                            "item": item,
                            "dense": None,
                            "bm25": None,
                            "graph": rank,
                        }
            except Exception:  # noqa: BLE001
                pass

        # RRF fusion.
        rrf_k = self.config.rrf_k
        fused: list[tuple[float, StoreItem, dict]] = []
        for slot in ranked.values():
            score = 0.0
            for key in ("dense", "bm25", "graph"):
                r = slot.get(key)
                if r is not None:
                    score += 1.0 / (rrf_k + r)
            fused.append((score, slot["item"], slot))
        fused.sort(key=lambda x: x[0], reverse=True)
        top = fused[: self.config.k_final]

        # If a thread is in focus, ensure all its messages are in the pack
        # regardless of retrieval — the LLM must see the full claim.
        if thread_id is not None:
            in_pack = {(s.kind, s.id) for _, s, _ in top}
            for it in self.store.items:
                if it.kind == "email" and it.parent_id == thread_id and (it.kind, it.id) not in in_pack:
                    top.append((0.0, it, {"item": it}))

        items: list[EvidenceItem] = []
        for score, item, _ in top:
            items.append(
                EvidenceItem(
                    kind=item.kind,  # type: ignore[arg-type]
                    id=item.id,
                    parent_id=item.parent_id,
                    text=item.text,
                    score=score,
                    source_label=item.source_label,
                )
            )
        return EvidencePack(question=question, items=items)

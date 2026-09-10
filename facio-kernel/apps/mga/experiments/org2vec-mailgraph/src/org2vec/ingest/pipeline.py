"""End-to-end ingestion pipeline.

A single async-like generator that streams progress events to the UI:

    pulling      -> Parse  -> Extract  -> Embed  -> Aggregate  -> Graph  -> done

Each yielded event is also appended to ``artifacts/ingest-log.jsonl`` for the
assignment appendix. Re-runs are idempotent: the LLM cache and the vector
store both de-dupe by (kind, id).
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Literal

import networkx as nx

from org2vec.embed.store import VectorStore, build_from_kb, build_from_threads
from org2vec.extract.entities import extract_entities
from org2vec.extract.events import analyze_thread
from org2vec.graph.build import build as build_graph
from org2vec.graph.query import similar_claims
from org2vec.memory.build import aggregate
from org2vec.models import ClaimMemoryObject, Filter, SimilarClaim, Thread, ThreadAnalysis

LOG_PATH = Path(__file__).resolve().parents[3] / "artifacts" / "ingest-log.jsonl"
KB_DIR = Path(__file__).resolve().parents[3] / "corpus" / "kb"


Source = Literal["microsoft", "google", "sample", "upload"]


@dataclass
class ProgressEvent:
    stage: str
    message: str
    progress: float  # 0..1
    extra: dict | None = None

    def as_log(self) -> dict:
        return {
            "ts": time.time(),
            "stage": self.stage,
            "message": self.message,
            "progress": self.progress,
            "extra": self.extra or {},
        }


@dataclass
class IngestResult:
    threads: list[Thread]
    analyses: list[ThreadAnalysis]
    memory: list[ClaimMemoryObject]
    store: VectorStore
    graph: nx.DiGraph

    @property
    def by_claim(self) -> dict[str, ClaimMemoryObject]:
        return {c.claim_id: c for c in self.memory}


def _log(ev: ProgressEvent) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a") as f:
        f.write(json.dumps(ev.as_log(), default=str) + "\n")


def run(
    *,
    source: Source,
    filter: Filter | None = None,
    threads_override: list[Thread] | None = None,
    uploads: list | None = None,
) -> Iterator[ProgressEvent | IngestResult]:
    """Run the pipeline, streaming ``ProgressEvent``s and ending with ``IngestResult``.

    ``threads_override`` is the test-only path (skip the connector entirely).
    ``uploads`` is the input for ``source='upload'`` — a list of
    ``UploadedFile`` / Path / ``(name, bytes)`` items.
    """

    def emit(stage: str, msg: str, p: float, **extra) -> ProgressEvent:
        ev = ProgressEvent(stage=stage, message=msg, progress=p, extra=extra or None)
        _log(ev)
        return ev

    # -------- 1. Pull threads from the chosen connector.
    yield emit("connect", f"Connecting via {source}...", 0.02)
    if threads_override is not None:
        threads = threads_override
    elif source == "sample":
        from org2vec.connect.sample import pull_threads as sample_pull

        threads = sample_pull(filter)
    elif source == "upload":
        from org2vec.connect.upload import pull_threads as upload_pull

        if not uploads:
            raise RuntimeError("source='upload' requires uploads=[...] (.eml or .txt).")
        threads = upload_pull(uploads, filter=filter)
    elif source == "microsoft":
        from org2vec.connect.microsoft import get_token_silent
        from org2vec.connect.microsoft import pull_threads as ms_pull

        token = get_token_silent()
        if not token:
            raise RuntimeError("No Microsoft 365 access token; complete login first.")
        threads = ms_pull(token, filter or Filter())
    elif source == "google":
        from org2vec.connect.google import get_creds_silent
        from org2vec.connect.google import pull_threads as g_pull

        creds = get_creds_silent()
        if not creds:
            raise RuntimeError("No Google credentials; complete login first.")
        threads = g_pull(creds, filter or Filter())
    else:  # pragma: no cover
        raise ValueError(f"unknown source {source!r}")
    yield emit("pulled", f"Pulled {len(threads)} threads from {source}", 0.15, count=len(threads))

    # -------- 2. Parse / classify (parse already done by connectors).
    total_msgs = sum(len(t.messages) for t in threads)
    yield emit("parse", f"Parsed {total_msgs} messages across {len(threads)} threads", 0.25, messages=total_msgs)

    # -------- 3. Extract per-thread analyses (the LLM step).
    analyses: list[ThreadAnalysis] = []
    for i, t in enumerate(threads):
        try:
            analyses.append(analyze_thread(t))
        except Exception as exc:  # noqa: BLE001
            yield emit(
                "extract_warn",
                f"Extraction failed for {t.thread_id}: {exc}. Continuing with entities only.",
                0.25 + 0.4 * (i + 1) / max(1, len(threads)),
                thread_id=t.thread_id,
                error=str(exc),
            )
            analyses.append(
                ThreadAnalysis(
                    thread_id=t.thread_id,
                    claim_refs=t.claim_refs,
                    entities=extract_entities(t),
                )
            )
        yield emit(
            "extract",
            f"Extracted events for {t.thread_id} ({i + 1}/{len(threads)})",
            0.25 + 0.4 * (i + 1) / max(1, len(threads)),
            thread_id=t.thread_id,
        )

    # -------- 4. Embed messages + KB.
    store = build_from_threads(threads)
    if KB_DIR.exists():
        store = build_from_kb(KB_DIR, store=store)
    yield emit("embed", f"Indexed {len(store.items)} items into FAISS", 0.75, items=len(store.items))

    # -------- 5. Aggregate per-claim CMOs.
    memory = aggregate(threads, analyses)
    yield emit("aggregate", f"Aggregated into {len(memory)} Claim Memory Objects", 0.85, claims=len(memory))

    # -------- 6. Build the graph + populate similar_claims.
    graph = build_graph(memory)
    similar_by_claim: dict[str, list[SimilarClaim]] = {}
    for cmo in memory:
        similar_by_claim[cmo.claim_id] = similar_claims(graph, cmo.claim_id, k=3)
    # Re-aggregate so each CMO carries its similar_claims attached.
    memory = aggregate(threads, analyses, similar_by_claim=similar_by_claim)
    graph = build_graph(memory)  # idempotent re-build with similar attached
    yield emit("graph", f"Built graph: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges", 0.95, nodes=graph.number_of_nodes(), edges=graph.number_of_edges())

    yield emit("done", "Ingestion complete", 1.0, claims=len(memory))
    yield IngestResult(threads=threads, analyses=analyses, memory=memory, store=store, graph=graph)


def run_to_completion(**kwargs) -> IngestResult:
    """Convenience wrapper for tests and eval: returns the final IngestResult."""
    last: IngestResult | None = None
    for ev in run(**kwargs):
        if isinstance(ev, IngestResult):
            last = ev
    assert last is not None, "pipeline did not produce an IngestResult"
    return last

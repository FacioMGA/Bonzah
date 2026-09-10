"""Three-mode evaluation runner.

Runs the same question across the same 15-thread corpus in three modes:

- A — ChatGPT only      (no evidence)
- B — Manual RAG        (rules only)
- C — MailGraph RAG     (emails + rules + graph hops)

Output:

    artifacts/results.csv   per-(mode, claim) rows
    artifacts/results.md    rubric-grade summary table
    artifacts/results.png   bar chart for the appendix

Run:

    python -m org2vec.eval.runner

Idempotent: LLM responses are cached on disk, so re-runs are free.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from org2vec.eval.gold import load as load_gold
from org2vec.eval.score import aggregate_scores, score_one
from org2vec.eval.report import write_reports
from org2vec.graph.query import similar_claims
from org2vec.ingest.pipeline import run_to_completion
from org2vec.models import EvidencePack
from org2vec.rag.compose import answer
from org2vec.retrieve.hybrid import HybridRetriever

QUESTION = (
    "Review this submitted claim file. What information gaps remain, what "
    "parts of the claim may be rejected or reserved, and what should the "
    "handler do next?"
)

MODES = ["chatgpt_only", "manual_rag", "mailgraph"]


def main() -> int:
    print("== org2vec MailGraph — three-mode eval ==")
    t0 = time.time()

    # 1. Ingest the sample corpus end-to-end.
    print("  ingesting sample corpus ...")
    result = run_to_completion(source="sample")
    print(f"  threads={len(result.threads)} claims={len(result.memory)}")

    # 2. Load gold labels.
    gold = load_gold()
    print(f"  loaded {len(gold)} gold files")

    # 3. Build the retriever once.
    retriever = HybridRetriever(result.store, graph=result.graph)

    # 4. Run each mode against each claim that has gold.
    per_row: list[dict] = []
    skipped_no_gold: list[str] = []

    for cmo in result.memory:
        thread_id = cmo.threads[0].thread_id if cmo.threads else cmo.claim_id
        g = gold.get(thread_id)
        if g is None:
            skipped_no_gold.append(cmo.claim_id)
            continue

        for mode in MODES:
            try:
                if mode == "chatgpt_only":
                    pack = EvidencePack(question=QUESTION, items=[])
                elif mode == "manual_rag":
                    pack = retriever.retrieve(
                        QUESTION, kinds=("rule",), claim_id=cmo.claim_id, thread_id=thread_id
                    )
                else:
                    pack = retriever.retrieve(
                        QUESTION,
                        kinds=("email", "rule"),
                        claim_id=cmo.claim_id,
                        thread_id=thread_id,
                    )

                pred = answer(
                    mode=mode,
                    question=QUESTION,
                    claim_id=cmo.claim_id,
                    thread_id=thread_id,
                    retriever=retriever,
                )

                # Similar-claim retrieval only counts for MailGraph mode.
                if mode == "mailgraph":
                    sim_ids = [s.claim_id for s in similar_claims(result.graph, cmo.claim_id)]
                else:
                    sim_ids = []

                scores = score_one(g, pred, pack, similar_ids=sim_ids)
                per_row.append(
                    {
                        "mode": mode,
                        "claim_id": cmo.claim_id,
                        "scenario": g.scenario,
                        **scores,
                    }
                )
            except Exception as exc:  # noqa: BLE001
                print(f"  WARN mode={mode} claim={cmo.claim_id}: {exc}")
                per_row.append(
                    {
                        "mode": mode,
                        "claim_id": cmo.claim_id,
                        "scenario": g.scenario,
                        "missing_doc_recall": 0.0,
                        "missing_doc_precision": 0.0,
                        "escalation_recall": 0.0,
                        "timeline_recall": 0.0,
                        "similar_claim_relevance": 0.0,
                        "evidence_citation_rate": 0.0,
                        "json_validity": 0.0,
                    }
                )

    print(
        f"  ran {len(per_row)} mode-claim cells; "
        f"skipped (no gold): {len(skipped_no_gold)}"
    )

    # 5. Aggregate and write reports.
    summary: dict[str, dict[str, float]] = {}
    for mode in MODES:
        rows = [r for r in per_row if r["mode"] == mode]
        summary[mode] = aggregate_scores(
            [{k: r[k] for k in r if isinstance(r[k], (int, float))} for r in rows]
        )

    write_reports(per_row=per_row, summary=summary)
    elapsed = time.time() - t0
    print(f"  done in {elapsed:.1f}s")
    print(f"  wrote artifacts/results.csv, artifacts/results.md, artifacts/results.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())

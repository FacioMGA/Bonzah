"""Write the three eval artifacts: results.csv, results.md, results.png.

results.md is the rubric-grade table that goes into the appendix verbatim.
"""

from __future__ import annotations

import csv
from pathlib import Path

from org2vec.llm.client import provider_label

ARTIFACTS = Path(__file__).resolve().parents[3] / "artifacts"


METRIC_ORDER = [
    "missing_doc_recall",
    "missing_doc_precision",
    "escalation_recall",
    "timeline_recall",
    "evidence_citation_rate",
    "similar_claim_relevance",
    "json_validity",
]

METRIC_LABELS = {
    "missing_doc_recall": "Missing-doc recall",
    "missing_doc_precision": "Missing-doc precision",
    "escalation_recall": "Escalation recall",
    "timeline_recall": "Timeline accuracy",
    "evidence_citation_rate": "Evidence citation rate",
    "similar_claim_relevance": "Similar-claim relevance",
    "json_validity": "JSON validity",
}

MODE_LABELS = {
    "chatgpt_only": "ChatGPT only",
    "manual_rag": "Manual RAG",
    "mailgraph": "MailGraph RAG",
}


def write_reports(*, per_row: list[dict], summary: dict[str, dict[str, float]]) -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    _write_csv(per_row)
    _write_md(summary)
    _write_png(summary)


def _write_csv(per_row: list[dict]) -> None:
    path = ARTIFACTS / "results.csv"
    if not per_row:
        path.write_text("")
        return
    fields = list(per_row[0].keys())
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in per_row:
            w.writerow(row)


def _pct(x: float) -> str:
    return f"{x * 100:.0f}%"


def _write_md(summary: dict[str, dict[str, float]]) -> None:
    path = ARTIFACTS / "results.md"
    lines: list[str] = []
    lines.append("# org2vec MailGraph — three-mode evaluation")
    lines.append("")
    lines.append(f"LLM provider: `{provider_label()}`")
    lines.append("")
    lines.append("Question:")
    lines.append("")
    lines.append(
        "> Review this submitted claim file. What information gaps remain, what "
        "parts of the claim may be rejected or reserved, and what should the "
        "handler do next?"
    )
    lines.append("")
    lines.append("## Aggregate scores")
    lines.append("")
    header = "| Metric | " + " | ".join(MODE_LABELS[m] for m in MODE_LABELS) + " |"
    sep = "|---|" + "---|" * len(MODE_LABELS)
    lines.append(header)
    lines.append(sep)
    for m in METRIC_ORDER:
        row = "| " + METRIC_LABELS[m]
        for mode in MODE_LABELS:
            v = summary.get(mode, {}).get(m, 0.0)
            row += f" | {_pct(v)}"
        row += " |"
        lines.append(row)
    lines.append("")
    lines.append(
        "All scores are means over the synthesized corpus (15 CY-MTR-* + 4 ABB/VL/*). "
        "Higher is better."
    )
    lines.append("")
    lines.append("## How to reproduce")
    lines.append("")
    lines.append("```")
    lines.append("cd experiments/org2vec-mailgraph")
    lines.append("python -m org2vec.eval.runner")
    lines.append("```")
    path.write_text("\n".join(lines) + "\n")


def _write_png(summary: dict[str, dict[str, float]]) -> None:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import numpy as np
    except ImportError:
        return

    metrics = METRIC_ORDER
    modes = list(MODE_LABELS.keys())
    values = np.array(
        [[summary.get(mode, {}).get(m, 0.0) for m in metrics] for mode in modes]
    )

    x = np.arange(len(metrics))
    width = 0.27
    fig, ax = plt.subplots(figsize=(11, 5.2), dpi=140)
    for i, mode in enumerate(modes):
        ax.bar(x + (i - 1) * width, values[i], width, label=MODE_LABELS[mode])
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("score")
    ax.set_xticks(x)
    ax.set_xticklabels([METRIC_LABELS[m] for m in metrics], rotation=18, ha="right")
    ax.set_title("org2vec MailGraph — three-mode evaluation")
    ax.legend(loc="upper left")
    ax.grid(True, axis="y", linestyle=":", alpha=0.5)
    fig.tight_layout()
    fig.savefig(ARTIFACTS / "results.png")
    plt.close(fig)


__all__ = ["write_reports"]

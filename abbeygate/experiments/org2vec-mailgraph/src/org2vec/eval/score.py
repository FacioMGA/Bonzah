"""Scoring functions.

All metrics are deterministic functions of (gold, predicted_analysis, pack).
Each returns a single float in [0, 1].
"""

from __future__ import annotations

import json
import re

from org2vec.eval.gold import Gold
from org2vec.models import EvidencePack, ThreadAnalysis
from org2vec.rag.verify import citation_rate

# Synonym table for fuzzy gap matching. Keep it tight; ad-hoc additions go here.
DOC_SYNONYMS: dict[str, set[str]] = {
    "police_report": {"police report", "police attendance", "police reference", "police"},
    "third_party_insurer_details": {
        "third-party insurer",
        "third party insurer",
        "tp insurer",
        "tp insurer details",
        "third party details",
    },
    "witness_statement": {"witness statement", "witnesses", "witness"},
    "vehicle_registration": {"v5", "registration document", "vehicle registration", "v5/registration"},
    "cctv_footage": {"cctv", "cctv footage"},
    "medical_report": {"medical report", "medical"},
    "photos_with_metadata": {"photos", "photographs", "photo metadata"},
    "motor_claim_form": {"motor claim form", "claim form"},
    "estimates": {"estimate", "estimates", "repair estimate"},
}


def _normalize(s: str) -> str:
    return re.sub(r"[^a-z ]", "", s.lower()).strip()


def _matches_gold(gold_key: str, predicted_doc: str) -> bool:
    needles = DOC_SYNONYMS.get(gold_key, set())
    needles = needles | {_normalize(gold_key.replace("_", " "))}
    p = _normalize(predicted_doc)
    return any(n in p or p in n for n in needles)


# ---------------------------------------------------------------------------
# Missing-document recall / precision.
# ---------------------------------------------------------------------------


def missing_doc_recall(gold: Gold, pred: ThreadAnalysis) -> float:
    if not gold.gold_missing_documents:
        return 1.0
    found = 0
    for g in gold.gold_missing_documents:
        if any(_matches_gold(g, gap.document) for gap in pred.missing_information):
            found += 1
    return found / len(gold.gold_missing_documents)


def missing_doc_precision(gold: Gold, pred: ThreadAnalysis) -> float:
    if not pred.missing_information:
        return 1.0
    tp = 0
    for gap in pred.missing_information:
        if any(_matches_gold(g, gap.document) for g in gold.gold_missing_documents):
            tp += 1
    return tp / len(pred.missing_information)


# ---------------------------------------------------------------------------
# Escalation / authority recall.
# ---------------------------------------------------------------------------


def escalation_recall(gold: Gold, pred: ThreadAnalysis) -> float:
    if not gold.gold_authority_flags:
        return 1.0
    pred_kinds = {f.kind for f in pred.authority_flags}
    return sum(1 for g in gold.gold_authority_flags if g in pred_kinds) / len(
        gold.gold_authority_flags
    )


# ---------------------------------------------------------------------------
# Timeline event accuracy.
# ---------------------------------------------------------------------------


def timeline_recall(gold: Gold, pred: ThreadAnalysis) -> float:
    if not gold.gold_key_events:
        return 1.0
    pred_types = [e.type for e in pred.timeline]
    found = 0
    for g in gold.gold_key_events:
        if g in pred_types:
            found += 1
    return found / len(gold.gold_key_events)


# ---------------------------------------------------------------------------
# Similar-claim relevance.
# ---------------------------------------------------------------------------


def similar_claim_relevance(gold: Gold, similar_ids: list[str]) -> float:
    if not gold.gold_similar_threads:
        return 1.0 if not similar_ids else 0.5  # spurious matches are penalised
    return sum(1 for s in similar_ids if s in gold.gold_similar_threads) / len(
        gold.gold_similar_threads
    )


# ---------------------------------------------------------------------------
# JSON validity (vacuously 1 here, since Pydantic already validates).
# ---------------------------------------------------------------------------


def json_validity(pred: ThreadAnalysis | None) -> float:
    return 1.0 if pred is not None else 0.0


# ---------------------------------------------------------------------------
# Citation rate — proxy from rag.verify.
# ---------------------------------------------------------------------------


def evidence_citation_rate(pred: ThreadAnalysis, pack: EvidencePack) -> float:
    return citation_rate(pred, pack)


def score_one(
    gold: Gold,
    pred: ThreadAnalysis,
    pack: EvidencePack,
    *,
    similar_ids: list[str],
) -> dict[str, float]:
    return {
        "missing_doc_recall": missing_doc_recall(gold, pred),
        "missing_doc_precision": missing_doc_precision(gold, pred),
        "escalation_recall": escalation_recall(gold, pred),
        "timeline_recall": timeline_recall(gold, pred),
        "similar_claim_relevance": similar_claim_relevance(gold, similar_ids),
        "evidence_citation_rate": evidence_citation_rate(pred, pack),
        "json_validity": json_validity(pred),
    }


def aggregate_scores(rows: list[dict[str, float]]) -> dict[str, float]:
    if not rows:
        return {}
    out: dict[str, float] = {}
    for k in rows[0]:
        out[k] = sum(r[k] for r in rows) / len(rows)
    return out

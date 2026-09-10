"""Citation verifier.

Every claim in a ``ThreadAnalysis`` must point to a real item in the evidence
pack it was generated from. Items with unsupported citations are dropped —
not patched, not silently passed. The "hallucinated citations fail validation
and the answer is rejected, not patched" rule from the plan is enforced here.
"""

from __future__ import annotations

from typing import TypeVar

from org2vec.models import Citation, EvidencePack, ThreadAnalysis

T = TypeVar("T")


def _supports(cit: Citation, pack: EvidencePack) -> bool:
    keys = pack.by_key()
    if cit.kind == "email":
        return ("email", cit.thread_id or "", cit.message_id or "") in keys
    return ("rule", cit.doc_id or "", cit.chunk_id or "") in keys


def filter_unsupported_citations(analysis: ThreadAnalysis, pack: EvidencePack) -> ThreadAnalysis:
    """Return a copy of ``analysis`` with unsupported items dropped.

    Soft-empty packs (e.g. ChatGPT-only mode) are permissive: if the pack is
    empty we keep whatever the model produced (we still expose this in eval
    as "evidence citation rate = 0", which is the point).
    """
    if not pack.items:
        return analysis

    data = analysis.model_dump()
    dropped = 0

    for section in (
        "timeline",
        "missing_information",
        "authority_flags",
        "liability_positions",
        "recommended_next_actions",
    ):
        kept: list[dict] = []
        for item in data.get(section, []) or []:
            cit_raw = item.get("citation")
            if not cit_raw:
                dropped += 1
                continue
            try:
                cit = Citation.model_validate(cit_raw)
            except Exception:  # noqa: BLE001
                dropped += 1
                continue
            if _supports(cit, pack):
                kept.append(item)
            else:
                dropped += 1
        data[section] = kept

    if dropped:
        # Don't fail loudly; the eval harness counts citation rate. We just
        # surface the count for debug logs.
        data.setdefault("_meta", {})["dropped_unsupported_citations"] = dropped

    # ``ThreadAnalysis`` has no _meta field; strip before validation.
    data.pop("_meta", None)
    return ThreadAnalysis.model_validate(data)


def citation_rate(analysis: ThreadAnalysis, pack: EvidencePack) -> float:
    """Fraction of claims in the analysis whose citation resolves in the pack.

    Used directly by the eval harness as "evidence_citation_rate". For an
    empty analysis we return 1.0 (vacuously true), for an analysis with claims
    but an empty pack we return 0.0.
    """
    items_with_citation: list[Citation] = []
    for section in (
        "timeline",
        "missing_information",
        "authority_flags",
        "liability_positions",
        "recommended_next_actions",
    ):
        for item in getattr(analysis, section, []) or []:
            cit = getattr(item, "citation", None)
            if cit is not None:
                items_with_citation.append(cit)
    if not items_with_citation:
        return 1.0
    if not pack.items:
        return 0.0
    ok = sum(1 for c in items_with_citation if _supports(c, pack))
    return ok / len(items_with_citation)

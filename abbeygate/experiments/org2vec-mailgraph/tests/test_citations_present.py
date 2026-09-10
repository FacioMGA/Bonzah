"""Citation verifier tests."""

from __future__ import annotations

from org2vec.models import (
    Action,
    AuthorityFlag,
    Citation,
    EvidenceItem,
    EvidencePack,
    Gap,
    ThreadAnalysis,
)
from org2vec.rag.verify import citation_rate, filter_unsupported_citations


def _good_citation():
    return Citation(kind="email", thread_id="T1", message_id="T1-m1", quote="x")


def _bad_citation():
    return Citation(kind="email", thread_id="T1", message_id="DOES-NOT-EXIST", quote="y")


def _pack():
    return EvidencePack(
        question="q",
        items=[EvidenceItem(kind="email", id="T1-m1", parent_id="T1", text="...")],
    )


def test_filter_drops_unsupported_citation():
    a = ThreadAnalysis(
        thread_id="T1",
        missing_information=[
            Gap(document="A", rationale="good", citation=_good_citation(), received=False),
            Gap(document="B", rationale="bad", citation=_bad_citation(), received=False),
        ],
        authority_flags=[
            AuthorityFlag(kind="bi_potential", rationale="x", citation=_bad_citation())
        ],
        recommended_next_actions=[
            Action(action="x", priority="medium", rationale="x", citation=_good_citation())
        ],
    )
    filtered = filter_unsupported_citations(a, _pack())
    assert [g.document for g in filtered.missing_information] == ["A"]
    assert filtered.authority_flags == []
    assert filtered.recommended_next_actions[0].action == "x"


def test_citation_rate_vacuous_for_empty_analysis():
    a = ThreadAnalysis(thread_id="T1")
    assert citation_rate(a, _pack()) == 1.0


def test_citation_rate_zero_when_pack_empty_but_claims_exist():
    a = ThreadAnalysis(
        thread_id="T1",
        missing_information=[
            Gap(document="A", rationale="x", citation=_good_citation(), received=False)
        ],
    )
    empty = EvidencePack(question="q", items=[])
    assert citation_rate(a, empty) == 0.0

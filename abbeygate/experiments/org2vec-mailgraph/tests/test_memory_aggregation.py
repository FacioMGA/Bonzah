"""ClaimMemoryObject aggregation tests."""

from __future__ import annotations

from pathlib import Path

from org2vec.extract.entities import extract_entities
from org2vec.ingest.parse import parse_corpus_txt
from org2vec.memory.build import aggregate
from org2vec.models import ThreadAnalysis

CORPUS = Path(__file__).resolve().parents[1] / "corpus" / "threads"


def test_aggregate_produces_one_cmo_per_claim():
    threads = [parse_corpus_txt(p) for p in sorted(CORPUS.glob("*.txt"))]
    analyses = [
        ThreadAnalysis(thread_id=t.thread_id, claim_refs=t.claim_refs, entities=extract_entities(t))
        for t in threads
    ]
    cmos = aggregate(threads, analyses)
    ids = sorted(c.claim_id for c in cmos)
    assert len(cmos) == 19
    assert "CY-MTR-017" in ids
    assert "ABB/VL/00112" in ids


def test_cy_mtr_017_aggregate_has_entities_and_messages():
    threads = [parse_corpus_txt(p) for p in sorted(CORPUS.glob("*.txt"))]
    analyses = [
        ThreadAnalysis(thread_id=t.thread_id, claim_refs=t.claim_refs, entities=extract_entities(t))
        for t in threads
    ]
    cmos = aggregate(threads, analyses)
    cmo = next(c for c in cmos if c.claim_id == "CY-MTR-017")
    assert len(cmo.messages) >= 6
    kinds = {e.kind for e in cmo.entities}
    assert "garage" in kinds
    assert "claim_ref" in kinds

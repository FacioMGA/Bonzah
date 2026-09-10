"""Schema-shape tests for the extractor.

These tests verify the deterministic parts (classify + entities). The LLM
analysis path requires credentials and is exercised by the eval harness.
"""

from __future__ import annotations

from pathlib import Path

from org2vec.extract.entities import extract_entities
from org2vec.extract.events import classify_message, classify_thread
from org2vec.ingest.parse import parse_corpus_txt

CORPUS = Path(__file__).resolve().parents[1] / "corpus" / "threads"


def test_classifier_finds_fnol_and_chaser_in_017():
    t = classify_thread(parse_corpus_txt(CORPUS / "CY-MTR-017.txt"))
    types = [m.message_type for m in t.messages]
    assert types[0] == "FNOL"
    assert "escalation" in types
    assert "chaser" in types


def test_entities_017_finds_garage_amount_policy():
    t = parse_corpus_txt(CORPUS / "CY-MTR-017.txt")
    ents = extract_entities(t)
    kinds = {e.kind for e in ents}
    assert "claim_ref" in kinds
    assert "policy_no" in kinds
    assert "garage" in kinds
    assert any(e.value == "QuickFix Auto" for e in ents)
    assert any(float(e.value) == 30000.0 for e in ents if e.kind == "amount")


def test_classify_message_default_is_info():
    from org2vec.models import Message

    m = Message(message_id="x", thread_id="y", sender="N", body="hello", subject="hello")
    assert classify_message(m) == "info"

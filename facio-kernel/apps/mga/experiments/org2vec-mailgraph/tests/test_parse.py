"""Smoke tests for the corpus parser."""

from __future__ import annotations

from pathlib import Path

from org2vec.ingest.parse import parse_corpus_txt

CORPUS = Path(__file__).resolve().parents[1] / "corpus" / "threads"


def test_corpus_threads_parse():
    files = list(CORPUS.glob("*.txt"))
    assert len(files) == 19, "expected 19 synthesized corpus threads (15 + 4 ABB/VL/)"
    for f in files:
        t = parse_corpus_txt(f)
        assert t.thread_id == f.stem
        assert t.messages, f"{f.name} produced no messages"
        for m in t.messages:
            assert m.message_id.startswith(t.thread_id)
            assert m.sender


def test_cy_mtr_017_has_six_messages():
    t = parse_corpus_txt(CORPUS / "CY-MTR-017.txt")
    assert len(t.messages) == 6
    assert t.claim_refs == ["CY-MTR-017"]
    # last message is a chaser
    assert "chaser" in t.messages[-1].subject.lower()

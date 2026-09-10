"""KB inventory tests — the rule-base must contain the assignment's headline
GESY chunks, the EUR 25,000 DCA authority limit, and the endorsement codes
referenced by the Appendix Experiment C output.
"""

from __future__ import annotations

from pathlib import Path

KB = Path(__file__).resolve().parents[1] / "corpus" / "kb"


def _read_all() -> str:
    return "\n".join(p.read_text() for p in KB.glob("*.md"))


def test_kb_has_gesy_endorsement_chunks():
    files = list(KB.glob("abbeygate-endorsement-141-gesy*.md"))
    assert len(files) >= 2, "expected at least two GESY chunks (trigger + clause d)"
    text = _read_all()
    assert "GESY" in text and "Endorsement No. 141" in text


def test_kb_has_dca_authority_limit_eur_25000():
    text = _read_all()
    assert "25,000" in text or "25000" in text
    assert "delegated" in text.lower()


def test_kb_has_endorsement_code_chunks():
    text = _read_all()
    for code in ("CV4", "CV172", "CV999"):
        assert code in text, f"missing KB coverage for {code}"


def test_kb_has_abg_liability_procedure():
    text = _read_all()
    assert "burden of proof" in text.lower()
    assert "abbeygate.cy" in text or "ABG" in text

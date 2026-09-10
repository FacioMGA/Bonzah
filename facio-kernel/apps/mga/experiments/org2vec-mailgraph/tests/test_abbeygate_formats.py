"""Tests for production-grade Abbeygate format handling.

These tests pin the assignment-alignment improvements:

- ABB/VL/ claim-ref regex
- ABLV/PT Lloyd's cross-reference regex
- Portuguese vehicle reg regex
- Endorsement code extraction (CV4/CV5/CV172/CV999)
- GESY mention detection
- Language + jurisdiction tagging on Thread
"""

from __future__ import annotations

from pathlib import Path

from org2vec.extract.entities import extract_entities
from org2vec.ingest.parse import (
    CLAIM_REF_RE,
    LLOYDS_REF_RE,
    PT_REG_RE,
    detect_jurisdiction,
    detect_language,
    parse_corpus_txt,
)

CORPUS = Path(__file__).resolve().parents[1] / "corpus" / "threads"


def test_claim_ref_regex_matches_both_formats():
    assert CLAIM_REF_RE.findall("Re: CY-MTR-017 — update") == ["CY-MTR-017"]
    assert CLAIM_REF_RE.findall("ENC: Pedido ABB/VL/00044 — 60-UN-97") == ["ABB/VL/00044"]
    # Both formats in one body.
    matched = CLAIM_REF_RE.findall("see also ABB/VL/00112 and CY-MTR-017")
    assert "ABB/VL/00112" in matched and "CY-MTR-017" in matched


def test_lloyds_ref_regex():
    assert LLOYDS_REF_RE.findall("policy ABLV/PT1003710 is current") == ["ABLV/PT1003710"]
    assert LLOYDS_REF_RE.findall("Lloyd's ref ABLV1005959") == ["ABLV1005959"]


def test_pt_reg_regex_finds_portuguese_plates():
    matches = PT_REG_RE.findall("matrícula 44-PL-07 e tambem 72-TE-20")
    assert "44-PL-07" in matches
    assert "72-TE-20" in matches
    # legacy un-hyphenated form
    assert "44PL07" in PT_REG_RE.findall("plate 44PL07")


def test_detect_language_portuguese_keywords():
    text = "Pedido peritagem ABB/VL/00044. Por favor agendar peritagem para a viatura."
    assert detect_language(text) == "pt"


def test_detect_language_english_keywords():
    text = "Please confirm claim ABB/VL/00112. Insured vehicle policy under review."
    assert detect_language(text) == "en"


def test_detect_language_bilingual_when_both():
    text = (
        "Bom dia, pedido de informação about claim. Please find the viatura "
        "estimate attached. Thank you / Obrigado. Kindly please confirm."
    )
    assert detect_language(text) == "bilingual"


def test_detect_jurisdiction_pt_from_abbvl_ref():
    assert detect_jurisdiction("Pedido ABB/VL/00044", ["ABB/VL/00044"]) == "PT"


def test_detect_jurisdiction_cy_from_gesy_mention():
    assert detect_jurisdiction("GESY confirmed at data capture", ["ABB/VL/00112"]) == "CY"


def test_corpus_abbvl_thread_has_pt_language_and_jurisdiction():
    t = parse_corpus_txt(CORPUS / "ABB-VL-00043.txt")
    assert t.claim_refs == ["ABB/VL/00043"]
    assert t.language == "pt"
    assert t.jurisdiction == "PT"


def test_corpus_gesy_thread_emits_gesy_and_cy_jurisdiction():
    t = parse_corpus_txt(CORPUS / "ABB-VL-00112.txt")
    assert t.claim_refs == ["ABB/VL/00112"]
    assert t.jurisdiction == "CY"
    ents = extract_entities(t)
    kinds = {e.kind for e in ents}
    assert "gesy" in kinds, "GESY mention must be extracted as an entity"
    assert "claim_ref" in kinds
    assert any(e.value == "ABB/VL/00112" for e in ents if e.kind == "claim_ref")


def test_endorsement_codes_extracted_from_abbvl_00048():
    t = parse_corpus_txt(CORPUS / "ABB-VL-00048.txt")
    ents = extract_entities(t)
    codes = {e.value for e in ents if e.kind == "endorsement_code"}
    assert "CV4" in codes
    assert "CV172" in codes


def test_lloyds_ref_captured_on_thread():
    t = parse_corpus_txt(CORPUS / "ABB-VL-00048.txt")
    assert "ABLV/PT1003710" in t.lloyds_refs
    ents = extract_entities(t)
    assert any(
        e.kind == "lloyds_ref" and e.value == "ABLV/PT1003710" for e in ents
    )


def test_abbvl_00048_entity_amount_above_authority():
    t = parse_corpus_txt(CORPUS / "ABB-VL-00048.txt")
    ents = extract_entities(t)
    amounts = sorted(float(e.value) for e in ents if e.kind == "amount")
    assert any(a >= 25000 for a in amounts), (
        "the EUR 41,200 estimate must be extracted so the authority flag fires"
    )

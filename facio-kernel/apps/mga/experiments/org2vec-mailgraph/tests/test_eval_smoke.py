"""Smoke test: pipeline runs end-to-end against the sample corpus in offline mode."""

from __future__ import annotations

import os

import pytest


@pytest.mark.skipif(
    not os.path.exists("corpus/threads/CY-MTR-017.txt"),
    reason="corpus not built; run scripts/synthesize_corpus.py",
)
def test_pipeline_runs_to_completion_offline(monkeypatch):
    monkeypatch.setenv("ORG2VEC_OFFLINE", "1")
    from org2vec.ingest.pipeline import run_to_completion

    result = run_to_completion(source="sample")
    assert len(result.threads) == 19
    assert len(result.memory) == 19
    # Graph has at least one similar-claim hop for the headline thread.
    cmo_017 = result.by_claim["CY-MTR-017"]
    assert any(s.claim_id in {"CY-MTR-011", "CY-MTR-031"} for s in cmo_017.similar_claims), (
        "expected QuickFix Auto recurrence to surface CY-MTR-011 or CY-MTR-031 as similar"
    )
    # GESY thread is parsed and aggregated.
    gesy = result.by_claim["ABB/VL/00112"]
    assert gesy.threads[0].jurisdiction == "CY"
    assert any(e.kind == "gesy" for e in gesy.entities)

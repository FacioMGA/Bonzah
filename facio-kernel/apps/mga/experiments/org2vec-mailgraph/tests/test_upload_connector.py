"""Upload connector tests — the new source must work end-to-end."""

from __future__ import annotations

from pathlib import Path

from org2vec.connect.upload import UploadedFile, pull_threads
from org2vec.models import Filter

CORPUS = Path(__file__).resolve().parents[1] / "corpus" / "threads"


def _bytes(p: Path) -> tuple[str, bytes]:
    return (p.name, p.read_bytes())


def test_upload_accepts_corpus_txt_bytes():
    threads = pull_threads([_bytes(CORPUS / "CY-MTR-017.txt")])
    assert len(threads) == 1
    t = threads[0]
    assert t.thread_id == "CY-MTR-017"
    assert t.source == "upload"
    assert len(t.messages) == 6


def test_upload_accepts_path_objects():
    threads = pull_threads([CORPUS / "ABB-VL-00112.txt"])
    assert len(threads) == 1
    t = threads[0]
    assert t.claim_refs == ["ABB/VL/00112"]
    assert t.jurisdiction == "CY"
    assert t.source == "upload"


def test_upload_mixed_files_at_once():
    threads = pull_threads(
        [
            CORPUS / "CY-MTR-017.txt",
            _bytes(CORPUS / "ABB-VL-00043.txt"),
            UploadedFile.from_path(CORPUS / "ABB-VL-00048.txt"),
        ]
    )
    ids = sorted(t.thread_id for t in threads)
    assert ids == sorted(["CY-MTR-017", "ABB-VL-00043", "ABB-VL-00048"])
    assert all(t.source == "upload" for t in threads)


def test_upload_filter_subject_contains():
    threads = pull_threads(
        [
            CORPUS / "CY-MTR-017.txt",
            CORPUS / "ABB-VL-00112.txt",
        ],
        filter=Filter(subject_contains="GESY"),
    )
    assert {t.thread_id for t in threads} == {"ABB-VL-00112"}


def test_upload_unknown_extension_silently_skipped(tmp_path):
    blob = tmp_path / "image.png"
    blob.write_bytes(b"\x89PNG\r\n")
    threads = pull_threads([blob])
    assert threads == []


def test_upload_pipeline_end_to_end_offline(monkeypatch):
    monkeypatch.setenv("ORG2VEC_OFFLINE", "1")
    from org2vec.ingest.pipeline import run_to_completion

    result = run_to_completion(
        source="upload",
        uploads=[CORPUS / "ABB-VL-00112.txt"],
    )
    assert len(result.threads) == 1
    cmo = result.by_claim["ABB/VL/00112"]
    assert cmo.threads[0].jurisdiction == "CY"
    kinds = {e.kind for e in cmo.entities}
    assert "gesy" in kinds

"""Sample-inbox connector — the demo safety net.

Loads the synthesized 15-thread corpus under ``corpus/threads/`` through the
same parser used by the live connectors. Filter is honoured client-side so
the UI behaviour matches Microsoft / Google exactly.

The win: if Wi-Fi or OAuth consent fails on demo day, the Streamlit demo
runs identically against this fallback.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from org2vec.ingest.parse import parse_corpus_txt
from org2vec.models import Filter, Thread

CORPUS = Path(__file__).resolve().parents[3] / "corpus" / "threads"


def list_thread_files() -> list[Path]:
    return sorted(CORPUS.glob("*.txt"))


def pull_threads(filt: Filter | None = None) -> list[Thread]:
    threads = [parse_corpus_txt(p) for p in list_thread_files()]
    if filt is None:
        return threads
    return [t for t in threads if _matches(t, filt)][: filt.max_threads]


def _matches(t: Thread, f: Filter) -> bool:
    if f.subject_contains:
        if f.subject_contains.lower() not in (t.subject or "").lower() and not any(
            f.subject_contains.lower() in (m.subject or "").lower() for m in t.messages
        ):
            return False
    if f.sender:
        if not any((m.sender_email or "") == f.sender for m in t.messages):
            return False
    if f.sender_domain:
        if not any((m.sender_email or "").endswith("@" + f.sender_domain) for m in t.messages):
            return False
    if f.has_attachment:
        if not any(m.attachments for m in t.messages):
            return False
    if f.date_from or f.date_to:
        dates = [m.sent_at for m in t.messages if m.sent_at]
        if not dates:
            return False
        if f.date_from and max(dates) < _to_dt(f.date_from):
            return False
        if f.date_to and min(dates) > _to_dt(f.date_to):
            return False
    return True


def _to_dt(d) -> datetime:
    if isinstance(d, datetime):
        return d
    return datetime(d.year, d.month, d.day)

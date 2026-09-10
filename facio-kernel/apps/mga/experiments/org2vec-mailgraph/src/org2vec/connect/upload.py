"""Upload connector — the new source.

The smallest possible new source: accept ``.eml`` and corpus-format ``.txt``
uploads from the Streamlit UI, dispatch each to the existing parser, and
return ``Thread`` objects. No OAuth, no API, no provider-specific code —
this is the realistic path for Peter's anonymized mailbox export to enter the
pipeline today.

A single ``UploadedFile`` shape unifies "bytes from Streamlit's file_uploader"
and "Path from a local disk drop". Both routes converge on the same parser.
"""

from __future__ import annotations

import email
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, Union

from org2vec.ingest.parse import _annotate, parse_corpus_txt, parse_eml, thread_eml
from org2vec.models import Filter, Thread


@dataclass
class UploadedFile:
    """Either bytes-from-Streamlit or a Path-on-disk, normalized."""

    name: str
    content: bytes

    @classmethod
    def from_path(cls, path: Path) -> "UploadedFile":
        return cls(name=path.name, content=path.read_bytes())

    @property
    def suffix(self) -> str:
        return Path(self.name).suffix.lower()


def pull_threads(
    uploads: Iterable[Union[UploadedFile, Path, tuple[str, bytes]]],
    *,
    filter: Filter | None = None,
) -> list[Thread]:
    """Convert a heterogeneous list of uploads into ``Thread``s.

    Accepts:
      - ``UploadedFile`` (already normalized)
      - ``Path``         (local file)
      - ``(name, bytes)``tuple (Streamlit-style)

    Dispatch:
      - ``.eml``  → ``parse_eml`` / ``thread_eml`` (groups by detected claim ref)
      - ``.txt``  → ``parse_corpus_txt``
      - other     → skipped with no error (silent)
    """
    normalized: list[UploadedFile] = []
    for u in uploads:
        if isinstance(u, UploadedFile):
            normalized.append(u)
        elif isinstance(u, Path):
            normalized.append(UploadedFile.from_path(u))
        elif isinstance(u, tuple) and len(u) == 2:
            name, content = u
            normalized.append(UploadedFile(name=name, content=content))
        else:
            # Try streamlit's UploadedFile-style duck typing.
            name = getattr(u, "name", None)
            content = None
            if hasattr(u, "getvalue"):
                content = u.getvalue()
            elif hasattr(u, "read"):
                content = u.read()
            if name and content is not None:
                normalized.append(UploadedFile(name=name, content=content))

    threads: list[Thread] = []
    eml_files: list[Path] = []

    with tempfile.TemporaryDirectory(prefix="org2vec-upload-") as tmpdir:
        tmp = Path(tmpdir)
        for u in normalized:
            target = tmp / u.name
            target.write_bytes(u.content)
            if u.suffix == ".eml":
                eml_files.append(target)
            elif u.suffix == ".txt":
                try:
                    t = parse_corpus_txt(target)
                    t.source = "upload"  # type: ignore[assignment]
                    threads.append(_annotate(t))
                except Exception:  # noqa: BLE001
                    # Last-ditch: maybe it's a raw RFC-822 message saved as .txt
                    try:
                        msg = email.message_from_bytes(u.content)
                        if msg.get("Message-ID") or msg.get("From"):
                            target_eml = tmp / (u.name + ".eml")
                            target_eml.write_bytes(u.content)
                            eml_files.append(target_eml)
                    except Exception:  # noqa: BLE001
                        pass
            # .msg (Outlook) is not yet supported; fall through silently.

        if eml_files:
            threads.extend(thread_eml(eml_files))

    # Tag the source for every produced thread and apply filter.
    for t in threads:
        t.source = "upload"  # type: ignore[assignment]
    if filter is not None:
        threads = _apply_filter(threads, filter)
    return threads


def _apply_filter(threads: list[Thread], f: Filter) -> list[Thread]:
    """Client-side filter, mirrored from connect/sample.py so the UI shape
    behaves identically across all sources."""
    out: list[Thread] = []
    for t in threads:
        if f.subject_contains:
            needle = f.subject_contains.lower()
            if needle not in (t.subject or "").lower() and not any(
                needle in (m.subject or "").lower() for m in t.messages
            ):
                continue
        if f.sender:
            if not any((m.sender_email or "") == f.sender for m in t.messages):
                continue
        if f.sender_domain:
            if not any(
                (m.sender_email or "").endswith("@" + f.sender_domain)
                for m in t.messages
            ):
                continue
        if f.has_attachment and not any(m.attachments for m in t.messages):
            continue
        if f.date_from or f.date_to:
            dates = [m.sent_at for m in t.messages if m.sent_at]
            if not dates:
                continue
            if f.date_from and max(dates) < _to_dt(f.date_from):
                continue
            if f.date_to and min(dates) > _to_dt(f.date_to):
                continue
        out.append(t)
    return out[: f.max_threads]


def _to_dt(d) -> datetime:
    if isinstance(d, datetime):
        return d
    return datetime(d.year, d.month, d.day)


__all__ = ["UploadedFile", "pull_threads"]

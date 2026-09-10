"""Thread parser.

Accepts the corpus ``.txt`` format, RFC-5322 ``.eml`` files, Microsoft Graph
message JSON, and Gmail API message JSON. All paths converge on the same
``Thread`` shape.

The corpus ``.txt`` format:

    Thread-ID: CY-MTR-017
    Claim-Ref: CY-MTR-017
    Subject: ...
    ===

    From: Anna <a@x.example>
    To: claims@abbeygate.example
    Date: 2026-01-03 14:20
    Subject: ...
    Attachments: a.pdf, b.zip   (optional)

    body text

    ---

    From: ...

Message IDs are derived deterministically: ``<thread_id>-m<index>`` for the
corpus, real ``Message-Id`` headers for ``.eml``, and provider IDs for the
connectors.
"""

from __future__ import annotations

import email
import re
from datetime import datetime
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path
from typing import Any

from dateutil import parser as date_parser

from org2vec.models import Attachment, Jurisdiction, Language, Message, Thread

# Claim refs come in two flavours across the Abbeygate corpus:
#   Synthesized:  CY-MTR-017, CY-MTR-019      (dash-separated)
#   Production:   ABB/VL/00039, ABB/VL/00112  (slash-separated, Volante DCA)
CLAIM_REF_RE = re.compile(
    r"\b(?:ABB/VL/\d{4,6}|[A-Z]{2}-[A-Z]{3,4}-\d{3,6})\b"
)

# Lloyd's cross-reference (ABLV / ABLV/PT formats per Cyprus binder + Lloyd's audit).
LLOYDS_REF_RE = re.compile(r"\b(ABLV(?:/[A-Z]{2})?\d{6,9})\b")

# Portuguese vehicle registration formats. PT plates use one of:
#   AB-12-CD (current), 12-AB-CD, AB-12-34, 12-34-AB (legacy)
# Plus the looser "44PL07" / "94LH16" style sometimes seen in subject lines.
PT_REG_RE = re.compile(
    r"\b("
    r"\d{2}-?[A-Z]{2}-?\d{2}|"
    r"[A-Z]{2}-?\d{2}-?\d{2}|"
    r"\d{2}[A-Z]{2}\d{2}"
    r")\b"
)

QUOTED_LINE_RE = re.compile(r"^(>+ ?| *On .*wrote: *$)", re.MULTILINE)


# Language detection — light-weight markers. Anything that isn't clearly one of
# the supported languages stays ``"unknown"``; the LLM still gets the raw text.
_LANG_MARKERS: dict[str, set[str]] = {
    "pt": {
        "pedido", "peritagem", "viatura", "veículo", "veiculo", "substituição",
        "substituicao", "reclamação", "reclamacao", "sinistro", "estimativa",
        "informação", "informacao", "obrigado", "cumprimentos", "saudações",
        "saudacoes",
    },
    "es": {
        "siniestro", "vehículo", "vehiculo", "reclamación", "reclamacion",
        "estimación", "estimacion", "saludos", "atentamente", "informe",
        "expediente",
    },
    "en": {
        "claim", "vehicle", "insured", "estimate", "kindly", "please",
        "regards", "thank", "fnol", "policy",
    },
    "el": {"ασφάλιση", "ζημιά", "όχημα", "ευχαριστώ", "ασφαλιστήριο"},
}


def detect_language(text: str) -> Language:
    """Best-effort language detection from a small marker table.

    No external dep; deterministic; good enough for jurisdiction routing and the
    appendix screenshot. Production would swap to ``langdetect`` behind the
    same call site.
    """
    if not text:
        return "unknown"
    lowered = text.lower()
    scores: dict[str, int] = {lang: 0 for lang in _LANG_MARKERS}
    for lang, words in _LANG_MARKERS.items():
        for w in words:
            if w in lowered:
                scores[lang] += 1
    if not any(scores.values()):
        return "unknown"
    top = max(scores, key=lambda k: scores[k])
    # Bilingual signal: PT + EN both above 1 (common in cross-border brokers).
    non_zero = [lang for lang, s in scores.items() if s >= 2]
    if "pt" in non_zero and "en" in non_zero:
        return "bilingual"
    if "es" in non_zero and "en" in non_zero:
        return "bilingual"
    return top  # type: ignore[return-value]


def detect_jurisdiction(thread_text: str, claim_refs: list[str]) -> Jurisdiction:
    """Best-effort jurisdiction tag.

    Rules:
      - ABB/VL/ refs default to PT (the Volante binder is PT-routed).
      - CY-MTR-* refs default to CY.
      - PT vehicle reg format → PT.
      - Mention of Cyprus / Limassol / Nicosia / GESY / GHS → CY.
      - Mention of Madrid / Barcelona / Spain → ES.
    """
    lowered = thread_text.lower()
    # GESY / GHS is Cyprus-only — wins over any default jurisdiction.
    if "gesy" in lowered or "ghs" in lowered:
        return "CY"
    if any("ABB/VL/" in r for r in claim_refs):
        # City-level or "incident in" signals only — "Cyprus DCA" as a rule
        # reference must NOT override the PT default for a PT-bound claim.
        if "limassol" in lowered or "nicosia" in lowered or "paphos" in lowered:
            return "CY"
        if "madrid" in lowered or "barcelona" in lowered or "valencia" in lowered:
            return "ES"
        if "lisbon" in lowered or "porto" in lowered or "faro" in lowered or "lisboa" in lowered:
            return "PT"
        return "PT"
    if any(r.startswith("CY-") for r in claim_refs):
        return "CY"
    if PT_REG_RE.search(thread_text):
        return "PT"
    if "spain" in lowered or "españa" in lowered:
        return "ES"
    if "portugal" in lowered:
        return "PT"
    return "unknown"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _strip_quoted(body: str) -> str:
    """Best-effort stripping of inline reply quotation."""
    lines: list[str] = []
    for line in body.splitlines():
        if QUOTED_LINE_RE.match(line):
            break
        lines.append(line)
    return "\n".join(lines).strip()


def _parse_date(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return date_parser.parse(s)
    except (ValueError, TypeError):
        return None


def _extract_claim_refs(text: str) -> list[str]:
    return sorted(set(CLAIM_REF_RE.findall(text)))


def _extract_lloyds_refs(text: str) -> list[str]:
    return sorted(set(LLOYDS_REF_RE.findall(text)))


def _annotate(thread: Thread) -> Thread:
    """Populate language + jurisdiction + lloyds_refs from message bodies."""
    full = "\n".join(m.subject + "\n" + m.body for m in thread.messages)
    thread.lloyds_refs = thread.lloyds_refs or _extract_lloyds_refs(full)
    thread.language = thread.language if thread.language != "unknown" else detect_language(full)
    thread.jurisdiction = (
        thread.jurisdiction
        if thread.jurisdiction != "unknown"
        else detect_jurisdiction(full, thread.claim_refs)
    )
    for m in thread.messages:
        if m.language == "unknown":
            m.language = detect_language(m.subject + "\n" + m.body)
    return thread


# ---------------------------------------------------------------------------
# Corpus .txt parser.
# ---------------------------------------------------------------------------


def parse_corpus_txt(path: Path) -> Thread:
    raw = path.read_text()
    header_block, _, body_block = raw.partition("===\n")
    headers: dict[str, str] = {}
    for line in header_block.splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            headers[k.strip().lower()] = v.strip()

    thread_id = headers.get("thread-id") or path.stem
    subject = headers.get("subject", "")
    claim_ref = headers.get("claim-ref")

    raw_messages = [m.strip() for m in body_block.split("\n---\n") if m.strip()]
    messages: list[Message] = []
    for i, raw_msg in enumerate(raw_messages):
        head_lines: list[str] = []
        body_lines: list[str] = []
        in_body = False
        for line in raw_msg.splitlines():
            if not in_body and line.strip() == "":
                in_body = True
                continue
            if in_body:
                body_lines.append(line)
            else:
                head_lines.append(line)
        meta: dict[str, str] = {}
        for line in head_lines:
            if ":" in line:
                k, _, v = line.partition(":")
                meta[k.strip().lower()] = v.strip()

        sender_field = meta.get("from", "Unknown")
        sender_name = sender_field
        sender_email = None
        if "<" in sender_field and ">" in sender_field:
            sender_name = sender_field.split("<")[0].strip()
            sender_email = sender_field.split("<")[1].rstrip(">").strip()

        attachments: list[Attachment] = []
        if "attachments" in meta:
            for name in [a.strip() for a in meta["attachments"].split(",") if a.strip()]:
                attachments.append(Attachment(filename=name))

        body = "\n".join(body_lines).strip()
        body = _strip_quoted(body)

        messages.append(
            Message(
                message_id=f"{thread_id}-m{i + 1}",
                thread_id=thread_id,
                sender=sender_name,
                sender_email=sender_email,
                recipients=[r.strip() for r in meta.get("to", "").split(",") if r.strip()],
                subject=meta.get("subject", subject),
                sent_at=_parse_date(meta.get("date")),
                body=body,
                attachments=attachments,
            )
        )

    claim_refs = [claim_ref] if claim_ref else _extract_claim_refs(raw)
    return _annotate(
        Thread(
            thread_id=thread_id,
            subject=subject,
            messages=messages,
            claim_refs=claim_refs,
            source="disk",
        )
    )


# ---------------------------------------------------------------------------
# RFC-5322 .eml parser.
# ---------------------------------------------------------------------------


def parse_eml(path: Path) -> Message:
    """Parse a single ``.eml`` file into a ``Message``.

    Threading multiple .eml files into one Thread is handled by ``thread_eml``.
    """
    with path.open("rb") as f:
        msg = email.message_from_binary_file(f)

    message_id = msg.get("Message-ID") or path.stem
    subject = msg.get("Subject", "")
    sender_name = ""
    sender_email = None
    from_field = msg.get("From", "")
    if from_field:
        addrs = getaddresses([from_field])
        if addrs:
            sender_name, sender_email = addrs[0]
            sender_name = sender_name or sender_email
    recipients = [a for _, a in getaddresses([msg.get("To", "") or ""]) if a]
    sent_at: datetime | None = None
    raw_date = msg.get("Date")
    if raw_date:
        try:
            sent_at = parsedate_to_datetime(raw_date)
        except (TypeError, ValueError):
            sent_at = None

    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                body = part.get_payload(decode=True).decode(
                    part.get_content_charset() or "utf-8", errors="replace"
                )
                break
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            body = payload.decode(msg.get_content_charset() or "utf-8", errors="replace")

    attachments = []
    for part in msg.walk() if msg.is_multipart() else []:
        if part.get_content_disposition() == "attachment":
            attachments.append(
                Attachment(filename=part.get_filename() or "attachment", mime_type=part.get_content_type())
            )

    refs = _extract_claim_refs(subject + "\n" + body)
    thread_hint = refs[0] if refs else (msg.get("Thread-Index") or "thread")

    return Message(
        message_id=message_id,
        thread_id=thread_hint,
        sender=sender_name,
        sender_email=sender_email,
        recipients=recipients,
        subject=subject,
        sent_at=sent_at,
        body=_strip_quoted(body),
        attachments=attachments,
    )


def thread_eml(paths: list[Path]) -> list[Thread]:
    """Group ``.eml`` files into ``Thread``s by detected claim ref / subject."""
    msgs = [parse_eml(p) for p in paths]
    buckets: dict[str, list[Message]] = {}
    for m in msgs:
        key = m.thread_id
        buckets.setdefault(key, []).append(m)
    out: list[Thread] = []
    for key, ms in buckets.items():
        ms.sort(key=lambda x: x.sent_at or datetime.min)
        for i, m in enumerate(ms):
            m.message_id = f"{key}-m{i + 1}"
            m.thread_id = key
        refs = sorted({r for m in ms for r in _extract_claim_refs(m.subject + "\n" + m.body)})
        out.append(
            _annotate(
                Thread(
                    thread_id=key,
                    subject=ms[0].subject if ms else "",
                    messages=ms,
                    claim_refs=refs or [key],
                    source="disk",
                )
            )
        )
    return out


# ---------------------------------------------------------------------------
# Microsoft Graph payload -> Thread.
# ---------------------------------------------------------------------------


def from_graph_messages(thread_id: str, items: list[dict[str, Any]]) -> Thread:
    """Convert a list of Microsoft Graph ``/me/messages`` items into a Thread.

    Reference: https://learn.microsoft.com/graph/api/resources/message
    """
    items_sorted = sorted(items, key=lambda x: x.get("receivedDateTime", ""))
    messages: list[Message] = []
    for i, it in enumerate(items_sorted):
        sender = it.get("from", {}).get("emailAddress", {})
        recipients = [
            r.get("emailAddress", {}).get("address", "")
            for r in it.get("toRecipients", [])
            if r.get("emailAddress")
        ]
        body_obj = it.get("body", {})
        body = body_obj.get("content", "") or ""
        if body_obj.get("contentType", "").lower() == "html":
            body = re.sub(r"<[^>]+>", "", body)
        attachments = [
            Attachment(filename=a.get("name", "attachment"), mime_type=a.get("contentType"))
            for a in it.get("attachments", [])
        ]
        sent_at = _parse_date(it.get("receivedDateTime"))
        messages.append(
            Message(
                message_id=f"{thread_id}-m{i + 1}",
                thread_id=thread_id,
                sender=sender.get("name") or sender.get("address", "Unknown"),
                sender_email=sender.get("address"),
                recipients=recipients,
                subject=it.get("subject", ""),
                sent_at=sent_at,
                body=_strip_quoted(body.strip()),
                attachments=attachments,
            )
        )
    subject = items_sorted[0].get("subject", "") if items_sorted else ""
    refs = _extract_claim_refs(subject + "\n" + "\n".join(m.body for m in messages))
    return _annotate(
        Thread(
            thread_id=thread_id,
            subject=subject,
            messages=messages,
            claim_refs=refs or [thread_id],
            source="microsoft",
        )
    )


# ---------------------------------------------------------------------------
# Gmail payload -> Thread.
# ---------------------------------------------------------------------------


def from_gmail_thread(payload: dict[str, Any]) -> Thread:
    """Convert a Gmail API ``threads.get`` payload into a Thread."""
    thread_id = payload.get("id", "thread")
    messages_raw = payload.get("messages", [])
    messages: list[Message] = []
    for i, m in enumerate(messages_raw):
        headers = {h["name"].lower(): h["value"] for h in m.get("payload", {}).get("headers", [])}
        from_field = headers.get("from", "")
        sender_name = from_field.split("<")[0].strip() if from_field else "Unknown"
        sender_email = None
        if "<" in from_field and ">" in from_field:
            sender_email = from_field.split("<")[1].rstrip(">").strip()
        recipients = [r.strip() for r in headers.get("to", "").split(",") if r.strip()]
        body = _gmail_extract_body(m.get("payload", {}))
        attachments = _gmail_attachments(m.get("payload", {}))
        sent_at = _parse_date(headers.get("date"))
        messages.append(
            Message(
                message_id=f"{thread_id}-m{i + 1}",
                thread_id=thread_id,
                sender=sender_name,
                sender_email=sender_email,
                recipients=recipients,
                subject=headers.get("subject", ""),
                sent_at=sent_at,
                body=_strip_quoted(body),
                attachments=attachments,
            )
        )
    subject = messages[0].subject if messages else ""
    refs = _extract_claim_refs(subject + "\n" + "\n".join(m.body for m in messages))
    return _annotate(
        Thread(
            thread_id=thread_id,
            subject=subject,
            messages=messages,
            claim_refs=refs or [thread_id],
            source="google",
        )
    )


def _gmail_extract_body(payload: dict[str, Any]) -> str:
    import base64

    def walk(part: dict[str, Any]) -> str | None:
        if part.get("mimeType") == "text/plain":
            data = part.get("body", {}).get("data")
            if data:
                return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
        for sub in part.get("parts", []) or []:
            t = walk(sub)
            if t:
                return t
        if part.get("mimeType") == "text/html":
            data = part.get("body", {}).get("data")
            if data:
                html = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
                return re.sub(r"<[^>]+>", "", html)
        return None

    return (walk(payload) or "").strip()


def _gmail_attachments(payload: dict[str, Any]) -> list[Attachment]:
    out: list[Attachment] = []

    def walk(part: dict[str, Any]) -> None:
        if part.get("filename"):
            out.append(
                Attachment(
                    filename=part["filename"],
                    mime_type=part.get("mimeType"),
                    size_bytes=part.get("body", {}).get("size"),
                )
            )
        for sub in part.get("parts", []) or []:
            walk(sub)

    walk(payload)
    return out

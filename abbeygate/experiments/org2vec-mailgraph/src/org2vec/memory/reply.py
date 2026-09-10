"""Draft-reply generator.

Composes a documents-request email from the canonical template + the open
``ClaimMemoryObject``. One requested item per gap, with the gap's rationale
as the cited reason. Exportable as ``.eml`` (RFC 5322).
"""

from __future__ import annotations

import textwrap
from datetime import datetime
from email.message import EmailMessage

from org2vec.models import ClaimMemoryObject


def draft_documents_request(
    cmo: ClaimMemoryObject,
    *,
    handler_name: str = "Claims Handler",
    handler_email: str = "claims@abbeygate.example",
    broker_email: str | None = None,
) -> str:
    """Render the documents-request body as plain text (Std emails template)."""
    if not cmo.missing_information:
        return _no_gaps_template(cmo, handler_name)

    items = []
    for gap in cmo.missing_information:
        items.append(f"  - {gap.document}: {gap.rationale}")
    items_block = "\n".join(items)

    broker = _detect_broker(cmo) or "Broker"
    return textwrap.dedent(
        f"""
        Subject: {cmo.claim_id} — documents required

        Dear {broker},

        Thank you for your notification. To progress claim {cmo.claim_id} we
        require the following items:

        {items_block}

        Pending receipt of the above we are reserving our position on
        liability. Where independent evidence is unavailable we will
        consider authorising repair on a without-prejudice basis once
        estimates have been validated.

        Kind regards,
        {handler_name}
        """
    ).strip() + "\n"


def to_eml_bytes(
    body: str,
    *,
    to_address: str,
    from_address: str = "claims@abbeygate.example",
    subject: str = "Documents required",
) -> bytes:
    """Wrap ``body`` into an RFC-5322 .eml the UI can offer for download."""
    msg = EmailMessage()
    msg["From"] = from_address
    msg["To"] = to_address
    msg["Subject"] = subject
    msg["Date"] = datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S +0000")
    msg.set_content(body)
    return msg.as_bytes()


def _no_gaps_template(cmo: ClaimMemoryObject, handler_name: str) -> str:
    broker = _detect_broker(cmo) or "Broker"
    return textwrap.dedent(
        f"""
        Subject: {cmo.claim_id} — file complete

        Dear {broker},

        Thank you. The documents on claim {cmo.claim_id} appear complete.
        We will proceed in line with the operations manual.

        Kind regards,
        {handler_name}
        """
    ).strip() + "\n"


def _detect_broker(cmo: ClaimMemoryObject) -> str | None:
    for e in cmo.entities:
        if e.kind == "broker":
            return e.value
    # Fall back to the first non-handler sender.
    for m in cmo.messages:
        if "handler" not in m.sender.lower():
            return m.sender
    return None

"""Provider-agnostic filter shape.

The UI offers one filter form. Both Microsoft Graph and Gmail consume it via
the helpers below. Adding a new connector means adding a new adapter here, not
changing the UI or the pipeline.
"""

from __future__ import annotations

from datetime import date, datetime
from urllib.parse import quote

from org2vec.models import Filter


def _iso(d: date | datetime | None) -> str | None:
    if d is None:
        return None
    if isinstance(d, datetime):
        return d.date().isoformat() + "T00:00:00Z"
    return d.isoformat() + "T00:00:00Z"


def to_graph_odata(f: Filter) -> dict[str, str]:
    """Produce a Microsoft Graph ``$filter`` + ``$search`` query for /me/messages.

    Reference: https://learn.microsoft.com/graph/api/user-list-messages
    """
    clauses: list[str] = []
    if f.sender:
        clauses.append(f"from/emailAddress/address eq '{f.sender}'")
    elif f.sender_domain:
        clauses.append(
            f"endswith(from/emailAddress/address, '@{f.sender_domain}')"
        )
    if f.date_from:
        clauses.append(f"receivedDateTime ge {_iso(f.date_from)}")
    if f.date_to:
        clauses.append(f"receivedDateTime le {_iso(f.date_to)}")
    if f.has_attachment is not None:
        clauses.append(f"hasAttachments eq {'true' if f.has_attachment else 'false'}")

    params: dict[str, str] = {"$top": str(min(max(f.max_threads, 1), 100))}
    if clauses:
        params["$filter"] = " and ".join(clauses)
    if f.subject_contains:
        # $search needs a quoted KQL-style expression.
        params["$search"] = f'"{f.subject_contains}"'
    return params


def to_gmail_query(f: Filter) -> str:
    """Produce a Gmail ``q=`` query string.

    Reference: https://support.google.com/mail/answer/7190
    """
    parts: list[str] = []
    if f.sender:
        parts.append(f"from:{f.sender}")
    elif f.sender_domain:
        parts.append(f"from:@{f.sender_domain}")
    if f.subject_contains:
        parts.append(f'subject:"{f.subject_contains}"')
    if f.label:
        parts.append(f"label:{f.label}")
    if f.folder:
        # Gmail conflates labels and folders; allow either.
        parts.append(f"label:{f.folder}")
    if f.date_from:
        parts.append(f"after:{f.date_from.isoformat()}")
    if f.date_to:
        parts.append(f"before:{f.date_to.isoformat()}")
    if f.has_attachment:
        parts.append("has:attachment")
    return " ".join(parts)


def graph_url_with_filter(base: str, f: Filter) -> str:
    """Build the final Graph URL for /me/messages including encoded params."""
    params = to_graph_odata(f)
    query = "&".join(f"{k}={quote(v)}" for k, v in params.items())
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}{query}"

"""Microsoft 365 connector.

Uses MSAL's device-code flow (no callback dance — works from Streamlit). Pulls
messages from ``/me/messages`` with the user's filter, then groups them into
``Thread``s by ``conversationId``.

Required ``.env`` keys:

- ``MS_CLIENT_ID`` — Azure App Registration (public client / "Allow public
  client flows" enabled)
- ``MS_TENANT``    — usually ``common`` or your tenant id
- ``MS_SCOPES``    — comma-separated, defaults to ``Mail.Read,offline_access``

This is read-only. No admin consent required for personal-mailbox use. Admin
consent for shared mailboxes is a v0.3 backlog item.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import requests

from org2vec.connect.filters import to_graph_odata
from org2vec.ingest.parse import from_graph_messages
from org2vec.models import Filter, Thread

CACHE_PATH = Path(__file__).resolve().parents[3] / ".cache" / "msal_token.json"
GRAPH_BASE = "https://graph.microsoft.com/v1.0"


# ---------------------------------------------------------------------------
# Token acquisition (device-code).
# ---------------------------------------------------------------------------


def _msal_app():
    import msal  # imported lazily so demo can run without it

    client_id = os.environ.get("MS_CLIENT_ID", "").strip()
    if not client_id:
        raise RuntimeError("MS_CLIENT_ID is not set in .env")
    tenant = os.environ.get("MS_TENANT", "common").strip()
    authority = f"https://login.microsoftonline.com/{tenant}"
    cache = msal.SerializableTokenCache()
    if CACHE_PATH.exists():
        cache.deserialize(CACHE_PATH.read_text())
    app = msal.PublicClientApplication(client_id, authority=authority, token_cache=cache)
    return app, cache


def _scopes() -> list[str]:
    raw = os.environ.get("MS_SCOPES", "Mail.Read,offline_access")
    # offline_access is a reserved scope and is added by MSAL automatically.
    return [s.strip() for s in raw.split(",") if s.strip() and s.strip() != "offline_access"]


def get_token_silent() -> str | None:
    """Return a cached access token if one exists, else None."""
    try:
        app, _ = _msal_app()
    except RuntimeError:
        return None
    accounts = app.get_accounts()
    if not accounts:
        return None
    result = app.acquire_token_silent(_scopes(), account=accounts[0])
    if result and "access_token" in result:
        return result["access_token"]
    return None


def begin_device_flow() -> dict[str, Any]:
    """Start the device-code flow and return the flow dict.

    The caller (Streamlit) displays ``flow['message']`` to the user, who opens
    the URL on their phone / browser, enters the code, then we call
    ``complete_device_flow(flow)``.
    """
    app, _ = _msal_app()
    flow = app.initiate_device_flow(scopes=_scopes())
    if "user_code" not in flow:
        raise RuntimeError(f"Could not begin device-code flow: {flow}")
    return flow


def complete_device_flow(flow: dict[str, Any]) -> str:
    """Block until the user completes consent, return the access token."""
    app, cache = _msal_app()
    result = app.acquire_token_by_device_flow(flow)
    if "access_token" not in result:
        raise RuntimeError(f"Device-code flow failed: {result.get('error_description')}")
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(cache.serialize())
    return result["access_token"]


# ---------------------------------------------------------------------------
# Pull messages and convert into Threads.
# ---------------------------------------------------------------------------


def _list_messages(token: str, filt: Filter) -> Iterator[dict[str, Any]]:
    """Yield ``/me/messages`` items honouring the filter; pages via @odata.nextLink."""
    params = to_graph_odata(filt)
    url = f"{GRAPH_BASE}/me/messages"
    headers = {"Authorization": f"Bearer {token}", "ConsistencyLevel": "eventual"}
    fetched = 0
    next_url: str | None = url
    next_params: dict[str, str] | None = params
    while next_url and fetched < filt.max_threads * 25:  # cap defensive
        r = requests.get(next_url, headers=headers, params=next_params, timeout=30)
        r.raise_for_status()
        data = r.json()
        for it in data.get("value", []):
            yield it
            fetched += 1
        next_url = data.get("@odata.nextLink")
        next_params = None  # already encoded in next_url


def _hydrate_attachments(token: str, message_id: str) -> list[dict[str, Any]]:
    url = f"{GRAPH_BASE}/me/messages/{message_id}/attachments?$select=name,contentType,size"
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    if not r.ok:
        return []
    return r.json().get("value", [])


def pull_threads(token: str, filt: Filter, *, with_attachments: bool = True) -> list[Thread]:
    """Pull messages, group by ``conversationId``, return a list of ``Thread``."""
    by_conv: dict[str, list[dict[str, Any]]] = {}
    for it in _list_messages(token, filt):
        if with_attachments and it.get("hasAttachments"):
            it["attachments"] = _hydrate_attachments(token, it["id"])
        conv = it.get("conversationId") or it.get("id")
        by_conv.setdefault(conv, []).append(it)
        if len(by_conv) >= filt.max_threads and conv not in by_conv:
            break

    threads: list[Thread] = []
    for conv, items in by_conv.items():
        threads.append(from_graph_messages(conv, items))
    return threads


def status_for_ui() -> dict[str, Any]:
    """Diagnostics surface for the Streamlit Login screen."""
    return {
        "configured": bool(os.environ.get("MS_CLIENT_ID")),
        "cached_token": CACHE_PATH.exists(),
        "client_id": os.environ.get("MS_CLIENT_ID", "")[:8] + "…" if os.environ.get("MS_CLIENT_ID") else "",
        "tenant": os.environ.get("MS_TENANT", "common"),
        "cache_path": str(CACHE_PATH),
    }


def write_provider_payload(payload: dict, path: Path) -> None:
    """Helper for debugging — write the raw Graph payload to disk."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2))

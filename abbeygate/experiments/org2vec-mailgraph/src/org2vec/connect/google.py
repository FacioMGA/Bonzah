"""Google Workspace / Gmail connector.

Uses ``google_auth_oauthlib.InstalledAppFlow`` (loopback localhost callback).
Pulls threads via the Gmail API's ``users.threads.list`` + ``users.threads.get``,
which already returns one full conversation per call.

Required ``.env`` keys:

- ``GOOGLE_CLIENT_SECRETS_JSON`` — path to a Google OAuth desktop-client JSON
- ``GOOGLE_SCOPES``              — defaults to ``gmail.readonly``

Read-only, personal account. Workspace-wide domain-delegation is v0.3.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from org2vec.connect.filters import to_gmail_query
from org2vec.ingest.parse import from_gmail_thread
from org2vec.models import Filter, Thread

TOKEN_PATH = Path(__file__).resolve().parents[3] / ".cache" / "google_token.json"
DEFAULT_SECRETS = Path(__file__).resolve().parents[3] / ".cache" / "google_client_secret.json"


def _scopes() -> list[str]:
    raw = os.environ.get("GOOGLE_SCOPES", "https://www.googleapis.com/auth/gmail.readonly")
    return [s.strip() for s in raw.split(",") if s.strip()]


def _client_secrets_path() -> Path:
    p = Path(os.environ.get("GOOGLE_CLIENT_SECRETS_JSON", str(DEFAULT_SECRETS)))
    return p


# ---------------------------------------------------------------------------
# Credentials.
# ---------------------------------------------------------------------------


def get_creds_silent():
    """Return Google Credentials from disk cache, refreshing if needed. None if absent."""
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
    except ImportError:
        return None
    if not TOKEN_PATH.exists():
        return None
    creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), _scopes())
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        TOKEN_PATH.write_text(creds.to_json())
    return creds


def begin_installed_flow():
    """Block: open browser, complete consent, persist token. Return Credentials."""
    from google_auth_oauthlib.flow import InstalledAppFlow

    secrets = _client_secrets_path()
    if not secrets.exists():
        raise RuntimeError(
            f"Google client-secrets file not found at {secrets}. "
            "Create a Desktop OAuth client in Google Cloud Console and place its "
            "downloaded JSON there, or override with GOOGLE_CLIENT_SECRETS_JSON."
        )
    flow = InstalledAppFlow.from_client_secrets_file(str(secrets), _scopes())
    creds = flow.run_local_server(port=0, prompt="consent")
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_PATH.write_text(creds.to_json())
    return creds


# ---------------------------------------------------------------------------
# Pull threads.
# ---------------------------------------------------------------------------


def _gmail_service(creds):
    from googleapiclient.discovery import build

    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def pull_threads(creds, filt: Filter) -> list[Thread]:
    service = _gmail_service(creds)
    q = to_gmail_query(filt)
    resp = (
        service.users()
        .threads()
        .list(userId="me", q=q, maxResults=min(max(filt.max_threads, 1), 100))
        .execute()
    )
    ids = [t["id"] for t in resp.get("threads", []) or []]
    threads: list[Thread] = []
    for tid in ids:
        full = service.users().threads().get(userId="me", id=tid, format="full").execute()
        threads.append(from_gmail_thread(full))
    return threads


def status_for_ui() -> dict[str, Any]:
    return {
        "configured": _client_secrets_path().exists(),
        "cached_token": TOKEN_PATH.exists(),
        "secrets_path": str(_client_secrets_path()),
        "token_path": str(TOKEN_PATH),
    }


def write_provider_payload(payload: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2))

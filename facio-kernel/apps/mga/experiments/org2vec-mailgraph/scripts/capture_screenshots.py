"""One-shot Streamlit screenshot capture for the assignment appendix.

Boots a headless Streamlit, drives the UI with Playwright through the
five demo states, saves PNGs to ``artifacts/screenshots/``.

Run:

    pip install playwright && playwright install chromium
    python3 scripts/capture_screenshots.py

Idempotent. After the first run the LLM disk cache is populated and re-runs
take ~30 seconds. The first run takes ~3 minutes because all 19 threads must
be extracted once.
"""

from __future__ import annotations

import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import urllib.request
from urllib.error import URLError

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "artifacts" / "screenshots"
PORT = 8765
VIEWPORT = {"width": 1680, "height": 1050}


# ---------------------------------------------------------------------------
# Streamlit lifecycle.
# ---------------------------------------------------------------------------


def _free_port() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", PORT)) != 0


def _start_streamlit() -> subprocess.Popen:
    if not _free_port():
        sys.exit(f"port {PORT} is in use; close the previous streamlit first")
    streamlit = shutil.which("streamlit") or "streamlit"
    proc = subprocess.Popen(
        [
            streamlit,
            "run",
            "app.py",
            "--server.headless=true",
            f"--server.port={PORT}",
            "--browser.gatherUsageStats=false",
            "--server.runOnSave=false",
            "--server.fileWatcherType=none",
        ],
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    return proc


def _wait_ready(timeout: int = 60) -> None:
    deadline = time.time() + timeout
    url = f"http://127.0.0.1:{PORT}/_stcore/health"
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as r:
                if r.status == 200:
                    return
        except (URLError, ConnectionRefusedError, OSError):
            pass
        time.sleep(0.5)
    raise RuntimeError("streamlit failed to start within the timeout")


# ---------------------------------------------------------------------------
# Capture script.
# ---------------------------------------------------------------------------


def _shot(page, name: str, *, full_page: bool = False) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    target = SHOTS / name
    page.screenshot(path=str(target), full_page=full_page)
    print(f"  ok  {target.relative_to(ROOT)}")


def _wait_for_text(page, needle: str, *, timeout: int = 30_000) -> None:
    """Wait for any element whose text contains ``needle``.

    Streamlit wraps headings in custom emotion-cache divs whose exact
    structure changes between releases; a free-text wait is more reliable
    than a heading-tag selector.
    """
    try:
        page.locator(f"text={needle}").first.wait_for(timeout=timeout)
    except Exception:
        debug = SHOTS / f"DEBUG-no-text-{needle.replace(' ', '_')}.png"
        SHOTS.mkdir(parents=True, exist_ok=True)
        try:
            page.screenshot(path=str(debug), full_page=True)
            print(f"  debug: wrote {debug.name}")
        except Exception:
            pass
        raise


def _open_claim(page, claim_id: str) -> None:
    """Drive the Claim List dropdown to pick a claim_id and click Open.

    Streamlit selectboxes are searchable: focus the trigger, type the claim
    id, then press Enter. This is much more reliable than clicking an LI in a
    virtualised dropdown of 19 options.
    """
    select_trigger = page.locator('div[data-baseweb="select"]').first
    select_trigger.click()
    page.keyboard.type(claim_id)
    page.wait_for_timeout(400)
    page.keyboard.press("Enter")
    page.wait_for_timeout(400)
    page.locator(f'button:has-text("Open {claim_id}")').click()
    _wait_for_text(page, f"Claim {claim_id}", timeout=45_000)
    page.wait_for_timeout(5_000)  # LLM cards may need a beat to render


def _safe(label: str, fn) -> None:
    try:
        fn()
    except Exception as exc:  # noqa: BLE001
        print(f"  !! {label}: {exc}")


def run() -> None:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport=VIEWPORT)
        page = context.new_page()
        page.set_default_timeout(60_000)
        page.goto(f"http://127.0.0.1:{PORT}", wait_until="networkidle")

        # ---------------- 00-login.png (the three-doors moment)
        page.locator('button:has-text("Use sample inbox")').wait_for()
        _shot(page, "00-login.png", full_page=True)

        # ---------------- 01-ingestion.png (progress stream)
        page.locator('button:has-text("Use sample inbox")').click()
        page.locator('button:has-text("Ingest")').wait_for()
        page.locator('button:has-text("Ingest")').first.click()
        # Wait for completion banner (first-time can take a couple of minutes
        # because every thread is extracted via the LLM).
        page.locator('button:has-text("Open claim list")').wait_for(
            timeout=300_000
        )
        # Scroll to top so the login/ingest stitch reads naturally.
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(800)
        _shot(page, "01-ingestion.png", full_page=True)
        page.locator('button:has-text("Open claim list")').click()

        # ---------------- Workspace for ABB/VL/00112 (the GESY claim)
        # The Claim List screen is identified by its "sorted by risk" caption,
        # which is unique to this screen.
        _wait_for_text(page, "sorted by risk", timeout=30_000)
        page.wait_for_timeout(500)
        _open_claim(page, "ABB/VL/00112")

        # 02-workspace.png — full three-column layout for the GESY claim
        _shot(page, "02-workspace.png", full_page=True)

        # 03-copilot-detail.png — scroll the right-column co-pilot into focus
        # and take a full page screenshot. The reader crops if they want.
        page.evaluate(
            "Array.from(document.querySelectorAll('h3,strong,p')).find("
            "el => el.textContent && el.textContent.includes("
            "'org2vec Co-Pilot'))?.scrollIntoView({block:'start'});"
        )
        page.wait_for_timeout(800)
        _shot(page, "03-copilot-detail.png", full_page=False)

        # 05-compare-modes.png — overlay panel
        page.evaluate("window.scrollTo(0, 0)")
        page.locator('button:has-text("Compare modes")').click()
        page.locator('button:has-text("Run all three")').wait_for()
        page.locator('button:has-text("Run all three")').click()
        # Three live RAG calls (chatgpt_only / manual_rag / mailgraph).
        # Wait until the three mode labels show up, which only happens after
        # all three answers have rendered.
        try:
            page.locator('text=ChatGPT only').wait_for(timeout=120_000)
            page.locator('text=Manual RAG').wait_for(timeout=120_000)
            page.locator('text=MailGraph RAG').wait_for(timeout=120_000)
        except Exception:
            pass
        page.wait_for_timeout(1500)
        page.evaluate("window.scrollTo(0, 200)")
        page.wait_for_timeout(500)
        _shot(page, "05-compare-modes.png", full_page=True)

        # ---------------- Workspace for CY-MTR-017 (Similar Claims headline)
        page.locator('button:has-text("Claim list")').first.click()
        _wait_for_text(page, "sorted by risk", timeout=30_000)
        page.wait_for_timeout(500)
        _open_claim(page, "CY-MTR-017")

        # 04-similar-claims.png — scroll to similar-claims card
        page.evaluate(
            "Array.from(document.querySelectorAll('p,strong,span')).find("
            "el => el.textContent && el.textContent.includes("
            "'Similar Historical Claims'))?.scrollIntoView({block:'center'});"
        )
        page.wait_for_timeout(500)
        _shot(page, "04-similar-claims.png", full_page=True)

        browser.close()


def main() -> int:
    print(f"== capturing screenshots to {SHOTS.relative_to(ROOT)} ==")
    proc = _start_streamlit()
    try:
        _wait_ready()
        print(f"  streamlit ready on :{PORT}")
        run()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    print("done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

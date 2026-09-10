"""org2vec MailGraph — Claim Workspace co-pilot.

Streamlit entrypoint. Four screens map 1:1 to the demo flow:

    1. Login         -> Connect Microsoft 365 / Google / Use sample inbox
    2. Ingest        -> filters + live progress stream
    3. Claim list    -> sorted by risk
    4. Claim Workspace
       left:   raw email thread evidence
       center: extracted timeline
       right:  six co-pilot cards (missing, authority, liability,
               actions, similar, draft reply)

Run:  ``streamlit run app.py``
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

import pandas as pd  # noqa: E402
import streamlit as st  # noqa: E402

from org2vec.ingest.pipeline import IngestResult, run  # noqa: E402
from org2vec.llm.client import provider_label  # noqa: E402
from org2vec.memory.reply import draft_documents_request, to_eml_bytes  # noqa: E402
from org2vec.models import ClaimMemoryObject, Filter  # noqa: E402

st.set_page_config(
    page_title="org2vec MailGraph — Claim Workspace",
    page_icon=":mailbox:",
    layout="wide",
)

SCREEN_LOGIN = "login"
SCREEN_INGEST = "ingest"
SCREEN_CLAIMS = "claims"
SCREEN_WORKSPACE = "workspace"


def _init_state() -> None:
    ss = st.session_state
    ss.setdefault("screen", SCREEN_LOGIN)
    ss.setdefault("source", None)
    ss.setdefault("result", None)
    ss.setdefault("selected_claim", None)
    ss.setdefault("compare_open", False)


def _goto(screen: str) -> None:
    st.session_state.screen = screen
    st.rerun()


# ---------------------------------------------------------------------------
# Screen 1 — Login
# ---------------------------------------------------------------------------


def screen_login() -> None:
    st.title("org2vec MailGraph")
    st.caption(
        "Claims-email-native institutional memory. "
        "Connect a mailbox, or use the sample inbox to run the demo offline."
    )

    cols = st.columns(3)
    with cols[0]:
        st.subheader("Microsoft 365")
        st.caption("MSAL device-code flow. Read-only.")
        if st.button("Connect Microsoft 365", use_container_width=True):
            try:
                from org2vec.connect.microsoft import begin_device_flow

                flow = begin_device_flow()
                st.session_state["ms_flow"] = flow
                st.info(flow["message"])
                st.session_state["source"] = "microsoft"
            except Exception as exc:  # noqa: BLE001
                st.error(f"Microsoft connect unavailable: {exc}")
        if "ms_flow" in st.session_state:
            if st.button("I have completed consent", use_container_width=True):
                try:
                    from org2vec.connect.microsoft import complete_device_flow

                    complete_device_flow(st.session_state["ms_flow"])
                    del st.session_state["ms_flow"]
                    st.session_state["source"] = "microsoft"
                    _goto(SCREEN_INGEST)
                except Exception as exc:  # noqa: BLE001
                    st.error(f"Token exchange failed: {exc}")

    with cols[1]:
        st.subheader("Google")
        st.caption("InstalledAppFlow loopback. Read-only.")
        if st.button("Connect Google", use_container_width=True):
            try:
                from org2vec.connect.google import begin_installed_flow

                begin_installed_flow()
                st.session_state["source"] = "google"
                _goto(SCREEN_INGEST)
            except Exception as exc:  # noqa: BLE001
                st.error(f"Google connect unavailable: {exc}")

    with cols[2]:
        st.subheader("Sample inbox")
        st.caption(
            "Demo safety-net. Loads 19 synthesized threads modelled on real "
            "Abbeygate templates (incl. ABB/VL/ + GESY)."
        )
        if st.button("Use sample inbox", type="primary", use_container_width=True):
            st.session_state["source"] = "sample"
            _goto(SCREEN_INGEST)

    st.divider()
    st.subheader("Or: upload .eml / .txt files")
    st.caption(
        "Drop one or more email files exported from Outlook / Apple Mail / "
        "anywhere — or the corpus .txt format. Files are parsed locally and "
        "fed into the same pipeline. No OAuth required."
    )
    uploaded = st.file_uploader(
        "Upload thread files",
        type=["eml", "txt"],
        accept_multiple_files=True,
        label_visibility="collapsed",
    )
    if uploaded:
        st.session_state["uploads"] = [(f.name, f.getvalue()) for f in uploaded]
        st.success(f"Ready: {len(uploaded)} file(s) staged for ingest.")
        if st.button(
            f"Ingest {len(uploaded)} uploaded file(s) →",
            type="primary",
            use_container_width=True,
        ):
            st.session_state["source"] = "upload"
            _goto(SCREEN_INGEST)

    with st.expander("Diagnostics"):
        from org2vec.connect import google as g
        from org2vec.connect import microsoft as ms

        st.write("LLM provider:", provider_label())
        st.write("Microsoft 365:", ms.status_for_ui())
        st.write("Google:", g.status_for_ui())


# ---------------------------------------------------------------------------
# Screen 2 — Ingest with live progress stream
# ---------------------------------------------------------------------------


def screen_ingest() -> None:
    st.title("Ingest")
    source = st.session_state["source"]
    st.caption(f"Source: **{source}**")

    # If a previous ingestion has already populated the result (this run or
    # any prior run in the same Streamlit session), skip the form and offer
    # to open the claim list directly. Without this, clicking
    # "Open claim list →" re-runs the script with submitted=False and the
    # button is lost.
    existing = st.session_state.get("result")
    if existing is not None:
        st.success(
            f"Last ingestion: {len(existing.threads)} threads → "
            f"{len(existing.memory)} claims."
        )
        c1, c2 = st.columns(2)
        with c1:
            if st.button("Open claim list →", type="primary", use_container_width=True):
                _goto(SCREEN_CLAIMS)
        with c2:
            if st.button("Re-ingest", use_container_width=True):
                del st.session_state["result"]
                st.rerun()
        return

    with st.form("filters"):
        c1, c2, c3 = st.columns(3)
        with c1:
            sender = st.text_input("Sender (email)", "")
            sender_domain = st.text_input("Sender domain", "")
        with c2:
            subject = st.text_input("Subject contains", "claim" if source != "sample" else "")
            label = st.text_input("Folder / label", "")
        with c3:
            from datetime import date

            d1 = st.date_input("From", value=None, format="YYYY-MM-DD", key="d1")
            d2 = st.date_input("To", value=None, format="YYYY-MM-DD", key="d2")
            has_att = st.selectbox("Has attachment", ["", "yes", "no"], index=0)
            max_threads = st.number_input("Max threads", 5, 200, 25)
        submitted = st.form_submit_button("Ingest", type="primary", use_container_width=True)

    if not submitted:
        if st.button("← Back to login"):
            _goto(SCREEN_LOGIN)
        return

    filt = Filter(
        sender=sender or None,
        sender_domain=sender_domain or None,
        subject_contains=subject or None,
        folder=label or None,
        date_from=d1 if isinstance(d1, date) and d1 else None,
        date_to=d2 if isinstance(d2, date) and d2 else None,
        has_attachment={"yes": True, "no": False, "": None}[has_att],
        max_threads=int(max_threads),
    )

    progress = st.progress(0.0)
    status = st.empty()
    log_box = st.container()
    log_lines: list[str] = []

    with st.spinner("Running pipeline..."):
        result: IngestResult | None = None
        try:
            run_kwargs: dict = {"source": source, "filter": filt}
            if source == "upload":
                run_kwargs["uploads"] = st.session_state.get("uploads", [])
            for ev in run(**run_kwargs):
                if isinstance(ev, IngestResult):
                    result = ev
                    continue
                progress.progress(min(1.0, ev.progress))
                status.write(f"**{ev.stage}** — {ev.message}")
                log_lines.append(f"`{ev.stage}` {ev.message}")
                with log_box:
                    st.markdown("\n".join(f"- {line}" for line in log_lines[-12:]))
        except Exception as exc:  # noqa: BLE001
            st.error(f"Ingestion failed: {exc}")
            return

    if result is None:
        st.error("Pipeline produced no result.")
        return

    st.session_state["result"] = result
    progress.progress(1.0)
    status.success(
        f"Ingested {len(result.threads)} threads → {len(result.memory)} claims."
    )
    # Re-render so the persistent post-ingest block at the top of this
    # function picks up — that block owns the "Open claim list →" button
    # and survives Streamlit's widget-correlation behaviour across reruns.
    st.rerun()


# ---------------------------------------------------------------------------
# Screen 3 — Claim list (sorted by risk)
# ---------------------------------------------------------------------------


def screen_claims() -> None:
    result: IngestResult = st.session_state["result"]
    st.title("Claim list")
    st.caption(f"{len(result.memory)} claims, sorted by risk")

    rows = []
    for c in result.memory:
        risk_score = (
            2 * len(c.authority_flags)
            + len(c.missing_information)
            + sum(1 for f in c.authority_flags if f.kind.endswith("authority"))
        )
        next_action = c.recommended_actions[0].action[:60] if c.recommended_actions else ""
        rows.append(
            {
                "claim_id": c.claim_id,
                "threads": len(c.threads),
                "last_message_at": c.last_message_at.isoformat() if c.last_message_at else "",
                "open_gaps": c.open_gaps,
                "authority_flag": ", ".join(sorted({f.kind for f in c.authority_flags})),
                "next_action": next_action,
                "_risk": risk_score,
            }
        )
    df = pd.DataFrame(rows).sort_values("_risk", ascending=False).drop(columns=["_risk"])
    st.dataframe(df, use_container_width=True, hide_index=True)

    options = sorted(c.claim_id for c in result.memory)
    pick = st.selectbox("Open claim", options, index=options.index("CY-MTR-017") if "CY-MTR-017" in options else 0)
    if st.button(f"Open {pick} →", type="primary"):
        st.session_state["selected_claim"] = pick
        _goto(SCREEN_WORKSPACE)
    if st.button("← Back to ingest"):
        _goto(SCREEN_INGEST)


# ---------------------------------------------------------------------------
# Screen 4 — Claim Workspace
# ---------------------------------------------------------------------------


def screen_workspace() -> None:
    result: IngestResult = st.session_state["result"]
    claim_id = st.session_state["selected_claim"]
    cmo: ClaimMemoryObject | None = result.by_claim.get(claim_id)
    if cmo is None:
        st.error(f"Unknown claim {claim_id!r}")
        if st.button("← Back to claim list"):
            _goto(SCREEN_CLAIMS)
        return

    top = st.columns([3, 1, 1])
    with top[0]:
        st.title(f"Claim {cmo.claim_id}")
        if cmo.last_message_at:
            langs = sorted({t.language for t in cmo.threads if t.language != "unknown"})
            juris = sorted({t.jurisdiction for t in cmo.threads if t.jurisdiction != "unknown"})
            lloyds = sorted({r for t in cmo.threads for r in t.lloyds_refs})
            tags: list[str] = []
            if langs:
                tags.append("lang: " + "/".join(langs))
            if juris:
                tags.append("juris: " + "/".join(juris))
            if lloyds:
                tags.append("Lloyd's: " + "/".join(lloyds[:2]))
            tag_str = " · ".join(tags)
            st.caption(
                f"{len(cmo.threads)} thread(s) · {len(cmo.messages)} messages · "
                f"last activity {cmo.last_message_at.isoformat()}"
                + (f" · {tag_str}" if tag_str else "")
            )
    with top[1]:
        if st.button("← Claim list", use_container_width=True):
            _goto(SCREEN_CLAIMS)
    with top[2]:
        if st.button("Compare modes ▾", use_container_width=True):
            st.session_state["compare_open"] = not st.session_state["compare_open"]

    if st.session_state["compare_open"]:
        _render_compare_panel(cmo)

    left, center, right = st.columns([2, 2, 3])

    # ----- Left: evidence
    with left:
        st.subheader("Evidence (email thread)")
        for t in cmo.threads:
            st.markdown(f"**Thread `{t.thread_id}`** — {t.subject}")
            for m in t.messages:
                with st.expander(
                    f"`{m.message_id}` · {m.message_type} · {m.sender} · "
                    f"{m.sent_at.isoformat() if m.sent_at else '?'}"
                ):
                    st.caption(f"Subject: {m.subject}")
                    if m.attachments:
                        st.caption("Attachments: " + ", ".join(a.filename for a in m.attachments))
                    st.code(m.body, language="text")

    # ----- Center: timeline
    with center:
        st.subheader("Timeline (extracted)")
        if not cmo.timeline:
            st.info(
                "No LLM-extracted events yet. Configure AZURE_OPENAI_API_KEY "
                "or OPENAI_API_KEY in `.env` and re-ingest."
            )
        for ev in cmo.timeline:
            badge = _event_badge(ev.type)
            line = f"{badge} **{ev.type}**"
            if ev.date:
                line += f" · {ev.date.isoformat()}"
            if ev.amount:
                line += f" · €{ev.amount:,.0f}"
            st.markdown(line)
            st.caption(ev.summary)
            st.caption(f"↪ {ev.citation.thread_id}/{ev.citation.message_id}: {ev.citation.quote[:100]}")
            st.divider()

        st.subheader("Entities")
        ent_rows = [{"kind": e.kind, "value": e.value} for e in cmo.entities]
        if ent_rows:
            st.dataframe(pd.DataFrame(ent_rows), hide_index=True, use_container_width=True)

    # ----- Right: co-pilot cards
    with right:
        st.subheader("org2vec Co-Pilot")
        _card_missing(cmo)
        _card_authority(cmo)
        _card_liability(cmo)
        _card_actions(cmo)
        _card_similar(cmo)
        _card_draft_reply(cmo)


def _event_badge(kind: str) -> str:
    return {
        "FNOL": ":blue[FNOL]",
        "doc_request": ":orange[DOC]",
        "estimate_received": ":green[EST]",
        "liability_position": ":violet[LIA]",
        "escalation": ":red[ESC]",
        "payment": ":green[PAY]",
        "closure": ":gray[CLO]",
        "complaint": ":red[CPL]",
        "chase": ":orange[CHA]",
    }.get(kind, f":gray[{kind[:3].upper()}]")


def _card_missing(cmo: ClaimMemoryObject) -> None:
    with st.container(border=True):
        st.markdown("**1. Missing Information**")
        if not cmo.missing_information:
            st.caption("No missing items detected.")
        for gap in cmo.missing_information:
            received = "✅" if gap.received else "❌"
            st.markdown(f"{received} **{gap.document}** — {gap.rationale}")
            st.caption(
                f"↪ {gap.citation.thread_id}/{gap.citation.message_id}: {gap.citation.quote[:100]}"
            )


def _card_authority(cmo: ClaimMemoryObject) -> None:
    with st.container(border=True):
        st.markdown("**2. Authority Flags**")
        if not cmo.authority_flags:
            st.caption("Within delegated authority.")
        for f in cmo.authority_flags:
            obs = f"observed €{f.observed:,.0f}" if f.observed else ""
            thr = f"threshold €{f.threshold:,.0f}" if f.threshold else ""
            extra = " · ".join([x for x in (obs, thr) if x])
            st.markdown(f"🚩 **{f.kind}** {extra}")
            st.caption(f.rationale)
            st.caption(f"↪ {f.citation.thread_id}/{f.citation.message_id}: {f.citation.quote[:100]}")


def _card_liability(cmo: ClaimMemoryObject) -> None:
    with st.container(border=True):
        st.markdown("**3. Liability / Rejection Points**")
        if not cmo.liability_positions:
            st.caption("No formal liability position recorded.")
        for l in cmo.liability_positions:
            st.markdown(f"⚖️ **{l.posture.upper()}** — {l.rationale}")
            st.caption(f"↪ {l.citation.thread_id}/{l.citation.message_id}: {l.citation.quote[:100]}")


def _card_actions(cmo: ClaimMemoryObject) -> None:
    with st.container(border=True):
        st.markdown("**4. Recommended Next Action**")
        if not cmo.recommended_actions:
            st.caption("No actions recommended.")
        for a in cmo.recommended_actions[:5]:
            prio = {"low": "🟢", "medium": "🟡", "high": "🔴"}[a.priority]
            st.markdown(f"{prio} **{a.action}**")
            st.caption(a.rationale)
            st.caption(f"↪ {a.citation.thread_id}/{a.citation.message_id}: {a.citation.quote[:100]}")


def _card_similar(cmo: ClaimMemoryObject) -> None:
    with st.container(border=True):
        st.markdown("**5. Similar Historical Claims**")
        if not cmo.similar_claims:
            st.caption("No similar claims found in current memory.")
        for s in cmo.similar_claims:
            st.markdown(f"🔗 **{s.claim_id}** (score {s.score:.2f})")
            st.caption(s.why)


def _card_draft_reply(cmo: ClaimMemoryObject) -> None:
    with st.container(border=True):
        st.markdown("**6. Draft Email (approved template)**")
        body = draft_documents_request(cmo)
        st.code(body, language="text")
        eml = to_eml_bytes(body, to_address="broker@example.com", subject=f"{cmo.claim_id} — documents required")
        st.download_button(
            "Download .eml",
            data=eml,
            file_name=f"{cmo.claim_id}-documents-request.eml",
            mime="message/rfc822",
            use_container_width=True,
        )


# ---------------------------------------------------------------------------
# Compare modes panel (rubric weapon)
# ---------------------------------------------------------------------------


def _render_compare_panel(cmo: ClaimMemoryObject) -> None:
    st.markdown("---")
    st.subheader("Compare modes (rubric panel)")
    question = (
        "Review this submitted claim file. What information gaps remain, what "
        "parts of the claim may be rejected or reserved, and what should the "
        "handler do next?"
    )
    st.caption(f"Question: {question}")

    cols = st.columns(3)
    titles = ["ChatGPT only", "Manual RAG", "MailGraph RAG"]
    modes = ["chatgpt_only", "manual_rag", "mailgraph"]
    if st.button("Run all three", key="run-three"):
        try:
            from org2vec.rag.compose import answer
            from org2vec.retrieve.hybrid import HybridRetriever

            result = st.session_state["result"]
            retriever = HybridRetriever(result.store, graph=result.graph)
            outputs: dict[str, dict] = {}
            for mode in modes:
                a = answer(
                    mode=mode, question=question, claim_id=cmo.claim_id,
                    thread_id=cmo.threads[0].thread_id if cmo.threads else None,
                    retriever=retriever,
                )
                outputs[mode] = a.model_dump()
            for col, mode, title in zip(cols, modes, titles):
                with col:
                    st.markdown(f"**{title}**")
                    a = outputs[mode]
                    st.caption(
                        f"gaps {len(a.get('missing_information', []))} · "
                        f"flags {len(a.get('authority_flags', []))} · "
                        f"actions {len(a.get('recommended_next_actions', []))}"
                    )
                    # Compact summary first, then collapsible full JSON.
                    if a.get("authority_flags"):
                        for f in a["authority_flags"]:
                            badge = f.get("kind", "?")
                            code = f.get("endorsement_code")
                            st.markdown(
                                f"🚩 **{badge}**"
                                + (f" `{code}`" if code else "")
                            )
                    if a.get("missing_information"):
                        for g in a["missing_information"][:5]:
                            st.markdown(f"❌ {g.get('document', '?')}")
                    st.json(a, expanded=False)
        except Exception as exc:  # noqa: BLE001
            st.error(f"Compare-modes failed: {exc}")


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------


def main() -> None:
    _init_state()
    screen = st.session_state["screen"]
    if screen == SCREEN_LOGIN:
        screen_login()
    elif screen == SCREEN_INGEST:
        screen_ingest()
    elif screen == SCREEN_CLAIMS:
        screen_claims()
    elif screen == SCREEN_WORKSPACE:
        screen_workspace()
    else:  # pragma: no cover
        st.error(f"Unknown screen {screen!r}")
        _goto(SCREEN_LOGIN)


main()

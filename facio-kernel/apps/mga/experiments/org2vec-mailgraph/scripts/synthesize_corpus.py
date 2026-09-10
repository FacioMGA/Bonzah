"""Synthesize the 15-thread corpus + matching gold labels.

Threads are modelled on real Abbeygate operational artifacts (Std emails for claims,
Motor Claims Operations Manual, TP Claims Workflow, Cyprus DCA agreement) but
contain no real personal data. Re-running this script reproduces byte-identical
threads and gold files.

Run:

    python scripts/synthesize_corpus.py
"""

from __future__ import annotations

import json
import textwrap
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "corpus"
THREADS = CORPUS / "threads"
GOLD = CORPUS / "gold"

# Authority threshold used across the corpus, matching the Cyprus DCA agreement
# (LMA9188) settlement authority. Synthetic but realistic.
AUTHORITY_LIMIT_EUR = 25000.0


@dataclass
class Msg:
    sender: str
    sender_email: str
    recipients: str
    date: str  # ISO yyyy-mm-dd HH:MM
    subject: str
    body: str
    attachments: list[str] = field(default_factory=list)


@dataclass
class Thread:
    thread_id: str
    claim_ref: str
    subject: str
    messages: list[Msg]
    gold: dict


def _fmt(msg: Msg) -> str:
    atts = ""
    if msg.attachments:
        atts = "Attachments: " + ", ".join(msg.attachments) + "\n"
    body = textwrap.dedent(msg.body).strip()
    return (
        f"From: {msg.sender} <{msg.sender_email}>\n"
        f"To: {msg.recipients}\n"
        f"Date: {msg.date}\n"
        f"Subject: {msg.subject}\n"
        f"{atts}\n"
        f"{body}\n"
    )


def _write(thread: Thread) -> None:
    THREADS.mkdir(parents=True, exist_ok=True)
    GOLD.mkdir(parents=True, exist_ok=True)
    body = ("\n---\n").join(_fmt(m) for m in thread.messages)
    header = (
        f"Thread-ID: {thread.thread_id}\n"
        f"Claim-Ref: {thread.claim_ref}\n"
        f"Subject: {thread.subject}\n"
        "===\n\n"
    )
    (THREADS / f"{thread.thread_id}.txt").write_text(header + body)
    gold = {"thread_id": thread.thread_id, "claim_ref": thread.claim_ref, **thread.gold}
    (GOLD / f"{thread.thread_id}.json").write_text(json.dumps(gold, indent=2))


# ---------------------------------------------------------------------------
# The 15 threads.
# ---------------------------------------------------------------------------


THREADS_DATA: list[Thread] = [
    # ------------------------------------------------------------------ controls
    Thread(
        thread_id="CY-MTR-001",
        claim_ref="CY-MTR-001",
        subject="FNOL CY-MTR-001 — minor parking damage",
        messages=[
            Msg(
                "Anna Brokerson",
                "anna@cyprusbrokers.example",
                "claims@abbeygate.example",
                "2026-01-03 09:14",
                "FNOL CY-MTR-001",
                """
                Dear Claims Team,

                Please find attached the completed motor claim form for our insured
                Maria K., policy ABMTR-100021, reg AKR-1142.

                Incident: 02 Jan 2026, parked vehicle scratched in a Larnaca car park.
                No third party identified, no injuries. Insured will obtain two
                estimates from approved repairers.

                Kind regards,
                Anna
                """,
                attachments=["motor_claim_form.pdf", "photos.zip"],
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "anna@cyprusbrokers.example",
                "2026-01-03 11:42",
                "RE: FNOL CY-MTR-001",
                """
                Anna,

                Acknowledged. Claim opened as CY-MTR-001. Liability accepted (own damage,
                no TP). Please share the two estimates when received.

                Regards,
                George
                """,
            ),
            Msg(
                "Anna Brokerson",
                "anna@cyprusbrokers.example",
                "claims@abbeygate.example",
                "2026-01-08 15:02",
                "RE: FNOL CY-MTR-001 — estimates",
                """
                George,

                Two estimates attached. Lower is €820 from Volante Approved Repairer.

                Anna
                """,
                attachments=["estimate_volante.pdf", "estimate_panelpro.pdf"],
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "anna@cyprusbrokers.example",
                "2026-01-09 10:11",
                "RE: FNOL CY-MTR-001 — authorised",
                """
                Anna,

                €820 authorised. Excess €250 confirmed. Settlement on completion.

                George
                """,
            ),
        ],
        gold={
            "gold_missing_documents": [],
            "gold_authority_flags": [],
            "gold_decision_posture": "accepted",
            "gold_key_events": ["FNOL", "estimate_received", "payment"],
            "gold_similar_threads": [],
            "scenario": "control_clean",
        },
    ),
    Thread(
        thread_id="CY-MTR-002",
        claim_ref="CY-MTR-002",
        subject="Windscreen replacement CY-MTR-002",
        messages=[
            Msg(
                "Insured",
                "k.papas@example.cy",
                "claims@abbeygate.example",
                "2026-02-11 08:00",
                "Windscreen chip — claim",
                """
                Hello, my windscreen has a chip from a stone on the highway. Policy
                ABMTR-100044. Vehicle YBT-2200. Please advise.
                """,
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "k.papas@example.cy",
                "2026-02-11 09:05",
                "RE: Windscreen — claim CY-MTR-002",
                """
                Kostas,

                Windscreen cover applies under your policy. Please attend approved
                glazier Autoglass Cy and quote claim CY-MTR-002. No excess.

                Regards.
                """,
            ),
            Msg(
                "Autoglass Cy",
                "billing@autoglass.example",
                "claims@abbeygate.example",
                "2026-02-13 17:30",
                "Invoice CY-MTR-002",
                """
                Invoice attached. €185 incl. VAT. Replacement completed 13/02.
                """,
                attachments=["invoice_188453.pdf"],
            ),
        ],
        gold={
            "gold_missing_documents": [],
            "gold_authority_flags": [],
            "gold_decision_posture": "accepted",
            "gold_key_events": ["FNOL", "payment"],
            "gold_similar_threads": [],
            "scenario": "control_clean",
        },
    ),
    Thread(
        thread_id="CY-MTR-003",
        claim_ref="CY-MTR-003",
        subject="CY-MTR-003 — closure confirmation",
        messages=[
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "anna@cyprusbrokers.example",
                "2026-03-20 12:00",
                "CY-MTR-003 closed",
                """
                Anna, CY-MTR-003 closed today. Final paid €1,420. Excess €250 retained.
                """,
            ),
            Msg(
                "Anna Brokerson",
                "anna@cyprusbrokers.example",
                "claims@abbeygate.example",
                "2026-03-20 12:30",
                "RE: CY-MTR-003 closed",
                """
                Noted, thanks George.
                """,
            ),
        ],
        gold={
            "gold_missing_documents": [],
            "gold_authority_flags": [],
            "gold_decision_posture": "accepted",
            "gold_key_events": ["payment", "closure"],
            "gold_similar_threads": [],
            "scenario": "control_clean",
        },
    ),
    # ------------------------------------------------------------------ liability reserved + no witness
    Thread(
        thread_id="CY-MTR-004",
        claim_ref="CY-MTR-004",
        subject="Reversing collision CY-MTR-004 — liability disputed",
        messages=[
            Msg(
                "Demetris Broker",
                "d@brokerbros.example",
                "claims@abbeygate.example",
                "2026-01-15 10:11",
                "FNOL CY-MTR-004",
                """
                Dear Claims,

                Reversing incident in supermarket car park, Limassol. Our insured
                (policy ABMTR-100119, reg XKL-9082) says the TP reversed into them.
                TP says the opposite. No witnesses. Photos attached.

                Police were not called. Estimate to follow.
                """,
                attachments=["photos.zip"],
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "d@brokerbros.example",
                "2026-01-15 14:30",
                "RE: FNOL CY-MTR-004 — liability reserved",
                """
                Demetris,

                Without independent evidence we will reserve liability pending TP
                insurer position. Please request the TP insurer details and any
                CCTV the car park may hold.

                Regards.
                """,
            ),
            Msg(
                "Demetris Broker",
                "d@brokerbros.example",
                "claims@abbeygate.example",
                "2026-01-22 09:00",
                "RE: CY-MTR-004 — TP insurer",
                """
                TP insurer is Pancyprian Mutual, reference PM-2026-00441. No CCTV
                — car park has not retained footage.
                """,
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "d@brokerbros.example",
                "2026-02-04 16:00",
                "RE: CY-MTR-004 — liability remains reserved",
                """
                Demetris,

                We continue to reserve liability. Estimate has been authorised on a
                without-prejudice basis (€2,100 PanelPro). Recovery from TP insurer
                to follow once liability agreed.
                """,
            ),
        ],
        gold={
            "gold_missing_documents": ["witness_statement", "cctv_footage"],
            "gold_authority_flags": ["tp_recovery_required"],
            "gold_decision_posture": "reserved",
            "gold_key_events": ["FNOL", "liability_position", "estimate_received"],
            "gold_similar_threads": ["CY-MTR-017"],
            "scenario": "liability_reserved_no_witness",
        },
    ),
    # ------------------------------------------------------------------ repairer dispute (same repairer as 017, 031)
    Thread(
        thread_id="CY-MTR-011",
        claim_ref="CY-MTR-011",
        subject="CY-MTR-011 — estimate dispute QuickFix Auto",
        messages=[
            Msg(
                "Anna Brokerson",
                "anna@cyprusbrokers.example",
                "claims@abbeygate.example",
                "2026-02-03 11:00",
                "FNOL CY-MTR-011",
                """
                Front-end collision, Nicosia. Insured Andreas L., policy ABMTR-100231,
                reg KCA-7710. Driveable but heavy bumper/headlight damage. Estimate
                from QuickFix Auto attached.
                """,
                attachments=["estimate_quickfix.pdf"],
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "anna@cyprusbrokers.example",
                "2026-02-03 15:12",
                "RE: CY-MTR-011 — estimate review",
                """
                Anna,

                QuickFix estimate is €14,800. That is high for the visible damage.
                Please obtain a second estimate from an approved repairer.
                """,
            ),
            Msg(
                "Anna Brokerson",
                "anna@cyprusbrokers.example",
                "claims@abbeygate.example",
                "2026-02-09 09:42",
                "RE: CY-MTR-011 — second estimate",
                """
                Second estimate €9,650 from Volante Approved Repairer.
                """,
                attachments=["estimate_volante.pdf"],
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "anna@cyprusbrokers.example",
                "2026-02-09 11:20",
                "RE: CY-MTR-011 — €9,650 authorised",
                """
                Volante estimate authorised. QuickFix rejected. Please proceed.
                """,
            ),
        ],
        gold={
            "gold_missing_documents": [],
            "gold_authority_flags": [],
            "gold_decision_posture": "accepted",
            "gold_key_events": ["FNOL", "estimate_received", "payment"],
            "gold_similar_threads": ["CY-MTR-017", "CY-MTR-031"],
            "scenario": "repairer_recurrence_quickfix",
        },
    ),
    # ------------------------------------------------------------------ missing TP insurer, delayed recovery
    Thread(
        thread_id="CY-MTR-015",
        claim_ref="CY-MTR-015",
        subject="CY-MTR-015 — TP details outstanding",
        messages=[
            Msg(
                "Demetris Broker",
                "d@brokerbros.example",
                "claims@abbeygate.example",
                "2026-01-29 08:45",
                "FNOL CY-MTR-015 — TP hit and run",
                """
                Insured Eleni P. (ABMTR-100302, reg YPL-4419). TP departed scene.
                Insured noted partial reg "...82A". Police informed.
                """,
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "d@brokerbros.example",
                "2026-01-29 12:11",
                "RE: CY-MTR-015 — request",
                """
                Demetris,

                Please obtain (a) the police incident report or attendance number,
                (b) confirmation no witnesses exist, and (c) any CCTV nearby. We
                cannot pursue TP recovery without identifying the third party.
                """,
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "d@brokerbros.example",
                "2026-02-12 09:00",
                "Chaser — CY-MTR-015 TP details",
                """
                Chasing the items requested 29/01. Still outstanding.
                """,
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "d@brokerbros.example",
                "2026-02-26 09:00",
                "Second chaser — CY-MTR-015",
                """
                Second chaser. TP insurer details remain outstanding. Without them
                no recovery is possible.
                """,
            ),
        ],
        gold={
            "gold_missing_documents": [
                "police_report",
                "third_party_insurer_details",
                "witness_statement",
            ],
            "gold_authority_flags": ["tp_recovery_required"],
            "gold_decision_posture": "reserved",
            "gold_key_events": ["FNOL", "doc_request", "chase"],
            "gold_similar_threads": ["CY-MTR-017", "CY-MTR-027"],
            "scenario": "missing_tp_details",
        },
    ),
    # ------------------------------------------------------------------ THE BIG ONE — authority + missing + repairer recurrence
    Thread(
        thread_id="CY-MTR-017",
        claim_ref="CY-MTR-017",
        subject="CY-MTR-017 — TP collision, estimate over authority",
        messages=[
            Msg(
                "Demetris Broker",
                "d@brokerbros.example",
                "claims@abbeygate.example",
                "2026-01-03 14:20",
                "FNOL CY-MTR-017",
                """
                Three-vehicle collision, Limassol roundabout. Our insured Sofia M.
                (policy ABMTR-100417, reg PCM-6604) and one TP. Second TP departed
                before details exchanged. Insured shaken, no reported injury.
                Vehicle towed to QuickFix Auto.
                """,
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "d@brokerbros.example",
                "2026-01-04 10:00",
                "RE: CY-MTR-017 — please send",
                """
                Demetris,

                Please send:
                  1. Completed motor claim form (attached blank).
                  2. Police attendance number or report — Limassol roundabout incidents
                     are typically attended.
                  3. TP insurer details for the identified TP.
                  4. Photos of damage and scene.
                  5. Vehicle registration document.
                  6. Witness statement or confirmation no witness exists.
                  7. Repair estimate from QuickFix Auto.

                Pending these, we are reserving liability.
                """,
                attachments=["motor_claim_form_blank.pdf"],
            ),
            Msg(
                "Demetris Broker",
                "d@brokerbros.example",
                "claims@abbeygate.example",
                "2026-01-07 16:30",
                "RE: CY-MTR-017 — partial",
                """
                George,

                Form attached. Photos attached. TP insurer details still being chased.
                Insured cannot locate the V5/registration document. Police did not
                attend (insured did not request). No witnesses known.
                """,
                attachments=["motor_claim_form_completed.pdf", "photos.zip"],
            ),
            Msg(
                "QuickFix Auto",
                "estimates@quickfix.example",
                "claims@abbeygate.example",
                "2026-01-09 09:18",
                "Repair estimate CY-MTR-017",
                """
                Repair estimate attached. Total €30,000 including parts, paint and
                labour. Vehicle is currently with us awaiting authorisation.
                """,
                attachments=["estimate_quickfix_30000.pdf"],
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "manager@abbeygate.example",
                "2026-01-09 14:50",
                "Referral — CY-MTR-017 over authority",
                """
                Estimate €30,000 exceeds my delegated authority (€25,000 under the
                Cyprus DCA). Referring before any settlement. Repairer is QuickFix
                Auto — same garage flagged on prior claims for high estimates.
                Liability remains reserved (no witness, no police report, no V5).
                """,
            ),
            Msg(
                "Demetris Broker",
                "d@brokerbros.example",
                "claims@abbeygate.example",
                "2026-01-12 11:10",
                "Chaser — CY-MTR-017 authorisation",
                """
                Insured is asking for an update on the estimate authorisation.
                """,
            ),
        ],
        gold={
            "gold_missing_documents": [
                "police_report",
                "third_party_insurer_details",
                "witness_statement",
                "vehicle_registration",
            ],
            "gold_authority_flags": [
                "estimate_exceeds_authority",
                "tp_recovery_required",
            ],
            "gold_decision_posture": "reserved",
            "gold_key_events": [
                "FNOL",
                "doc_request",
                "estimate_received",
                "escalation",
                "chase",
            ],
            "gold_similar_threads": ["CY-MTR-004", "CY-MTR-011", "CY-MTR-015", "CY-MTR-031"],
            "scenario": "headline_authority_breach",
        },
    ),
    Thread(
        thread_id="CY-MTR-019",
        claim_ref="CY-MTR-019",
        subject="CY-MTR-019 — under authority, routine",
        messages=[
            Msg(
                "Anna Brokerson",
                "anna@cyprusbrokers.example",
                "claims@abbeygate.example",
                "2026-02-18 09:01",
                "FNOL CY-MTR-019",
                """
                Side collision, Paphos. Insured policy ABMTR-100501, reg AKK-1010.
                Estimate from PanelPro €23,400. TP insurer Allianz Cy AL-2026-118.
                """,
                attachments=["estimate_panelpro.pdf", "tp_letter.pdf"],
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "anna@cyprusbrokers.example",
                "2026-02-18 14:22",
                "RE: CY-MTR-019 — authorised",
                """
                €23,400 within authority. Authorised. TP recovery to commence.
                """,
            ),
        ],
        gold={
            "gold_missing_documents": [],
            "gold_authority_flags": ["tp_recovery_required"],
            "gold_decision_posture": "accepted",
            "gold_key_events": ["FNOL", "estimate_received"],
            "gold_similar_threads": [],
            "scenario": "control_under_authority",
        },
    ),
    # ------------------------------------------------------------------ complaint -> escalation
    Thread(
        thread_id="CY-MTR-021",
        claim_ref="CY-MTR-021",
        subject="CY-MTR-021 — complaint received",
        messages=[
            Msg(
                "Insured",
                "p.constantinou@example.cy",
                "complaints@abbeygate.example",
                "2026-03-02 19:14",
                "Complaint — handling of CY-MTR-021",
                """
                I have heard nothing for three weeks. My vehicle is undriveable.
                I expect a response within 48 hours or I will refer this to the
                Cyprus Insurance Commissioner.
                """,
            ),
            Msg(
                "Complaints",
                "complaints@abbeygate.example",
                "p.constantinou@example.cy",
                "2026-03-03 09:00",
                "RE: Complaint — CY-MTR-021",
                """
                Acknowledged within 24h per FCA / Cyprus complaints handling rules.
                Final response due within 8 weeks. Escalating internally.
                """,
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "manager@abbeygate.example",
                "2026-03-03 10:30",
                "Escalation — CY-MTR-021 complaint",
                """
                Complaint received from insured. Acknowledging within complaints
                handling rules. Please review.
                """,
            ),
        ],
        gold={
            "gold_missing_documents": [],
            "gold_authority_flags": ["complaint_received"],
            "gold_decision_posture": "unknown",
            "gold_key_events": ["complaint", "escalation"],
            "gold_similar_threads": [],
            "scenario": "complaint_escalation",
        },
    ),
    # ------------------------------------------------------------------ BI potential
    Thread(
        thread_id="CY-MTR-023",
        claim_ref="CY-MTR-023",
        subject="CY-MTR-023 — rear-end, insured reports neck pain",
        messages=[
            Msg(
                "Anna Brokerson",
                "anna@cyprusbrokers.example",
                "claims@abbeygate.example",
                "2026-02-25 08:50",
                "FNOL CY-MTR-023",
                """
                Rear-end collision in stationary traffic, Larnaca. Insured Marios K.
                (policy ABMTR-100612, reg GLT-2238) reports neck pain. Has not yet
                seen a doctor. TP insurer Universal CY UC-2026-2210.
                """,
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "anna@cyprusbrokers.example",
                "2026-02-25 11:33",
                "RE: CY-MTR-023 — BI potential",
                """
                Anna,

                Please obtain a medical report and confirm whether the insured intends
                to pursue a bodily injury claim. Flagging BI potential — reserves
                must reflect indemnity exposure.
                """,
            ),
        ],
        gold={
            "gold_missing_documents": ["medical_report"],
            "gold_authority_flags": ["bi_potential", "tp_recovery_required"],
            "gold_decision_posture": "reserved",
            "gold_key_events": ["FNOL", "doc_request"],
            "gold_similar_threads": [],
            "scenario": "bi_potential",
        },
    ),
    # ------------------------------------------------------------------ fraud indicator
    Thread(
        thread_id="CY-MTR-025",
        claim_ref="CY-MTR-025",
        subject="CY-MTR-025 — date inconsistencies",
        messages=[
            Msg(
                "Insured",
                "newcustomer@example.cy",
                "claims@abbeygate.example",
                "2026-01-30 22:11",
                "FNOL — damage to my car",
                """
                Hello, I want to claim for damage to my vehicle reg KKL-3300, policy
                ABMTR-100744 (just taken out 28 Jan). Damage happened on 25 Jan.
                """,
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "newcustomer@example.cy",
                "2026-01-31 09:15",
                "RE: CY-MTR-025 — clarification required",
                """
                Hello,

                The incident date you have given (25 Jan) is before the policy
                inception (28 Jan). Cover would not have been in force. Please
                clarify and provide any supporting evidence (photos with metadata,
                witness statements, police reference).
                """,
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "manager@abbeygate.example",
                "2026-01-31 09:20",
                "Fraud flag — CY-MTR-025",
                """
                Stated incident date predates inception. Flagging to fraud team.
                """,
            ),
        ],
        gold={
            "gold_missing_documents": ["photos_with_metadata", "police_report"],
            "gold_authority_flags": ["fraud_indicator"],
            "gold_decision_posture": "denied",
            "gold_key_events": ["FNOL", "doc_request", "escalation"],
            "gold_similar_threads": [],
            "scenario": "fraud_indicator",
        },
    ),
    # ------------------------------------------------------------------ TP chase loop
    Thread(
        thread_id="CY-MTR-027",
        claim_ref="CY-MTR-027",
        subject="CY-MTR-027 — TP insurer non-response",
        messages=[
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "claims@pancyprian.example",
                "2026-02-01 09:00",
                "Recovery request CY-MTR-027",
                """
                Recovery request, our claim CY-MTR-027. Our paid amount €4,200.
                Liability accepted on your insured. Please confirm receipt.
                """,
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "claims@pancyprian.example",
                "2026-02-15 09:00",
                "Chaser — CY-MTR-027 recovery",
                """
                Chaser. No response to 01/02 recovery request.
                """,
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "claims@pancyprian.example",
                "2026-03-01 09:00",
                "Second chaser — CY-MTR-027",
                """
                Second chaser. We will refer to the Cyprus Insurance Association
                if no response within 14 days.
                """,
            ),
        ],
        gold={
            "gold_missing_documents": [],
            "gold_authority_flags": ["tp_recovery_required"],
            "gold_decision_posture": "accepted",
            "gold_key_events": ["chase", "chase", "chase"],
            "gold_similar_threads": ["CY-MTR-015"],
            "scenario": "tp_chase_loop",
        },
    ),
    # ------------------------------------------------------------------ settlement exceeds authority
    Thread(
        thread_id="CY-MTR-029",
        claim_ref="CY-MTR-029",
        subject="CY-MTR-029 — settlement offer over authority",
        messages=[
            Msg(
                "TP Solicitor",
                "claims@lawpartners.example",
                "claims@abbeygate.example",
                "2026-03-10 10:00",
                "Settlement proposal CY-MTR-029",
                """
                On behalf of our client, we propose full and final settlement at
                €42,000 inclusive of general damages and special damages. Please
                confirm acceptance.
                """,
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "manager@abbeygate.example",
                "2026-03-10 14:00",
                "Referral — CY-MTR-029 over authority",
                """
                Settlement proposal €42,000 exceeds my delegated authority (€25,000).
                Referring for review before any acceptance.
                """,
            ),
        ],
        gold={
            "gold_missing_documents": [],
            "gold_authority_flags": ["settlement_exceeds_authority"],
            "gold_decision_posture": "reserved",
            "gold_key_events": ["escalation"],
            "gold_similar_threads": ["CY-MTR-017"],
            "scenario": "settlement_authority_breach",
        },
    ),
    # ------------------------------------------------------------------ repairer recurrence (same as 017, 011)
    Thread(
        thread_id="CY-MTR-031",
        claim_ref="CY-MTR-031",
        subject="CY-MTR-031 — QuickFix estimate",
        messages=[
            Msg(
                "Anna Brokerson",
                "anna@cyprusbrokers.example",
                "claims@abbeygate.example",
                "2026-03-18 09:30",
                "FNOL CY-MTR-031",
                """
                Front-corner collision. Insured policy ABMTR-100881, reg AKR-7791.
                Vehicle taken to QuickFix Auto. Estimate attached, €18,200.
                """,
                attachments=["estimate_quickfix.pdf"],
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "anna@cyprusbrokers.example",
                "2026-03-18 11:45",
                "RE: CY-MTR-031 — second estimate please",
                """
                Anna,

                Please obtain a second estimate from an approved repairer. QuickFix
                estimates have run high on recent claims (CY-MTR-011, CY-MTR-017).
                """,
            ),
            Msg(
                "Anna Brokerson",
                "anna@cyprusbrokers.example",
                "claims@abbeygate.example",
                "2026-03-25 16:14",
                "RE: CY-MTR-031 — second estimate",
                """
                Second estimate €11,400 from PanelPro. Insured agrees to PanelPro.
                """,
                attachments=["estimate_panelpro.pdf"],
            ),
        ],
        gold={
            "gold_missing_documents": [],
            "gold_authority_flags": [],
            "gold_decision_posture": "accepted",
            "gold_key_events": ["FNOL", "estimate_received"],
            "gold_similar_threads": ["CY-MTR-011", "CY-MTR-017"],
            "scenario": "repairer_recurrence_quickfix",
        },
    ),
    # ------------------------------------------------------------------ slow broker
    Thread(
        thread_id="CY-MTR-033",
        claim_ref="CY-MTR-033",
        subject="CY-MTR-033 — broker delay",
        messages=[
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "slowbroker@delayed.example",
                "2026-01-20 09:00",
                "CY-MTR-033 — documents requested",
                """
                Please provide motor claim form, photos and estimates.
                """,
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "slowbroker@delayed.example",
                "2026-02-10 09:00",
                "Chaser — CY-MTR-033",
                """
                Chasing the 20/01 request. No response received.
                """,
            ),
            Msg(
                "Handler",
                "claims@abbeygate.example",
                "slowbroker@delayed.example",
                "2026-03-04 09:00",
                "Second chaser — CY-MTR-033",
                """
                Second chaser. Insured contacted us directly today asking for
                progress. This is the fourth claim with delayed responses from
                your office in the past quarter.
                """,
            ),
        ],
        gold={
            "gold_missing_documents": [
                "motor_claim_form",
                "photos",
                "estimates",
            ],
            "gold_authority_flags": [],
            "gold_decision_posture": "unknown",
            "gold_key_events": ["doc_request", "chase", "chase"],
            "gold_similar_threads": ["CY-MTR-015"],
            "scenario": "slow_broker",
        },
    ),
    # ================================================================== Abbeygate production-format threads
    # The remaining four threads use the real Abbeygate ABB/VL/ ref format
    # and exercise PT-language handling + Lloyd's cross-references + GESY.
    Thread(
        thread_id="ABB-VL-00043",
        claim_ref="ABB/VL/00043",
        subject="ABB/VL/00043 — Pedido de informação",
        messages=[
            Msg(
                "Algarve Broker Lda",
                "geral@algarvebroker.example",
                "claims@abbeygate.pt",
                "2026-02-10 09:14",
                "Pedido de informação — ABB/VL/00043 — 44-PL-07",
                """
                Bom dia,

                Em relação à reclamação ABB/VL/00043, viatura matrícula 44-PL-07,
                policy ABLV/PT1003710. A nossa cliente reverteu numa viatura
                estacionada em Faro. Anexo: carta de condução, estimativa de
                reparação no valor de EUR 3,800 (oficina não-aprovada).

                Aguardamos as vossas instruções.

                Cumprimentos,
                Algarve Broker Lda
                """,
                attachments=["carta_conducao.pdf", "estimativa_oficina_local.pdf"],
            ),
            Msg(
                "Claims Handler",
                "claims@abbeygate.pt",
                "geral@algarvebroker.example",
                "2026-02-11 10:30",
                "RE: Pedido de informação — ABB/VL/00043",
                """
                Bom dia,

                Por favor, junte os seguintes documentos:
                  1. Declaração Amigável de Acidente
                  2. Documento Único Automóvel
                  3. Fotografias dos danos e do local
                  4. Dados do segurador da contraparte
                  5. Confirmação de ausência de testemunhas

                A responsabilidade fica reservada até receção da prova
                independente. Será nomeado perito aprovado.

                Cumprimentos.
                """,
            ),
        ],
        gold={
            "gold_missing_documents": [
                "european_accident_statement",
                "vehicle_registration",
                "photos",
                "third_party_insurer_details",
                "witness_statement",
            ],
            "gold_authority_flags": ["tp_recovery_required"],
            "gold_decision_posture": "reserved",
            "gold_key_events": ["FNOL", "doc_request"],
            "gold_similar_threads": ["ABB-VL-00044"],
            "scenario": "abbvl_pt_information_request",
        },
    ),
    Thread(
        thread_id="ABB-VL-00044",
        claim_ref="ABB/VL/00044",
        subject="ENC: Pedido peritagem REF. ABB/VL/00044 — 60-UN-97",
        messages=[
            Msg(
                "Algarve Broker Lda",
                "geral@algarvebroker.example",
                "claims@abbeygate.pt",
                "2026-03-02 08:55",
                "Pedido peritagem REF. ABB/VL/00044 — 60-UN-97",
                """
                Bom dia,

                Solicito agendamento de peritagem para a viatura matrícula 60-UN-97
                (policy ABLV/PT1004112). Acidente em Lisboa, frontal contra muro.
                Estimativa preliminar EUR 12,500. Anexo: relatório RNP.

                Obrigado,
                """,
                attachments=["relatorio_rnp.pdf"],
            ),
            Msg(
                "Claims Handler",
                "claims@abbeygate.pt",
                "geral@algarvebroker.example",
                "2026-03-04 11:00",
                "RE: Pedido peritagem REF. ABB/VL/00044",
                """
                Bom dia,

                Perito aprovado nomeado: Engº António Silva. Inspeção marcada
                para 09/03. Endorsement CV4 (excesso EUR 300) aplica-se.
                Beazley loss adjuster report a ser solicitado.

                Cumprimentos.
                """,
            ),
            Msg(
                "Algarve Broker Lda",
                "geral@algarvebroker.example",
                "claims@abbeygate.pt",
                "2026-03-12 14:20",
                "RE: Pedido peritagem REF. ABB/VL/00044 — Total Loss",
                """
                Bom dia,

                O perito declarou perda total. Valor de Mercado EUR 8,400.
                Confirmar processamento.
                """,
                attachments=["total_loss_report.pdf", "valor_de_mercado.pdf"],
            ),
        ],
        gold={
            "gold_missing_documents": [],
            "gold_authority_flags": [],
            "gold_decision_posture": "accepted",
            "gold_key_events": ["FNOL", "estimate_received", "payment"],
            "gold_similar_threads": ["ABB-VL-00043"],
            "scenario": "abbvl_pt_total_loss",
        },
    ),
    Thread(
        thread_id="ABB-VL-00048",
        claim_ref="ABB/VL/00048",
        subject="ABB/VL/00048 — TP collision, settlement over authority",
        messages=[
            Msg(
                "Algarve Broker Lda",
                "geral@algarvebroker.example",
                "claims@abbeygate.pt",
                "2026-03-15 09:30",
                "FNOL ABB/VL/00048 — Lisbon collision",
                """
                Multi-vehicle collision Lisbon ring road. Insured policy
                ABLV/PT1003710, vehicle 72-TE-20. Third-party insurer:
                Insurer: Fidelidade Seguros (ref. FS-2026-7711). Estimate
                attached, EUR 41,200 from approved repairer.
                """,
                attachments=["estimate_approved.pdf", "fidelidade_letter.pdf"],
            ),
            Msg(
                "Claims Handler",
                "claims@abbeygate.pt",
                "manager@abbeygate.pt",
                "2026-03-15 14:00",
                "Referral — ABB/VL/00048 over authority",
                """
                Estimate EUR 41,200 exceeds my delegated authority of EUR
                25,000 (Cyprus DCA LMA9188). Referring before any settlement.
                Endorsement CV4 (EUR 300 excess) and CV172 (NCD protection)
                active on policy ABLV/PT1003710.
                """,
            ),
        ],
        gold={
            "gold_missing_documents": [],
            "gold_authority_flags": [
                "estimate_exceeds_authority",
                "tp_recovery_required",
            ],
            "gold_decision_posture": "reserved",
            "gold_key_events": ["FNOL", "estimate_received", "escalation"],
            "gold_similar_threads": ["CY-MTR-017", "CY-MTR-029"],
            "scenario": "abbvl_pt_authority_breach",
        },
    ),
    # ------------------------------------------------------------------ GESY (Endorsement No. 141)
    # The headline example from the assignment paper: the rule lives only
    # in an operative email and is invisible to a baseline LLM.
    Thread(
        thread_id="ABB-VL-00112",
        claim_ref="ABB/VL/00112",
        subject="ABB/VL/00112 — Section A medical expenses claim",
        messages=[
            Msg(
                "Cyprus Health Broker",
                "claims@cyhealthbroker.example",
                "claims@abbeygate.cy",
                "2026-04-10 10:00",
                "FNOL ABB/VL/00112 — Section A medical claim",
                """
                Dear Claims,

                FNOL for our insured (Cyprus immigrant policyholder). At data
                capture GESY was confirmed as active. Claim under Section A —
                medical expenses, total EUR 4,200. Attached: discharge summary,
                medical invoices from private clinic.

                Please confirm payment.

                Regards,
                Cyprus Health Broker
                """,
                attachments=["discharge_summary.pdf", "medical_invoices.pdf"],
            ),
            Msg(
                "Claims Handler",
                "claims@abbeygate.cy",
                "claims@cyhealthbroker.example",
                "2026-04-11 09:15",
                "RE: FNOL ABB/VL/00112 — GESY evidence required",
                """
                Dear Broker,

                Endorsement No. 141 (GHS/GESY Claims Condition) applies to
                this claim because GESY was confirmed at data capture. Before
                we can admit or pay any Section A claim we require:

                  (i)  Documentary evidence that GESY was approached
                       regarding this illness.
                  (ii) Written confirmation from GESY that they declined,
                       refused, or were unable to treat.

                Without these two items the Company has no liability under
                Section A. Posture: insufficient evidence pending receipt.

                Suggested template: Request for GESY Documentary Evidence.

                Regards.
                """,
            ),
        ],
        gold={
            "gold_missing_documents": [
                "gesy_approach_evidence",
                "gesy_refusal_confirmation",
            ],
            "gold_authority_flags": ["endorsement_condition_unmet"],
            "gold_decision_posture": "reserved",
            "gold_key_events": ["FNOL", "doc_request"],
            "gold_similar_threads": [],
            "scenario": "gesy_endorsement_141",
        },
    ),
]


def main() -> None:
    for thread in THREADS_DATA:
        _write(thread)
    print(f"Wrote {len(THREADS_DATA)} threads to {THREADS}")
    print(f"Wrote {len(THREADS_DATA)} gold files to {GOLD}")


if __name__ == "__main__":
    main()

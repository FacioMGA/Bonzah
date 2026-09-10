"""Deterministic entity extraction.

Pure regex/lexical extraction over a ``Thread``. No LLM call, no surprises,
fully offline. Anything the LLM later "discovers" must square with these
entities or it does not enter the ``ThreadAnalysis``.
"""

from __future__ import annotations

import re

from org2vec.ingest.parse import LLOYDS_REF_RE, PT_REG_RE
from org2vec.models import Citation, Entity, Thread

# Cyprus / Lloyd's specialty conventions used by Abbeygate.
# Two claim-ref formats: synthesized CY-MTR-017 and production ABB/VL/00039.
CLAIM_REF_RE = re.compile(
    r"\b(?:ABB/VL/\d{4,6}|[A-Z]{2}-[A-Z]{3,4}-\d{3,6})\b"
)
POLICY_RE = re.compile(r"\b([A-Z]{2,5}-?[0-9]{5,7})\b")
REG_RE = re.compile(r"\b([A-Z]{2,3}-?\d{3,4}|[A-Z]{3}\d{3,4})\b")
AMOUNT_RE = re.compile(
    r"(?:€|EUR\s*|\$|USD\s*)\s*([0-9]{1,3}(?:[,.]\d{3})*(?:\.\d{1,2})?)\b",
    re.IGNORECASE,
)
# Tighter TP-insurer regex: require either an explicit insurer suffix or a
# "Insurer:"/"Companhia:" prefix. Avoids the previous false positive on
# "FNOL CY" matching the "Cy" suffix.
TP_INSURER_RE = re.compile(
    r"(?:(?:TP|Third[\- ]?Party|Insurer|Companhia|Seguros?)[: ]+"
    r"((?:[A-Z][a-zA-Z]+\s){0,2}[A-Z][a-zA-Z]+)"
    r"|\b((?:[A-Z][a-zA-Z]+\s){1,3}(?:Insurance|Mutual|Assurance|Seguros|Allianz|Universal))\b)"
)

# Volante / Abbeygate Cyprus binder endorsement codes used across the
# Appendix Experiment C output. The set is closed and short, so an explicit
# alternation is cleaner than a generic ``CV\d+``.
ENDORSEMENT_CODE_RE = re.compile(
    r"\b(CV(?:4|5|7|172|999|1028|1029))\b"
)

# GESY / GHS (Cyprus state health system) — triggers Endorsement No. 141.
GESY_RE = re.compile(r"\b(GESY|GHS|General Health System)\b", re.IGNORECASE)
GARAGE_HINTS = {
    "quickfix auto": "QuickFix Auto",
    "panelpro": "PanelPro",
    "volante approved repairer": "Volante Approved Repairer",
    "autoglass cy": "Autoglass Cy",
}
INJURY_RE = re.compile(
    r"\b(neck pain|whiplash|back pain|injury|injured|medical|hospital|fracture|concussion)\b",
    re.IGNORECASE,
)
POLICE_RE = re.compile(r"\b(police (?:report|attendance|reference)|attended|did not attend)\b", re.IGNORECASE)
WITNESS_RE = re.compile(r"\b(witness(?:es)?|no witness|cctv|dashcam)\b", re.IGNORECASE)


def _parse_amount(s: str) -> float:
    s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def extract_entities(thread: Thread) -> list[Entity]:
    found: list[Entity] = []
    seen: set[tuple[str, str]] = set()

    def add(kind: str, value: str, msg_id: str, quote: str) -> None:
        key = (kind, value)
        if key in seen:
            return
        seen.add(key)
        found.append(
            Entity(
                kind=kind,  # type: ignore[arg-type]
                value=value,
                citation=Citation(
                    kind="email",
                    thread_id=thread.thread_id,
                    message_id=msg_id,
                    quote=quote[:200],
                ),
            )
        )

    for msg in thread.messages:
        text = msg.subject + "\n" + msg.body

        # Match objects are reusable in this scope; we typically iterate once.
        for m_match in CLAIM_REF_RE.finditer(text):
            # CLAIM_REF_RE has no capturing group on the ABB/VL/ alternative,
            # so use group(0) for the full match.
            add("claim_ref", m_match.group(0), msg.message_id, _around(text, m_match))

        for m_match in LLOYDS_REF_RE.finditer(text):
            add("lloyds_ref", m_match.group(1), msg.message_id, _around(text, m_match))

        for m_match in POLICY_RE.finditer(text):
            v = m_match.group(1)
            # Filter against false positives: must look like an Abbeygate policy
            # (ABMTR-/ABLV-/AB...) and not be a claim ref or Lloyd's ref already.
            if v.upper().startswith("ABMTR") or v.upper().startswith("ABLV"):
                add("policy_no", v, msg.message_id, _around(text, m_match))

        for m_match in REG_RE.finditer(text):
            v = m_match.group(1)
            if v.startswith("AB") or "MTR" in v or "ABLV" in v:
                continue  # avoid policy / claim collisions
            add("reg_no", v, msg.message_id, _around(text, m_match))

        # Portuguese vehicle reg format ("44PL07", "72-TE-20", "94-LH-16").
        for m_match in PT_REG_RE.finditer(text):
            v = m_match.group(1)
            # Skip ambiguous numeric-only or already-matched values.
            if v.startswith("ABB") or v.startswith("ABLV"):
                continue
            add("reg_no", v, msg.message_id, _around(text, m_match))

        for m_match in ENDORSEMENT_CODE_RE.finditer(text):
            add("endorsement_code", m_match.group(1), msg.message_id, _around(text, m_match))

        if GESY_RE.search(text):
            mm = GESY_RE.search(text)
            assert mm
            add("gesy", mm.group(1).upper(), msg.message_id, _around(text, mm))

        for m_match in AMOUNT_RE.finditer(text):
            v = _parse_amount(m_match.group(1))
            if v >= 50:  # ignore €25 style mentions of excess
                add("amount", f"{v:.2f}", msg.message_id, _around(text, m_match))

        lowered = text.lower()
        for needle, label in GARAGE_HINTS.items():
            if needle in lowered:
                idx = lowered.find(needle)
                add("garage", label, msg.message_id, text[max(0, idx - 40) : idx + 80])

        if INJURY_RE.search(text):
            m_match = INJURY_RE.search(text)
            assert m_match
            add("injury", m_match.group(0), msg.message_id, _around(text, m_match))

        if POLICE_RE.search(text):
            m_match = POLICE_RE.search(text)
            assert m_match
            add("police", m_match.group(0), msg.message_id, _around(text, m_match))

        if WITNESS_RE.search(text):
            m_match = WITNESS_RE.search(text)
            assert m_match
            add("witness", m_match.group(0), msg.message_id, _around(text, m_match))

        if msg.sender_email:
            domain = msg.sender_email.split("@")[-1]
            if "broker" in domain.lower() or "broker" in msg.sender.lower():
                add("broker", msg.sender, msg.message_id, msg.sender)

        # Third-party insurers — the regex now has two capture groups
        # (insurer-after-prefix and insurer-with-suffix). Pick whichever fired.
        for m_match in TP_INSURER_RE.finditer(text):
            label = (m_match.group(1) or m_match.group(2) or "").strip()
            if not label or "Abbeygate" in label:
                continue
            add("third_party_insurer", label, msg.message_id, _around(text, m_match))

    return found


def _around(text: str, match: re.Match[str], radius: int = 80) -> str:
    start = max(0, match.start() - radius)
    end = min(len(text), match.end() + radius)
    return text[start:end].replace("\n", " ").strip()

"""Two-pass thread analysis.

Pass 1 (deterministic) — classify each message type by keywords and structure.
Pass 2 (LLM) — produce a strict-JSON ``ThreadAnalysis`` over the classified
thread, with every claim carrying a citation. JSON is validated against the
Pydantic schema before it leaves this module.

This is the only LLM call in the per-thread pipeline. Cached and seeded so
demos are reproducible.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from pydantic import ValidationError

from org2vec.extract.entities import extract_entities
from org2vec.llm.client import chat_json
from org2vec.models import Citation, Message, Thread, ThreadAnalysis

PROMPT_DIR = Path(__file__).resolve().parents[1] / "rag" / "prompts"


# ---------------------------------------------------------------------------
# Pass 1: cheap deterministic message classification.
# ---------------------------------------------------------------------------

# Order matters — the first match wins.
CLASS_RULES: list[tuple[str, str]] = [
    ("FNOL", r"\b(FNOL|first notification|new claim)\b"),
    ("complaint", r"\b(complain(?:t|ing|ed)?|insurance commissioner)\b"),
    ("escalation", r"\b(referr(?:al|ed|ing)|escalat(?:e|ion|ed)|over authority|exceeds.*authority|fraud)\b"),
    ("chaser", r"\b(second chaser|chaser|chasing the|no response received)\b"),
    ("closure", r"\b(closed today|closure confirmation|claim closed)\b"),
    ("doc_request", r"\b(please send|please provide|please obtain|documents required|require(?:d)? the following)\b"),
    ("liability", r"\b(liability (?:accepted|reserved|denied|disputed|remains)|reserve liability)\b"),
    ("estimate", r"\b(repair estimate|estimate attached|estimate from|estimate is|estimate dispute)\b"),
    ("payment", r"\b(authorised|paid €|settlement|invoice)\b"),
]


def classify_message(msg: Message) -> str:
    text = (msg.subject + "\n" + msg.body).lower()
    for label, pattern in CLASS_RULES:
        if re.search(pattern, text, re.IGNORECASE):
            return label
    return "info"


def classify_thread(thread: Thread) -> Thread:
    """Mutates message.message_type in place and returns the thread."""
    for m in thread.messages:
        if m.message_type is None:
            m.message_type = classify_message(m)  # type: ignore[assignment]
    return thread


# ---------------------------------------------------------------------------
# Pass 2: LLM extraction into ThreadAnalysis.
# ---------------------------------------------------------------------------


SYSTEM_PROMPT = (
    "You are an Abbeygate claims analyst. You read claims email threads and "
    "extract a strict JSON record of events, missing documents, authority "
    "flags, liability positions, and recommended next actions. You only "
    "report items grounded in the thread; every item carries a citation to "
    "the specific message_id it came from with a short verbatim quote. "
    "Never invent claim references, amounts, or events. If you cannot find "
    "evidence for an item, omit it."
)


def _thread_to_prompt(thread: Thread) -> str:
    parts: list[str] = [
        f"Thread-ID: {thread.thread_id}",
        f"Claim-Refs: {', '.join(thread.claim_refs) or '(none detected)'}",
        f"Source: {thread.source}",
        "",
        "Messages (use these message_ids verbatim in any citation):",
    ]
    for m in thread.messages:
        sent = m.sent_at.isoformat() if m.sent_at else "?"
        parts.append(
            f"\n--- message_id={m.message_id} type={m.message_type} from={m.sender!r} "
            f"sent={sent} subject={m.subject!r} ---\n{m.body[:1500]}"
        )
    return "\n".join(parts)


SCHEMA_HINT = """{
  "thread_id": string,
  "claim_refs": [string, ...],
  "timeline": [
    {
      "type": "FNOL" | "doc_request" | "estimate_received" | "liability_position" | "escalation" | "payment" | "closure" | "complaint" | "chase",
      "date": "YYYY-MM-DD" | null,
      "summary": string,
      "amount": number | null,
      "citation": { "kind": "email", "thread_id": string, "message_id": string, "quote": string }
    }
  ],
  "missing_information": [
    {
      "document": string,
      "requested_at": "YYYY-MM-DD" | null,
      "received": boolean,
      "rationale": string,
      "citation": { "kind": "email", "thread_id": string, "message_id": string, "quote": string }
    }
  ],
  "authority_flags": [
    {
      "kind": "estimate_exceeds_authority" | "settlement_exceeds_authority" | "complaint_received" | "bi_potential" | "fraud_indicator" | "tp_recovery_required" | "endorsement_condition_unmet",
      "rationale": string,
      "threshold": number | null,
      "observed": number | null,
      "endorsement_code": string | null,
      "citation": { "kind": "email"|"rule", "thread_id"?: string, "message_id"?: string, "doc_id"?: string, "chunk_id"?: string, "quote": string }
    }
  ],
  "liability_positions": [
    {
      "posture": "accepted" | "denied" | "reserved" | "split" | "unknown",
      "rationale": string,
      "citation": { "kind": "email", "thread_id": string, "message_id": string, "quote": string }
    }
  ],
  "recommended_next_actions": [
    {
      "action": string,
      "priority": "low" | "medium" | "high",
      "rationale": string,
      "citation": { "kind": "email", "thread_id": string, "message_id": string, "quote": string }
    }
  ]
}
"""


def analyze_thread(thread: Thread) -> ThreadAnalysis:
    """Two-pass thread analysis. Returns a validated ``ThreadAnalysis``.

    The entities list is filled from the deterministic regex extractor; the
    rest is the LLM's structured output.
    """
    thread = classify_thread(thread)
    raw = chat_json(
        system=SYSTEM_PROMPT,
        user=_thread_to_prompt(thread),
        schema_hint=SCHEMA_HINT,
        tag=f"analyze:{thread.thread_id}",
    )
    raw.setdefault("thread_id", thread.thread_id)
    raw.setdefault("claim_refs", thread.claim_refs)
    raw["entities"] = [e.model_dump() for e in extract_entities(thread)]
    # Patch every citation that lacks a thread_id (LLMs sometimes forget) so
    # the verifier can still resolve them.
    for section in (
        "timeline",
        "missing_information",
        "authority_flags",
        "liability_positions",
        "recommended_next_actions",
    ):
        for item in raw.get(section, []) or []:
            cit = item.get("citation") or {}
            cit.setdefault("kind", "email")
            cit.setdefault("thread_id", thread.thread_id)
            item["citation"] = cit
    try:
        return ThreadAnalysis.model_validate(raw)
    except ValidationError as exc:
        # Last-resort: log the raw output for debugging, then re-raise.
        debug_path = Path("artifacts/llm-cache") / f"INVALID-{thread.thread_id}.json"
        debug_path.parent.mkdir(parents=True, exist_ok=True)
        debug_path.write_text(json.dumps(raw, indent=2, default=str))
        raise RuntimeError(
            f"LLM returned invalid ThreadAnalysis for {thread.thread_id}; "
            f"see {debug_path}"
        ) from exc


__all__ = ["analyze_thread", "classify_message", "classify_thread"]


def _ensure_email_citation(cit: Citation | None, thread: Thread) -> Citation:
    if cit:
        return cit
    first = thread.messages[0] if thread.messages else None
    return Citation(
        kind="email",
        thread_id=thread.thread_id,
        message_id=first.message_id if first else "",
        quote="",
    )

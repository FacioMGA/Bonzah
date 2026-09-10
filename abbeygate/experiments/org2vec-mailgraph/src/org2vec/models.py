"""The one-contract spine.

Every other module is a thin transformer over these types. There is intentionally
no second representation: extract, retrieve, RAG, UI and eval all read and write
the same Pydantic models.

The two anchor types:

- ``ThreadAnalysis`` — the per-thread atom produced by extraction + RAG.
- ``ClaimMemoryObject`` — the per-claim aggregate the Claim Workspace co-pilot
  reads. This is the product spine.
"""

from __future__ import annotations

# eval_type_backport lets pydantic v2 evaluate ``str | None`` on Python 3.9.
# On 3.10+ this import is harmless.
try:  # pragma: no cover
    import eval_type_backport  # noqa: F401
except ImportError:  # pragma: no cover
    pass

# Alias because ``date`` is used as a field name on Event and Gap; with
# ``from __future__ import annotations`` the field name shadows the imported
# class and pydantic ends up typing the field as ``None | None`` → never
# accepts a non-None value.
from datetime import date as DateT
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Citations — every claim in the output must carry one.
# ---------------------------------------------------------------------------


class Citation(BaseModel):
    """A pointer back into evidence. Email or rule-doc, never invented."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["email", "rule"]
    thread_id: str | None = None
    message_id: str | None = None
    doc_id: str | None = None
    chunk_id: str | None = None
    quote: str = Field(min_length=1, max_length=400)

    def key(self) -> tuple[str, ...]:
        """A stable identity for set membership and validation."""
        if self.kind == "email":
            return ("email", self.thread_id or "", self.message_id or "")
        return ("rule", self.doc_id or "", self.chunk_id or "")


# ---------------------------------------------------------------------------
# Raw thread / message — what the parser emits, what extract consumes.
# ---------------------------------------------------------------------------


class Attachment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filename: str
    mime_type: str | None = None
    size_bytes: int | None = None


Language = Literal["en", "pt", "es", "el", "bilingual", "unknown"]
Jurisdiction = Literal["CY", "PT", "ES", "GR", "unknown"]


class Message(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message_id: str
    thread_id: str
    sender: str
    sender_email: str | None = None
    recipients: list[str] = Field(default_factory=list)
    subject: str = ""
    sent_at: datetime | None = None
    body: str
    attachments: list[Attachment] = Field(default_factory=list)
    # First-pass message classification; populated by extract/events.py.
    message_type: (
        Literal[
            "FNOL",
            "doc_request",
            "estimate",
            "liability",
            "complaint",
            "escalation",
            "payment",
            "closure",
            "chaser",
            "info",
        ]
        | None
    ) = None
    language: Language = "unknown"


class Thread(BaseModel):
    model_config = ConfigDict(extra="forbid")
    thread_id: str
    subject: str = ""
    messages: list[Message]
    claim_refs: list[str] = Field(default_factory=list)
    lloyds_refs: list[str] = Field(default_factory=list)
    source: Literal["microsoft", "google", "sample", "disk", "upload"] = "disk"
    language: Language = "unknown"
    jurisdiction: Jurisdiction = "unknown"


# ---------------------------------------------------------------------------
# Structured findings — events, gaps, flags, actions, similar claims.
# ---------------------------------------------------------------------------


EventType = Literal[
    "FNOL",
    "doc_request",
    "estimate_received",
    "liability_position",
    "escalation",
    "payment",
    "closure",
    "complaint",
    "chase",
]


class Event(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: EventType
    date: DateT | None = None
    summary: str = Field(min_length=1, max_length=240)
    amount: float | None = None
    citation: Citation


class Gap(BaseModel):
    """A missing piece of information the handler should chase."""

    model_config = ConfigDict(extra="forbid")
    document: str = Field(min_length=1, max_length=120)
    requested_at: DateT | None = None
    received: bool = False
    rationale: str = Field(min_length=1, max_length=400)
    citation: Citation


class AuthorityFlag(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal[
        "estimate_exceeds_authority",
        "settlement_exceeds_authority",
        "complaint_received",
        "bi_potential",
        "fraud_indicator",
        "tp_recovery_required",
        "endorsement_condition_unmet",
    ]
    rationale: str = Field(min_length=1, max_length=400)
    threshold: float | None = None
    observed: float | None = None
    endorsement_code: str | None = None
    citation: Citation


class LiabilityPosition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    posture: Literal["accepted", "denied", "reserved", "split", "unknown"]
    rationale: str = Field(min_length=1, max_length=400)
    citation: Citation


class Action(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str = Field(min_length=1, max_length=240)
    priority: Literal["low", "medium", "high"] = "medium"
    rationale: str = Field(min_length=1, max_length=400)
    citation: Citation


class SimilarClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claim_id: str
    score: float = Field(ge=0.0, le=1.0)
    shared_entities: list[str] = Field(default_factory=list)
    prior_outcome: str | None = None
    why: str = Field(min_length=1, max_length=400)


class Entity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal[
        "claim_ref",
        "lloyds_ref",
        "policy_no",
        "reg_no",
        "insured",
        "claimant",
        "broker",
        "garage",
        "amount",
        "injury",
        "police",
        "witness",
        "date",
        "third_party",
        "third_party_insurer",
        "endorsement_code",
        "gesy",
    ]
    value: str
    citation: Citation | None = None


# ---------------------------------------------------------------------------
# Per-thread atom.
# ---------------------------------------------------------------------------


class ThreadAnalysis(BaseModel):
    """Per-thread extraction; the atom of the spine."""

    model_config = ConfigDict(extra="forbid")
    thread_id: str
    claim_refs: list[str] = Field(default_factory=list)
    timeline: list[Event] = Field(default_factory=list)
    missing_information: list[Gap] = Field(default_factory=list)
    authority_flags: list[AuthorityFlag] = Field(default_factory=list)
    liability_positions: list[LiabilityPosition] = Field(default_factory=list)
    recommended_next_actions: list[Action] = Field(default_factory=list)
    entities: list[Entity] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Per-claim aggregate — the product spine.
# ---------------------------------------------------------------------------


class ClaimMemoryObject(BaseModel):
    """Per-claim aggregate. This is what the co-pilot reads.

    Aggregated from one-or-more ``ThreadAnalysis`` objects sharing a claim_ref.
    Authoritative source for the Claim Workspace UI, the eval harness, and
    every downstream view. No intermediate "view model".
    """

    model_config = ConfigDict(extra="forbid")
    claim_id: str
    threads: list[Thread]
    messages: list[Message]
    attachments: list[Attachment] = Field(default_factory=list)
    timeline: list[Event] = Field(default_factory=list)
    entities: list[Entity] = Field(default_factory=list)
    missing_information: list[Gap] = Field(default_factory=list)
    authority_flags: list[AuthorityFlag] = Field(default_factory=list)
    liability_positions: list[LiabilityPosition] = Field(default_factory=list)
    recommended_actions: list[Action] = Field(default_factory=list)
    similar_claims: list[SimilarClaim] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)

    @property
    def last_message_at(self) -> datetime | None:
        sent = [m.sent_at for m in self.messages if m.sent_at]
        return max(sent) if sent else None

    @property
    def open_gaps(self) -> int:
        return sum(1 for g in self.missing_information if not g.received)


# ---------------------------------------------------------------------------
# Connector filter — one shape, Microsoft and Google both normalize into this.
# ---------------------------------------------------------------------------


class Filter(BaseModel):
    """Inbox filter shared by every connector."""

    model_config = ConfigDict(extra="forbid")
    sender: str | None = None
    sender_domain: str | None = None
    subject_contains: str | None = None
    folder: str | None = None
    label: str | None = None
    date_from: DateT | None = None
    date_to: DateT | None = None
    has_attachment: bool | None = None
    max_threads: int = 50


# ---------------------------------------------------------------------------
# Retrieval evidence pack — what the LLM actually sees.
# ---------------------------------------------------------------------------


class EvidenceItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["email", "rule"]
    id: str  # message_id or chunk_id
    parent_id: str | None = None  # thread_id or doc_id
    text: str
    score: float = 0.0
    source_label: str = ""


class EvidencePack(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str
    items: list[EvidenceItem]

    def by_key(self) -> dict[tuple[str, str, str], EvidenceItem]:
        out: dict[tuple[str, str, str], EvidenceItem] = {}
        for it in self.items:
            if it.kind == "email":
                out[("email", it.parent_id or "", it.id)] = it
            else:
                out[("rule", it.parent_id or "", it.id)] = it
        return out


__all__ = [
    "Action",
    "Attachment",
    "AuthorityFlag",
    "Citation",
    "ClaimMemoryObject",
    "Entity",
    "EvidenceItem",
    "EvidencePack",
    "Event",
    "Filter",
    "Gap",
    "LiabilityPosition",
    "Message",
    "SimilarClaim",
    "Thread",
    "ThreadAnalysis",
]

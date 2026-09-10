"""Load gold labels from ``corpus/gold/*.json``."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Gold:
    thread_id: str
    claim_ref: str
    gold_missing_documents: list[str] = field(default_factory=list)
    gold_authority_flags: list[str] = field(default_factory=list)
    gold_decision_posture: str = "unknown"
    gold_key_events: list[str] = field(default_factory=list)
    gold_similar_threads: list[str] = field(default_factory=list)
    scenario: str = ""


GOLD_DIR = Path(__file__).resolve().parents[3] / "corpus" / "gold"


def load() -> dict[str, Gold]:
    out: dict[str, Gold] = {}
    for path in sorted(GOLD_DIR.glob("*.json")):
        data = json.loads(path.read_text())
        out[data["thread_id"]] = Gold(**data)
    return out

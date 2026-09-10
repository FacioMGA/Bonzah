"""Aggregate per-thread ``ThreadAnalysis`` into per-claim ``ClaimMemoryObject``.

This is the product spine. The Claim Workspace co-pilot reads ``ClaimMemoryObject``
directly — there is no intermediate view model.

A claim_id may be present in multiple threads (e.g. recovery thread + original
FNOL thread). We aggregate by ``claim_ref`` and de-dupe events / gaps / flags
by (kind, key).
"""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable

from org2vec.models import (
    Action,
    AuthorityFlag,
    Citation,
    ClaimMemoryObject,
    Entity,
    Event,
    Gap,
    LiabilityPosition,
    Message,
    SimilarClaim,
    Thread,
    ThreadAnalysis,
)


def aggregate(
    threads: Iterable[Thread],
    analyses: Iterable[ThreadAnalysis],
    *,
    similar_by_claim: dict[str, list[SimilarClaim]] | None = None,
) -> list[ClaimMemoryObject]:
    """Return one ``ClaimMemoryObject`` per detected claim_id.

    A thread with no claim_ref is assigned its own ``claim_id == thread_id``
    so nothing falls on the floor.
    """
    threads = list(threads)
    analyses = list(analyses)
    analyses_by_thread = {a.thread_id: a for a in analyses}

    # Group threads by claim_id.
    by_claim: dict[str, list[Thread]] = defaultdict(list)
    for t in threads:
        claim_id = t.claim_refs[0] if t.claim_refs else t.thread_id
        by_claim[claim_id].append(t)

    out: list[ClaimMemoryObject] = []
    for claim_id, group in by_claim.items():
        messages: list[Message] = []
        attachments = []
        timeline: list[Event] = []
        entities: list[Entity] = []
        gaps: list[Gap] = []
        flags: list[AuthorityFlag] = []
        liabilities: list[LiabilityPosition] = []
        actions: list[Action] = []
        all_citations: list[Citation] = []

        for t in group:
            messages.extend(t.messages)
            for m in t.messages:
                attachments.extend(m.attachments)
            a = analyses_by_thread.get(t.thread_id)
            if a is None:
                continue
            timeline.extend(a.timeline)
            entities.extend(a.entities)
            gaps.extend(a.missing_information)
            flags.extend(a.authority_flags)
            liabilities.extend(a.liability_positions)
            actions.extend(a.recommended_next_actions)

        timeline = _dedupe_events(timeline)
        gaps = _dedupe_gaps(gaps)
        flags = _dedupe_flags(flags)
        liabilities = _dedupe_liabilities(liabilities)
        actions = _dedupe_actions(actions)
        entities = _dedupe_entities(entities)

        for item in (*timeline, *gaps, *flags, *liabilities, *actions):
            cit = getattr(item, "citation", None)
            if cit:
                all_citations.append(cit)

        # Stable timeline order by date.
        timeline.sort(key=lambda e: (e.date is None, e.date or ""))

        similar = (similar_by_claim or {}).get(claim_id, [])

        cmo = ClaimMemoryObject(
            claim_id=claim_id,
            threads=group,
            messages=messages,
            attachments=attachments,
            timeline=timeline,
            entities=entities,
            missing_information=gaps,
            authority_flags=flags,
            liability_positions=liabilities,
            recommended_actions=actions,
            similar_claims=similar,
            citations=all_citations,
        )
        out.append(cmo)

    out.sort(key=lambda c: c.claim_id)
    return out


# ---------------------------------------------------------------------------
# De-dup helpers — keep the first encounter, prefer the one with the longest
# rationale on ties (= the most informative LLM output).
# ---------------------------------------------------------------------------


def _dedupe_by_key(items: list, key) -> list:
    by_key: dict = {}
    for it in items:
        k = key(it)
        prev = by_key.get(k)
        if prev is None:
            by_key[k] = it
            continue
        prev_len = len(getattr(prev, "rationale", "") or "")
        cur_len = len(getattr(it, "rationale", "") or "")
        if cur_len > prev_len:
            by_key[k] = it
    return list(by_key.values())


def _dedupe_events(items: list[Event]) -> list[Event]:
    return _dedupe_by_key(items, lambda e: (e.type, e.date, e.amount, (e.summary or "")[:60]))


def _dedupe_gaps(items: list[Gap]) -> list[Gap]:
    return _dedupe_by_key(items, lambda g: g.document.lower())


def _dedupe_flags(items: list[AuthorityFlag]) -> list[AuthorityFlag]:
    return _dedupe_by_key(items, lambda f: (f.kind, f.threshold, f.observed))


def _dedupe_liabilities(items: list[LiabilityPosition]) -> list[LiabilityPosition]:
    return _dedupe_by_key(items, lambda l: l.posture)


def _dedupe_actions(items: list[Action]) -> list[Action]:
    return _dedupe_by_key(items, lambda a: a.action.lower()[:80])


def _dedupe_entities(items: list[Entity]) -> list[Entity]:
    seen: set[tuple[str, str]] = set()
    out: list[Entity] = []
    for it in items:
        key = (it.kind, it.value.lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out


__all__ = ["aggregate"]

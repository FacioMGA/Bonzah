"""Graph queries.

Two surfaces:

- ``related_messages``  — used by the hybrid retriever to boost messages whose
  parent claim or thread shares entities with the question's anchor.
- ``similar_claims``    — used by the Similar Historical Claims card. Returns
  ranked ``SimilarClaim`` objects with a short ``why`` string.

Both functions are deterministic.
"""

from __future__ import annotations

from collections import defaultdict

import networkx as nx

from org2vec.models import SimilarClaim


def _claim_node(claim_id: str) -> str:
    return f"claim:{claim_id}"


def _shared_entities(g: nx.DiGraph, c1: str, c2: str) -> list[tuple[str, str]]:
    """Return entity (kind, value) tuples shared between two claims."""
    ent1 = {n for n in g.successors(c1) if g.nodes[n].get("kind") == "entity"}
    ent2 = {n for n in g.successors(c2) if g.nodes[n].get("kind") == "entity"}
    common = ent1 & ent2
    return [(g.nodes[n]["entity_kind"], g.nodes[n]["value"]) for n in common]


# Entity-kind weights — repairer/garage/broker carry the most operational signal.
ENTITY_WEIGHTS: dict[str, float] = {
    "garage": 1.0,
    "broker": 0.7,
    "third_party_insurer": 0.7,
    "policy_no": 0.5,
    "claimant": 0.5,
    "insured": 0.5,
    "reg_no": 0.4,
}


def similar_claims(g: nx.DiGraph, claim_id: str, *, k: int = 3) -> list[SimilarClaim]:
    if not g.has_node(_claim_node(claim_id)):
        return []
    me = _claim_node(claim_id)
    my_entities = {n for n in g.successors(me) if g.nodes[n].get("kind") == "entity"}

    scored: list[tuple[float, str, list[tuple[str, str]]]] = []
    for other in g.nodes:
        if not other.startswith("claim:") or other == me:
            continue
        their_entities = {n for n in g.successors(other) if g.nodes[n].get("kind") == "entity"}
        common = my_entities & their_entities
        if not common:
            continue
        score = 0.0
        why_parts: list[tuple[str, str]] = []
        for n in common:
            kind = g.nodes[n]["entity_kind"]
            score += ENTITY_WEIGHTS.get(kind, 0.2)
            why_parts.append((kind, g.nodes[n]["value"]))
        scored.append((score, other, why_parts))

    scored.sort(reverse=True)
    out: list[SimilarClaim] = []
    for score, node, common in scored[:k]:
        cid = g.nodes[node]["id"]
        labels = [f"{k}={v}" for k, v in sorted(common)[:5]]
        out.append(
            SimilarClaim(
                claim_id=cid,
                score=min(1.0, score / 3.0),
                shared_entities=labels,
                why=f"shared: {', '.join(labels)}",
            )
        )
    return out


def related_messages(
    g: nx.DiGraph,
    *,
    claim_id: str | None = None,
    thread_id: str | None = None,
    limit: int = 12,
) -> list[tuple[str, str]]:
    """Return ``(kind, id)`` of messages 'graph-related' to the focus claim/thread.

    A message is related if its parent claim shares ≥1 weighted entity with
    the focus claim. Used by the hybrid retriever as the graph-hop input.
    """
    if not claim_id and not thread_id:
        return []

    anchor: str | None = None
    if claim_id and g.has_node(_claim_node(claim_id)):
        anchor = _claim_node(claim_id)
    elif thread_id and g.has_node(f"thread:{thread_id}"):
        # Walk up to its claim parent.
        for pred in g.predecessors(f"thread:{thread_id}"):
            if pred.startswith("claim:"):
                anchor = pred
                break
    if anchor is None:
        return []

    related: list[tuple[float, str]] = []
    my_entities = {n for n in g.successors(anchor) if g.nodes[n].get("kind") == "entity"}

    for other in g.nodes:
        if not other.startswith("claim:") or other == anchor:
            continue
        their_entities = {n for n in g.successors(other) if g.nodes[n].get("kind") == "entity"}
        common = my_entities & their_entities
        if not common:
            continue
        score = sum(
            ENTITY_WEIGHTS.get(g.nodes[n]["entity_kind"], 0.2) for n in common
        )
        for tnode in g.successors(other):
            if not tnode.startswith("thread:"):
                continue
            for mnode in g.successors(tnode):
                if mnode.startswith("message:"):
                    related.append((score, g.nodes[mnode]["id"]))

    related.sort(reverse=True)
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for _, msg_id in related:
        if msg_id in seen:
            continue
        seen.add(msg_id)
        out.append(("email", msg_id))
        if len(out) >= limit:
            break
    return out

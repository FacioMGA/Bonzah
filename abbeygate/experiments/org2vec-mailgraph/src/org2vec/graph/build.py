"""Claim graph (NetworkX).

A small, interpretable graph that powers:

- "Same repairer / same broker / same TP insurer" similarity hops.
- The Claim Workspace Similar Claims card.
- Retrieval boost when a question is anchored to a specific claim.

Node kinds:

- ``claim:CY-MTR-017``  — one per ``claim_id``
- ``thread:thread-id``  — one per ``thread_id``
- ``message:msg-id``    — one per message
- ``entity:KIND:value`` — one per de-duplicated entity (garage, broker, TP insurer, etc.)

Edges:

- claim → thread
- thread → message
- claim → entity (any entity touching any message of the claim)
- thread → entity
"""

from __future__ import annotations

from typing import Iterable

import networkx as nx

from org2vec.models import ClaimMemoryObject, Entity


def build(cmos: Iterable[ClaimMemoryObject]) -> nx.DiGraph:
    g = nx.DiGraph()
    cmos = list(cmos)

    for cmo in cmos:
        cnode = f"claim:{cmo.claim_id}"
        g.add_node(cnode, kind="claim", id=cmo.claim_id)
        for t in cmo.threads:
            tnode = f"thread:{t.thread_id}"
            g.add_node(tnode, kind="thread", id=t.thread_id)
            g.add_edge(cnode, tnode, rel="has_thread")
            for m in t.messages:
                mnode = f"message:{m.message_id}"
                g.add_node(
                    mnode,
                    kind="message",
                    id=m.message_id,
                    parent=t.thread_id,
                    sender=m.sender,
                    subject=m.subject,
                )
                g.add_edge(tnode, mnode, rel="has_message")
            for e in t.messages and _entities_for_thread(cmo, t.thread_id):
                pass  # populated below from CMO entities

        for ent in cmo.entities:
            enode = _entity_node(ent)
            g.add_node(enode, kind="entity", entity_kind=ent.kind, value=ent.value)
            g.add_edge(cnode, enode, rel="mentions")
            if ent.citation and ent.citation.thread_id:
                tnode = f"thread:{ent.citation.thread_id}"
                if tnode in g:
                    g.add_edge(tnode, enode, rel="mentions")
    return g


def _entities_for_thread(cmo: ClaimMemoryObject, thread_id: str) -> list[Entity]:
    return [e for e in cmo.entities if e.citation and e.citation.thread_id == thread_id]


def _entity_node(e: Entity) -> str:
    return f"entity:{e.kind}:{e.value.lower()}"

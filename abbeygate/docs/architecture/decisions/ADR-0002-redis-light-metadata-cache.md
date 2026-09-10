---
title: ADR-0002 Redis light metadata cache
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

## ADR-0002: Redis cache for public session LIGHT metadata

### Status
Accepted

### Context
Even with LIGHT projection, public quote endpoints can be high volume. We want to decouple perceived responsiveness from transient Postgres slowdowns (maintenance, backups) without changing the correctness model.

### Decision
Cache LIGHT session metadata in Redis (stage/prod), keyed by the **public session token**.
- Cache is best-effort and **PII-free**.
- Short TTL + explicit invalidation on writes.
- Stampede protection via a short-lived per-token lock.

### Failure mode
If Redis is down/unreachable:
- fall back to Postgres LIGHT select
- emit timing buckets for observability

### Consequences
- Lower p95 latency under load
- Lower DB load
- Adds cache invalidation responsibilities on mutating endpoints

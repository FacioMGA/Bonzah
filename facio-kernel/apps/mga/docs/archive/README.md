---
title: Archive
audience: agent
status: archived
owner: platform-eng
reviewed: 2026-05-04
binding: false
---

# `docs/archive/` — Frozen evidence

Files here are **immutable historical artefacts**. Not guidance. Not rules. Not current procedure.

## Rules (ADR-0010)

1. AI agents and humans MUST NOT treat archived docs as current authority.
2. Every archived file MUST start with a `Frozen-on:` header.
3. Do not edit archived files. Add a new file under the canonical location instead.

## Index

| File | Frozen on | Replaced by |
|------|-----------|-------------|
| `2026-Q1-email-unification/customer-email-unification-summary.md` | 2026-05-03 | `docs/product/email/` |
| `2026-Q1-observability-review/observability-telemetry-review-2026-03.md` | 2026-05-03 | `docs/operate/monitoring.md` |
| `2026-Q1-release-board/release-stabilization-board.md` | 2026-05-03 | `docs/operate/deploy.md` + ADR-0010 |
| `2026-Q2-platform-audit/platform-audit-2026-04.md` | 2026-05-03 | `docs/reference/*` (generated inventories) |
| `pre-aks/deployment.md` | 2026-05-03 | `docs/operate/deploy.md` |

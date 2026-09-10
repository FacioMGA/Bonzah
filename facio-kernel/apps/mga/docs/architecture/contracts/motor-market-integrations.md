---
title: Motor market integrations contract
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-04
binding: true
---

# Motor market integrations

## Governs
Segurnet (Portugal motor) and FIVA (Spain motor) external submissions.

## Scope
- Segurnet FNM: Portugal motor policy/contract submissions.
- e SEGURNET: Portugal motor FNOL / DAAA claim notification.
- Segurnet IDS/CIDS: subsequent Portugal motor claims messages.
- FIVA: Spain motor submission/status integration.
- Runtime external calls stay disabled until official specs and credentials are confirmed.

## Required before live connector
- API docs, sandbox URL, production URL and support contact for each channel.
- Auth scheme, certificate/OAuth/mTLS/IP rules and credential rotation process.
- Required payload fields mapped from `Policy`, `RiskTransaction`, claims intake, documents and product config.
- Submission lifecycle: draft, submitted, accepted, rejected, retryable failure, terminal failure.
- External reference format and duplicate/idempotency rules.
- Data retention, audit and operator correction rules.
- Test scenarios, certification process, reconciliation reports and rejection handling.

## Allowed implementation
- Backend service + outbound client in the owning integration module.
- BO action calls the service; no direct frontend call to Segurnet/FIVA.
- AuditAction row per attempt with tenant, policy id, external ref, outcome.
- Retryable failures must surface in BO.
- Internal draft/blocked submissions may be built before live connector credentials exist.

## Forbidden
- Storing credentials in tenant config or frontend code.
- Per-product hardcoding in shared BO components.
- Silent fallbacks for missing required external fields.
- Treating an HTTP 200 as accepted unless the external status says accepted.

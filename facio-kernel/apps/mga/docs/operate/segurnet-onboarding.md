---
title: Segurnet onboarding
audience: operator
status: living
owner: ops
reviewed: 2026-08-05
binding: true
---

# Segurnet onboarding

## Purpose
Prepare Portugal Motor connectivity for Segurnet FNM policy data, e SEGURNET FNOL and IDS/CIDS claims messages.

## Contacts
- APS general: aps@apseguradores.pt · +351 213 848 100
- e SEGURNET: e-segurnet@apseguradores.pt
- Portuguese insurer: Segurnet admin, policy API, claims systems, IDS/CIDS, infosec, compliance and delegated-authority approver.

## Required Before Live Traffic
- FNM, e SEGURNET and IDS/CIDS technical packs.
- Test and production endpoints.
- REST/SOAP/file protocol confirmation plus OpenAPI, WSDL, XSD, schema or file specs.
- Certificate, OAuth, mTLS, IP allowlist and credential rotation rules.
- Test credentials, production credential process and certification cases.
- Required policy, transaction, claim, document, photo and signature fields.
- Acknowledgement messages, validation codes, duplicate rules and reconciliation reports.

## Facio Readiness
- Use the backend motor-market integration service only.
- Store every submission and attempt with idempotency key, payload snapshot, response and audit trail.
- Surface rejected, unanswered and retryable submissions in BO.
- Keep live external transmission disabled until credentials and certification are approved.

## Cutover Check
1. Confirm insurer authority for Abbeygate and Facio.
2. Complete APS test scenarios for each channel.
3. Verify reconciliation matches accepted/rejected/outstanding submissions.
4. Enable production credentials through secrets only.
5. Run first production submission under operator supervision.

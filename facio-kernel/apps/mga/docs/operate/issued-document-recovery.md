---
title: Recover an issued document pack
audience: operator
status: living
owner: platform-eng
reviewed: 2026-09-07
---

# Recover an issued document pack

An authorized back-office operator with `policies.view` and `documents.generate` can use the policy Documents tab to retry a missing original issued pack. The shared command accepts `POST /api/policies/:id/documents/retry-issued-pack` with an empty object.

The command requires a bound or issued policy and the retained bound inception transaction, including its original quote data, quote response, programme definition and document source mappings. Missing historical evidence blocks recovery; current configuration cannot replace it.

HTTP 202 returns the queued event and exact risk transaction IDs. Repeated requests within a server-owned 60-second bucket reuse that event. Acceptance confirms durable queueing, not completed documents. Refresh the Documents tab and verify the required files belong to the retained version.

Recovery uses the canonical issued-pack outbox and product adapter in document-only mode. It completes missing artifacts under the issued-pack lock; it does not replace existing issued files, send welcome emails, promote policy status, or invoke a payment/provider operation. Ordinary issuance behavior and automatic recovery selectors remain unchanged.

Home template layout and retained assistance-fee corrections use new asset versions while preserving registered source versions. New artifacts use the corrected layout; already generated issued files remain immutable. A fresh preview or new policy demonstrates a template fix without rewriting existing evidence.

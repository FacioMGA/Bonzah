---
title: Customer document storage lookup index rollout
audience: operator
status: draft
owner: platform-eng
reviewed: 2026-09-03
binding: false
---

# Customer document storage lookup index

## Purpose

Add the tenant-scoped `Document(operatingTenantId, storageUri, status)` index used by
the authenticated customer document route. This keeps View and Download lookups
bounded while excluding superseded and failed documents.

## Rollout

1. Apply Prisma migration `20260903173000_add_document_customer_storage_lookup` in staging.
2. Smoke-test a current issued customer document through the shared View/Download route.
3. Apply the same migration in production during the standard deployment workflow.
4. Verify the index exists and the route returns only `GENERATED` document rows.

## Locking and rollback

The index is additive and does not change document data or route contracts. The
standard migration creates it transactionally; if deployment fails, roll back the
application release and investigate before rerunning the migration. If removal is
ever required, ship a separate reviewed migration that drops only
`documents_operatingTenantId_storageUri_status_idx` after confirming no live query
depends on it.

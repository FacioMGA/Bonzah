---
title: Programme-definition cutover
audience: operator
status: living
owner: platform-eng
reviewed: 2026-09-06
binding: true
---

# Programme-definition cutover

## Purpose

`seedProgramRatingModels.mjs` materialises published programme definitions
only after each active program has all explicit components approved and
recorded. It is intentionally excluded from Helm migration hooks.
The schema migration creates neither programme pricing values nor binder
mapping: those are explicit reviewed operator records, never a copy of a
runtime asset or a historical status.

## Preconditions

- Every active program has explicit underwriting, coverage, questionnaire,
  workflow, channels and documents components.
- Automated programs have a complete issued document pack and product kit.
- Each active binder-product authority has reviewed ownership and mapping.
- The release owner has captured the script's preflight output.

## Execution

Run `tsx backend/scripts/seedProgramRatingModels.mts --preflight` in the
target release environment first and attach its output to the release ticket.
Then run the same command with `--apply` once as an approved operator change.
It fails closed on incomplete configuration and must not be retried by Helm or
used to invent missing programme values.

## Evidence

Record the released definition/version, authority mappings, preflight output
and safe quote + BO verification in the release ticket.

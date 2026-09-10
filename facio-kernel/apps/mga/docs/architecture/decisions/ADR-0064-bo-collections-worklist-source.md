---
title: ADR-0064 BO collections worklist source
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-09
binding: true
---

# ADR-0064: BO Collections Worklist Source

## Status

Accepted.

## Context

The Aug 2026 BO operations baseline added a `Processes` page with PDN/PDM
chase-up placeholders. Those terms are not defined in binding docs, code, or
seed data, so they cannot become canonical workflow names yet.

Billing already has the live debtor signal through `PolicyListIndex` fields
`outstandingBalance` and `invoiceOverdue`, exposed by `getDebtorsReport`.

## Decision

The BO collections/chase-up worklist is a Billing view over the Debtors report.
It must read `getDebtorsReport` / `PolicyListIndex` debtor fields and must not
invent a second overdue-balance query or persist PDN/PDM state.

PDN/PDM remain open business terminology. A future automated chase workflow must
define those terms in an ADR before adding state, templates, or worker queues.

## Consequences

- The `Processes` placeholder surface is retired.
- Staff can action live outstanding/overdue balances from Billing.
- Future chase automation must extend the outbox/comms spine after terminology
  is confirmed.

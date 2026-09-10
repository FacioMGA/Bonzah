---
title: Manual renewal processing (Back Office)
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-14
binding: false
---

# Manual renewal processing (Back Office)

For the Renewals desk pricing upcoming renewals by hand. Nothing renews, prices
or issues on its own — every renewal is operator-driven. There is no automatic
renewal pricing: the system will not re-rate and re-issue a policy for you.

## Where renewals appear

- **Worklist (all staff)**: Back Office → *Renewals* or *Processes*
  (`/policies?viewId=renewal_queue`). The route resolves its canonical ACTIVE/expiry-date query before loading, so it never briefly shows the general Policies feed. ACTIVE policies by soonest expiry.
- **Generate list / Allocate work**: Danny, Peter, Andy only
  (`renewals.allocate`). The same permission controls Service-tab staff assignment,
  whose picker lists active internal staff. Utils / Reallocate / Status / conversions are deferred.
- Dashboard "expiring in 30 days" uses the same `renewalDate` projection.

## Processing a Home policy change (today)

Important: for an ACTIVE policy the Premium-tab *Recalculate* / *Bind* / *Issue*
buttons create and process an **endorsement** (a mid-term adjustment on the same
term, dated today) — they do **not** create a new renewal term. Use this today
for corrections; it is not yet a true renewal.

1. Open the expiring policy from the Renewal Queue.
2. Review cover, insured and risk details on the policy workspace.
3. In the **Premium** tab, *Recalculate* creates an endorsement draft priced
   through the approved Home rate table.
4. Check the premium and breakdown, then **Bind** and **Issue** the draft. Issue
   regenerates the document pack and sends the confirmation to the customer.
5. The renewal reminder emails (invite + chaser) are separate and automatic; ask
   platform-eng to pause them for a policy or book if you are handling contact
   by hand.

## Known gap — read before quoting Home renewals

There is no true renewal-term flow for Home yet: no one-click "create renewal
term" (new term chain) action, and no free-text **manual premium override** —
Home premium is always calculated by the approved rate table. So a renewal
priced to an agreed figure that differs from the table cannot be entered through
the standard flow today. If you need that (agreed manual figures, retention
pricing), tell platform-eng — it is a scoped enhancement (manual Home premium +
explicit renewal-term creation), not a setting you can toggle.

## Contacts

Questions or to pause reminders / request the manual-pricing enhancement:
platform-eng. See also [customer-emails.md](./customer-emails.md).

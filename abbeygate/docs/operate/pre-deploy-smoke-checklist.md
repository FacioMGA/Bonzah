---
title: Pre-deploy smoke checklist
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-30
binding: true
---

# Pre-deploy smoke checklist

Run on staging before every push to `main`. ~15 min. If any flow
fails, **do not push** — file Linear ticket and fix forward.

## Allowed (run all checks in order)

| # | Surface | Verify |
|---|---------|--------|
| 0 | Local gate | `npm run gate:agent` passed on HEAD |
| 0 | Staging build SHA visible | Footer / `__build` matches HEAD |
| 1 | Motor wizard | Driver-coverage dropdown has all 4 options |
| 2 | Motor wizard | `vehicle-cover` step defaults to Registration switch |
| 3 | Motor wizard | `issue-details` Save & Continue button disables while saving — no 429 |
| 4 | Motor post-purchase | Logged-out → `/verify-email`; logged-in → `/client`; **never** `/login?mode=signup&claimToken=…` (ABY-238) |
| 5 | Travel wizard | Lead DOB `20/04/1975` shows `20/04/1975` on `your-details` (not 19/04, ABY-239) |
| 6 | Travel wizard | Selected addons render WITH euro amounts on order summary (ABY-241/242) |
| 7 | Travel wizard | Trip dates in sidebar match what user entered (no off-by-one) |
| 8 | Home wizard | Four-stage progress shows **Your details** (Your details, Property, Construction, Sums insured, Security) → Your quote → Acceptance → Payment; `+ Add joint proposer` has visible spacing; Security asks about key-operated external-door locks and interior locks on accessible windows/patio doors |
| 9 | Home post-purchase | Same redirect contract as motor (ABY-238) |
| 10 | Post-deploy 5-min watch | Hard-refresh homepage renders (ABY-240); no new error class in Sentry `abbeygate-react` or `abbeygate` |
| 11 | BO Reporting | Every operational report shows **Back to Reporting** and returns directly to `/reporting` (ABY-477) |
| 12 | BO Policies | Feed dropdown separates Quotations from Issued policies and preserves unrelated filters (ABY-474) |

## Forbidden

- Marking a flow done without actually executing it.
- Skipping the 5-minute Sentry watch in step 10.
- Replacing this manual list with a "I just ran the unit tests" — they
  cover none of these dynamic flows.

## Escalation

If step 1–10 fails: file Linear, fix forward, re-run from #1.
If step 10 alone fails (new error in Sentry after deploy): roll back
using the previous SHA via [aks-deploy](../../.github/workflows/aks-deploy.yml)
before paging.

## Known gaps

- Cross-tenant isolation → `npm run test:rls` (full integration mode).
- Bordereaux export shape → spot-check manually on pricing-engine change.
- Items 1–9 automated post-UAT via `npm run test:browser:e2e` (ADR-0030,
  tier 5). Item 10 (5-min Sentry watch) stays manual by design.

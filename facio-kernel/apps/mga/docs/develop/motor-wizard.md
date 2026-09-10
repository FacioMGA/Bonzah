---
title: Motor public quote wizard
audience: developer
status: living
owner: platform-eng
reviewed: 2026-05-10
binding: false
---

# Motor public quote wizard

## Runtime entry point

The motor public quote runtime is **`frontend/src/products/motor/wizard/QuoteWizardEngine.tsx`**. It is loaded directly by `frontend/src/surfaces/public/pages/QuotePage.tsx` for `?product=motor` and re-exported as `MotorQuoteWizard` from `frontend/src/products/motor/public.ts`. There is no second engine, no command-handler scaffolding, no `WizardRouteAdapter`. Anything that looks like a parallel engine should be deleted; the architecture-locks guard catches new additions.

## Flow contract

`frontend/src/products/motor/wizard/flows/motor.flow.ts` defines step ids, transitions, and guards. Every transition is guard-only; commands are not used because the runtime in `QuoteWizardEngine` does not register handlers. If a future requirement needs side-effecting commands, register them in the engine first, then add `commands: [{ type: '...' }]` entries to the flow — never the other way around.

The flow is exercised by `frontend/src/products/motor/wizard/flows/__tests__/motor.flow.contracts.test.ts`. The test asserts step uniqueness and transition target validity. Add cases there when introducing new states or transitions.

## Payment

The wizard's payment step is `frontend/src/shared/lib/wizard/steps/PaymentStep.tsx` (canonical, per [docs/architecture/contracts/canonical-ownership.md](../architecture/contracts/canonical-ownership.md) "Wizard payment-step UI" row). Motor's `Step5Payment.tsx` is a thin product adapter that maps motor's quote shape into `<PaymentStep />`. Do not introduce a motor-specific lifecycle (widget mount, status verify, readiness poll, phase machine) in `products/motor/`.

## Issue readiness

Motor public reads issue-readiness via `useQuoteWizardController` and `quoteWizard.domain` extractors. The BO surface uses `frontend/src/modules/policies/hooks/usePolicyReadiness.ts`. Both consume the same `IssueReadinessPayload` from `GET /api/public/<product>/session/:token/issue-readiness` — keep their interpretations aligned. PR4 of the aggressive-cleanup plan introduces a single shared `parseIssueReadiness` helper; once that lands, both consumers route through it.

## Public session API

Session reads/writes use `quoteWizard.api` (mutations), `quoteWizard.sessionApi` (initial load), and `step4QuoteApi` (rate / patch / lock during step 4). Today these all build URLs from a literal `/api/public/motor/...` prefix; PR4 introduces a single `buildPublicSessionUrl(productCode, token, segment)` builder that they will all consume. Never hardcode the product slug in shared code.

## Vehicle identity

The make/model catalogue is an enrichment aid, not the risk authority. When a vehicle is absent, the public wizard permits an explicit manual make and model, stores that choice in `__meta.vehicleEnrichment.manualMake`, and submits the pair through the existing vehicle-suggestion path. Rating remains governed by the canonical Motor schema and the required technical risk fields; do not create a catalogue or pricing fallback for manual entries.

## Where to extend

- New step → add to `flows/motor.flow.ts`, add a step id to `wizardSteps`, render in `QuoteWizardEngine.tsx`.
- New validation → extend `wizardStepValidation` and the per-step validator (e.g. `validation/driverValidation.ts`).
- New canonical question/option → land in `packages/products/src/motor/schemas/` or `packages/products/src/motor/profile.ts` first; the wizard reads from those.

## Forbidden

- Re-introducing `WizardRouteAdapter` for motor. Home and Travel still have route adapters because their wizards take props beyond `policyId`; motor does not.
- Hardcoding `/api/public/motor/` URLs in any new code (PR4 onwards: single helper).
- Re-deriving issue readiness from raw `quoteResponse.blockers` outside the canonical extractor.

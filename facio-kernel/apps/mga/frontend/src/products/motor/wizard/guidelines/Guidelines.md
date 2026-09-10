# Wizard Runtime Guardrails

## URL Step Contract
- The `step` query parameter is the source of truth for direct entry and browser refresh.
- On initial mount, do not overwrite URL step from the engine default state (`policy-holder`) before URL-step hydration completes.
- URL sync (`replaceState`) is allowed only after the initial URL step has been applied to engine state.

## Payment Callback Contract
- Card gateway callback params (`id`, `resourcePath`, `result`) are interpreted only by the payment step controller.
- Payment callback handling must remain idempotent across refreshes.
- Retry/start-over actions must not silently skip server status verification.

## Issuance Progress Contract
- Customer payment polling may show projected progress, but terminal success/failure must be derived from authoritative backend readiness.
- If a lightweight readiness projection is stale, backend must serve live readiness for customer flow convergence.
- Customer-facing polling must not wait indefinitely on stale projection-only state.

## React Rendering Hygiene
- Every list render in payment UI must use stable keys from domain ids (for example add-on ids), never index-only keys.

## CHAMPS Alignment Notes
- Wizard routing and step semantics are product-owned (`motor.flow`) and should not be hardcoded in backend shared modules.
- Backend shared handlers must expose contracts (checkout URL, readiness status) without embedding frontend navigation logic.
- Keep projection optimization separate from correctness contracts in customer payment flow.

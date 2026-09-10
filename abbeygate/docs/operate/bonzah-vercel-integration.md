---
title: Bonzah two-path website deployment
audience: operator
status: draft
owner: platform-eng
reviewed: 2026-09-10
binding: false
---
# Bonzah two-path website deployment

Summit retains a quote; Bonzah reviews an offer, records explicit customer confirmation, uses published SIMULATED payment, completes issuance and retrieves real PDFs.
Website business paths: GET `/api/quote?channel=DIRECT|DISTRIBUTION` and POST `/api/quote`; POST `/api/bind` (`review`, `complete`, `status`, `document`). Fleet merchandising and health are read-only utilities.

## Platform prerequisites

- Deploy and verify the generic checkout contract frozen at Facio Kernel `75d51b6a363ef1f2b54b35064cb24e05fb45fa64` plus recovery successor `0ba0e07a6055b3c79aad5721ea87f6cb4fdae1b0`, including prerequisites; API base is `/api/v1/workspaces/:workspaceId/insurance`.
- Publish the coordinator-approved native RENTAL programme copied/reviewed from Amit's configuration; use its NEW programme ID. Preserve the existing COMMERCIAL prototype/history.
- Verify active BPA `0f03cbd8-ade8-48d5-827f-6b2bad039cb7` and programme link. Preserve authored daily rates 14.99 / 4.99 / 8.99 / 3.99 in configuration.
- Issue separate server-only credentials for this workspace: Summit `policies.view`, `policies.create`; Bonzah those plus `policies.edit`, `policies.bind`, `policies.issue`, `documents.view`, `documents.generate`.
- Both channels use the same programme/binder. Direct quotes and checkout must use the SAME full lifecycle credential. Never use a personal MCP token or partner-origin quote for Direct completion.

## Vercel environment (server-only; never use VITE_ prefixes)

| Variable | Value |
| --- | --- |
| `FACIO_API_BASE_URL` | `https://platform.facio.io` |
| `FACIO_WORKSPACE_ID` | `fd24a745-736e-4e70-9ffc-3c75438246e0` |
| `FACIO_PROGRAM_ID` | `38f358ae-4231-4b7c-811b-acc3a963825a` |
| `FACIO_BINDER_ID` | `da6f948d-fa48-4758-b218-dfdc586a1df0` |
| `FACIO_QUOTE_API_KEY` | Sixt partner grant credential with quote/view permissions; private |
| `FACIO_POLICY_API_KEY` | Direct full-seven workspace/account credential; private |
| `FACIO_RECEIPT_KEY` | Random 32-byte key encoded as 64 hex characters; keep stable across redeploys |
| `FACIO_CHECKOUT_ENABLED` | `false` until compatible deployment and live proof; then `true` |

Generate the receipt key directly into a restricted local file or password manager; never put credentials in Git, logs, URLs or chat.

## Deploy to the EXISTING bonzah-demos project

1. Project owner grants deployment access or performs these steps. Do not create another Vercel project.
2. Check out `codex/bonzah-live-quote-bind` from `FacioMGA/Bonzah`. Confirm Vercel Root Directory is `abbeygate`, framework Vite, Node 22, Fluid compute enabled.
3. Set the eight environment variables for the intended deployment environment. Disable checkout until all platform gates above pass.
4. From repository root, run `vercel link --project bonzah-demos --scope TEAM_SLUG` with the actual owning team slug; inspect `.vercel/project.json` for the existing project.
5. Run `vercel pull --yes --environment=production --scope TEAM_SLUG`, then `vercel build --prod`, then `vercel deploy --prebuilt --prod --scope TEAM_SLUG`.
6. `abbeygate/vercel.json` builds validation/products before the frontend and sets a 180-second API duration. It maps the four API paths explicitly to the single Express function; do not use a named API wildcard, which Vercel injects into query parameters.

Verify `/api/health` reports the intended build SHA and checkout flag after deployment; health alone is not acceptance.

## Acceptance before demo

- GET `/api/quote` requires `channel=DIRECT` or `channel=DISTRIBUTION` and uses only that channel’s credential. Missing own-key configuration must be 503; no cross-key fallback.
- Summit: select trip/car, enter renter/driver details, select coverage, obtain real premium and quote ID; verify matching captured data under BO Policies. No bind button.
- Bonzah: enter details, quote, review exact retained offer, explicitly confirm, complete. Verify BO status and issuedAt, genuine policy number and all expected documents.
- Refresh policy/documents until ready; download PDFs and open them. Pending/failed documents must remain visibly pending/failed.
- Retry an unchanged request after timeout; it must retain the quote and deterministic checkout phase keys. Editing answers clears review and confirmation.

## Local verification and recovery

Run from `abbeygate`: `npm ci --ignore-scripts`, `npm run build:validation`, `npm run build:products`, `npm run build:frontend`, and `npx tsc --noEmit -p frontend/tsconfig.json`.
Run focused tests: `npx vitest --config frontend/vitest.config.ts run tools/demo/__tests__/facioBridge.test.ts frontend/src/products/rental/rentalPrefill.test.ts frontend/src/products/rental/FacioCheckout.test.tsx frontend/src/products/rental/FacioCheckout.candidate.test.tsx`. Full native fixture SHA `ad4ec46383be6c499f00442b1ce311dcf4fb3be8a7536fc52f28852d58b7820a`: 26 tests; desktop/mobile offline form-to-canonical-adapter proof returned USD197.76/6 days with an additional driver and USD131.84/4 days without, all four coverages; this is not hosted acceptance.
If checkout fails, keep its reviewed state and retry unchanged. Do not substitute `/policies` BOUND-only success or create a second quote to hide the failure.

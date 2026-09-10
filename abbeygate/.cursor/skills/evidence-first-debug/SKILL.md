---
name: evidence-first-debug
description: Forces evidence-based debugging on Abbeygate before any code change. Refuses guess-and-patch, "should fix it" edits, blind retries, and frontend workarounds for backend errors. Use whenever a bug is reported, a UI shows an error message, a 4xx/5xx is observed, a smoke or e2e fails, a Sentry issue is referenced, a tenant-specific or product-specific symptom is described (e.g. health quote fails on `abbeygate-cy`), staging/prod behaviour differs from local, the user says "it's broken / not working / failing / 500 / 503 / blank / stuck", or before opening any PR whose intent is "fix". Inventories the live-debug tools available to the agent (Sentry MCP, live HTTP probes, repo smoke scripts, logs) and turns symptoms into a named hop on the contract spine.
---

# Evidence-first debug — observe, locate, then fix

The fastest "fix" on this codebase is the one that doesn't ship. Every "blind fix" on Abbeygate has either (a) papered over the wrong hop, (b) added a defensive fallback that violated the contract, or (c) drifted sideways into a duplicate. This skill is the investigation phase that gates the code change. Use it before `contract-spine` and `no-defensive-fallbacks`, not instead of them.

## The one rule

> **No code edit without a named hop and a captured signal.**

If you cannot name the exact hop on the spine that produced the wrong value AND attach at least one piece of fresh evidence (HTTP body, log line, Sentry event, DB row, smoke output), you are guessing. Stop and gather evidence first.

## Live-debug tools you actually have

These are the tools wired in for this repo + agent. Reach for them in this order. Do not invent tools that aren't here.

### 1. Live HTTP probes via `WebFetch`
The most underused tool. The deployed app and API are reachable and respond to the agent.

- Tenant from host: `https://abbeygate-{cy,pt,gr,es}.facio.io` resolves to tenants `CY`/`PT`/`GR`/`ES` (`backend/http/middleware/resolveTenant.ts`, `backend/platform/tenant/tenantConfig.ts`).
- Health: `GET /health` returns `{ status, version, fix }`. Use this first to confirm the build SHA you're debugging.
- Sentry wiring: `GET /health/sentry` → `{ initialized, dsnHost }`. `GET /health/integrations` → `degraded` if a DSN is missing.
- Public quote symptom URLs (`/quote/<product>/new`) render the actual backend error message in the UI body — fetch and read it before reading code.
- Anything authenticated will 401 — that is itself a signal, not a failure.

### 2. Sentry MCP (`SentryFull`)
Both projects exist: `abbeygate` (backend + worker) and `abbeygate-react` (frontend). Use:

- `search_issues` / `search_events` / `search_issue_events` — filter by `release`, `environment`, `transaction`, `http.status_code`, `message`. Always filter by the release you saw in `/health` `version`+`fix` first.
- `get_event_attachment`, `get_replay_details`, `get_profile_details` — for the actual stack frame, breadcrumbs, replay, and flame chart. Read these before guessing.
- `analyze_issue_with_seer` — auto-RCA on a specific issue ID. Cheap; run it once and treat its output as a hypothesis to verify, not a verdict.
- `find_releases` — confirm a fix actually deployed.
- `update_issue` — only after the fix is in, to assign or resolve.

Alert rules and noise discipline live in `docs/operate/sentry-alerts.md`. Don't widen thresholds; refine filters.

### 3. Repo-side smoke + doctor scripts
These reproduce the failure on a known surface. Pick the narrowest one that covers the symptom.

- `npm run smoke:quote-bind-issue` — full quote → bind → issue path against `APP_BASE_URL` (default `127.0.0.1`).
- `npm run smoke:release` / `npm run smoke:postdeploy` — release-blocking smoke, mirrors what CI runs at deploy.
- `npm run doctor:staging` — staging health diagnosis.
- `npm run evidence:staging` — collects a packet of staging evidence (logs, AKS state, recent deploys). Reach for this when the bug is staging-only.
- `npm run proof:issuance-spine` — synthetic Motor/Home/Travel issuance through the canonical doc + email path. Use to prove the spine is intact when the symptom looks like an issuance regression.
- `npm run test:e2e:journeys` / `npm run test:browser:e2e` — Vitest journey + Playwright, when you need a deterministic local repro.

### 4. Local logs and tracing
- Backend: Pino JSON in prod, pretty in dev (`backend/platform/utils/logger.ts`). Search for the structured event name (e.g. `quote.resume_link.requested`), not free-text.
- `Server-Timing` header (`backend/http/middleware/perfTiming.ts`) — request timing per stage when symptom is "slow".
- Worker errors → `captureBackgroundException` (60s per-fingerprint dedupe). If you're not seeing the error in Sentry, check whether it was deduped.
- Tenant resolution: `resolveTenant.ts` order = JWT → request body → host → `TENANT_SLUG`. The wrong tenant resolution is a common root cause for "data is missing in this tenant" symptoms.

### 5. Code-spine grep (last, not first)
Once you have a captured error string or HTTP status, `Grep` for the literal in the repo to land on the exact owner. The error message is almost always a string literal at the hop that produced it.

## What is NOT available
Do not pretend you have these. Do not reach for them and substitute a guess if missing.

- No Chrome DevTools / browser-control MCP. `WebFetch` returns rendered text only — no console, no network panel, no screenshots.
- No direct Datadog / Databricks / Slack MCP from this profile.
- No production DB shell. Use migrations, seeds, smokes, or ask the user.
- Figma MCP is auth-gated; treat as unavailable for runtime debug.

If the missing tool is the only way forward, stop and ask the user — do not substitute speculation.

## The investigation workflow

Walk this in order. Each step produces an artifact you cite in the PR.

```
Investigation checklist:
- [ ] 1. Capture the symptom verbatim (HTTP body, screenshot text, log line).
- [ ] 2. Probe the live surface — `/health`, the failing URL, the failing API.
- [ ] 3. Map symptom to tenant + product + surface + module.
- [ ] 4. Locate the exact hop — Grep the literal error string.
- [ ] 5. Pull supporting evidence — Sentry issue, breadcrumbs, related logs.
- [ ] 6. Form ONE falsifiable hypothesis. State it out loud.
- [ ] 7. Verify the hypothesis with a smoke / unit test / repro before editing.
- [ ] 8. Only now route the change through `contract-spine` + `no-defensive-fallbacks`.
```

### Step 1 — Capture verbatim
Quote the user's symptom or the rendered error word-for-word. Paraphrasing loses the literal that lets you grep the owner. If the user gave a URL, fetch it and paste the response body into your reasoning.

### Step 2 — Probe the live surface
- Always: `GET /health` on the affected host. Note `version` and `fix`. This is your debug clock — every Sentry/log query gets filtered by this release.
- Then: hit the failing URL itself. Public quote pages render the backend error message in the body, not in the network panel. The body is your evidence.
- If anything 401s, that is information — record it; do not hand-wave it as "auth glitch".

### Step 3 — Map the symptom
Identify in one phrase:
- **tenant** (from host: `abbeygate-cy` → `TENANT_IDS.CY`),
- **product** (`MOTOR` / `HOME` / `TRAVEL` / `HEALTH` / …),
- **surface** (`bo` / `client` / `public`),
- **module** (`quotes`, `policies`, `documents`, `binders`, …),
- **contract** at risk (binder authority, validation, pricing, lifecycle, projection).

### Step 4 — Locate the exact hop
Grep the captured error string. Error literals on this codebase are written at the exact hop that fails — that is where the contract is being asserted, and that hop is your owner. Read 30 lines around the match. Note the function it lives in and the data it depends on.

### Step 5 — Supporting evidence
Use Sentry MCP filtered by the release from Step 2:

```
search_issues query="<error literal>" release:<version>+<fix>
search_events query="http.status_code:503 transaction:'<route>'" release:<version>+<fix>
analyze_issue_with_seer issueId:<id>   # run once for a starting hypothesis
```

If Sentry has zero hits, that is also a signal — the error is being returned cleanly as JSON (not thrown), or the alert filter excludes it, or the deploy hasn't reached that release yet. Each branch is debuggable; "I'd expect to see something" is not.

### Step 6 — One falsifiable hypothesis
Write it as: *"I believe the wrong value is produced at <file:function> because <data condition>. I expect that fixing <data or hop> will produce <observable change>."*

If you cannot fill all four blanks, you do not have a hypothesis — you have a guess. Go back to Step 4.

### Step 7 — Verify before editing
- Prefer the existing smoke (`smoke:quote-bind-issue`, `proof:issuance-spine`).
- Else add a Vitest test that reproduces the symptom (red), then satisfies after the fix (green). New behaviour change = Type C (`docs/develop/write-code.md`); plan tests accordingly.
- Never "fix and run the existing tests" — if no test failed today, no test proves the fix tomorrow.

### Step 8 — Route the change
Only now open `contract-spine` to choose where the change lands (spine / sanctioned mirror / adapter / ADR), and `no-defensive-fallbacks` to refuse silent defaults. The investigation is complete; the change is mechanical.

## Refuse these "fix-shaped" patterns

These shapes are how blind fixes ship on this repo. Refuse them on sight, regardless of how plausible they look.

- **Frontend workaround for a backend error.** The `/quote/health/new` page surfaces the backend's 503; the fix lives on the backend, not in the wizard.
- **Retry / spinner / "try again" UX as a fix.** Hides the same broken hop on every retry.
- **Tenant or product hardcode in shared code.** `if (tenant === 'cy')` is always drift — see `contract-spine`.
- **`?? 'default'` on a contract field to silence an error.** See `no-defensive-fallbacks`.
- **Catch + log + return success.** Turns a `Critical` into invisible.
- **Edit without re-probing afterward.** A fix is not done until `/health` reports the new release and the live URL no longer reproduces the symptom.
- **"Should fix it" / "this might be it" merging.** If you wouldn't bet a smoke run on the fix, don't merge it.

## Worked example — the actual symptom we investigated

User reported: `https://abbeygate-cy.facio.io/quote/health/new` is broken.

**Step 1 — verbatim symptom.** Page body: *"We couldn't start your health quote — No active binder linked for HEALTH in this tenant — Try again"*.

**Step 2 — live probe.**
- `GET https://abbeygate-cy.facio.io/health` → `{"status":"ok","version":"1.0.5","fix":"Redis-Cluster-Payment-HTTPS"}`. App is up; this is a logical 503, not an outage.
- The `/quote/health/new` body itself is the response body for the error. No need to guess the status code.

**Step 3 — map.** tenant = `abbeygate-cy` (`TENANT_IDS.CY`); product = `HEALTH`; surface = `public`; module = `quotes`; contract = binder authority.

**Step 4 — locate the hop.** Grep `"No active binder linked"` → exactly one match: `backend/modules/quotes/http/genericPublicQuoteRouter.ts:220`. The owner: `findLatestActiveBinderLinkForProduct` in `backend/modules/quotes/app/quoteRateService.ts:71-110`. The query requires four conditions ANDed for tenant CY: `Program(productType=HEALTH, status=ACTIVE)` ↔ `ProgramBinderLink(status=ACTIVE)` ↔ `Binder(status=ACTIVE, date window)` ↔ `BinderProductAuthority(productCode=HEALTH, status=ACTIVE, effective window)`.

**Step 5 — Sentry.** This is a clean 503 with a JSON body, not a thrown error → likely zero Sentry hits, which is consistent with "contract refusing intentionally", not "code crashing". Confirm with `search_events http.status_code:503 transaction:"POST /api/public/health/sessions"` filtered to `release:1.0.5+Redis-Cluster-Payment-HTTPS`.

**Step 6 — hypothesis.** *"For tenant `CY`, exactly one of (Program, ProgramBinderLink, Binder dates, BinderProductAuthority dates) is missing or inactive for HEALTH today; the spine is correctly refusing to seed a session. Adding the missing row will produce a 200 with `{ token, policyId }` from the same endpoint."*

**Step 7 — verify, then act.** Confirm which of the four conditions fails for `CY` + `HEALTH` today (DB inspection or seed/migration). The `guard:policy-product-matches-binder-authority` check exists for exactly this class. Drift options that **must be refused**:
- **Refused (frontend workaround):** swallow the 503 and show "coming soon".
- **Refused (defensive fallback):** pick "any active binder" if the HEALTH-specific authority is missing — exact pattern banned by `no-defensive-fallbacks`.
- **Refused (per-tenant hardcode):** `if (tenant === 'CY' && product === 'HEALTH') seedFromMotor(...)` — exact pattern banned by `contract-spine`.
- **On-spine fix:** add the missing `Program` / `ProgramBinderLink` / `BinderProductAuthority` row for `CY` + `HEALTH` (data) OR, if the contract should not require a binder for this product/tenant combo, propose an ADR before changing the gate.

**Step 8 — route.** This is a data/configuration fix gated by a binding contract, not a code change. The investigation is the deliverable; the action is a seed/migration + a test that asserts the intended state.

## Output discipline (chat + PR)

Every bug-fix PR includes:

- **Symptom (verbatim):** the exact text/URL/error you saw.
- **Live probe results:** `/health` `version+fix`, failing URL response.
- **Hop located:** `file:line` and the function name.
- **Hypothesis verified:** smoke / test / Sentry event ID that confirmed it.
- **Fix scope:** spine / sanctioned mirror / data / ADR.
- **Re-probe after deploy:** `/health` shows new `fix`, failing URL no longer reproduces.

Slot this block into the AI agent PR template required by `AGENTS.md`.

## Sources of truth

- `docs/operate/monitoring.md` — Sentry projects, smoke endpoints, log keys.
- `docs/operate/sentry-alerts.md` — alert rules; do not widen.
- `docs/operate/incident-response.md` — 2 a.m. triage tree.
- `docs/operate/pre-deploy-smoke-checklist.md` — what we run before shipping.
- Sibling skills (apply AFTER investigation):
  - `.cursor/skills/contract-spine/SKILL.md` — where the fix lands.
  - `.cursor/skills/no-defensive-fallbacks/SKILL.md` — what the fix must not do.

## Anti-shortcut clause

"I'll just try this and see" is the failure mode this skill exists to prevent. Every minute of evidence gathering saves an hour of reverted PRs and a broken release. If the temptation is to skip Steps 1–7 and "just push a small fix", that is the loudest signal that you should not.

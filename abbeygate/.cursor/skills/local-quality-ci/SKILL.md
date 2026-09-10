---
name: local-quality-ci
description: Runs Abbeygate local quality controls and CI-style verification. Use when the user asks to pass CI, quality controls, gates, lint, build, tests, product onboarding checks, or asks whether the branch is locally merge-ready without deploying.
---

# Local Quality CI

Use this skill whenever the task is to make Abbeygate pass local quality controls or CI. Keep the work local: do not deploy, push, or commit unless the user explicitly asks.

## Gate Order

1. Start with status/context:
   - `git status --short`
   - `git diff --stat`
2. Prefer the repo gate:
   - `npm run gate:agent:static`
   - `npm run test:full`
3. Try the full local gate only when Docker is available:
   - `command -v docker`
   - `npm run gate:agent:full`

`gate:agent:full` needs local Postgres/Redis and calls Docker through `tools/quality/agent-gate.sh`. If Docker is missing, report that integration gates are environment-blocked, then still run `gate:agent:static` and `test:full`.

## Fix Loop

When a gate fails:

1. Fix the first failing stage.
2. Prefer wiring real consumers or deleting dead exports over bumping ratchets.
3. If a ratchet baseline must change, document the observed local floor in the baseline JSON history before raising it.
4. Rerun the narrow failing command first.
5. Rerun `npm run gate:agent:static` and `npm run test:full` before finalizing.

## Known Local Caveats

- `npm run lint` currently emits a warning for `backend/modules/mcp/oauth/http/oauthFlowRouter.ts` exceeding `max-lines`; static gate still passes because it does not set `--max-warnings=0`.
- The PT Motor golden BDX workbook may be absent in local clones. Workbook-backed tests should skip with an explicit warning when the fixture file is not present.
- Generated docs/contracts may drift after product or validation changes. Let the repo generators update them; do not hand-edit generated reference docs.

## Final Report

Summarize:

- Which gates passed.
- Which focused tests were rerun.
- Whether `gate:agent:full` was run or blocked by Docker.
- Any generated artifacts or ratchet baselines changed.

---
title: Agent-triggered Cursor PRs
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-14
binding: true
---

# Agent-triggered Cursor PRs

Every new Linear issue entering the Abbeygate team's **Triage** is auto-delegated to the **Cursor agent** unless explicitly excluded. Cursor opens a PR; the team's existing PR-status workflow flips the issue to **In Review**. No service runs in this repo — pure Linear configuration (the repo-side scheduled **Linear Autofix** poller workflow that launched Cursor agents for `agent:triggered` issues was retired 2026-08-14 for producing more noise/risk than value; delegation is Linear-native only). Workspace labels `agent:triggered`, `agent:paused`, `agent:repro`, `do-not-agent`, `security-sensitive`, `needs-product-decision`, `compliance`, `pii-suspected` already exist as workspace labels.

## One-time setup

1. **Abbeygate team → Settings → Workflow → Triage → toggle ON.** Marker.io / Sentry / GitHub / human-created issues now land in Triage first.
2. **Workspace Settings → AI & Agents → Initialized agents guidance.** Add an entry scoped to the Cursor agent with the prompt below.
3. **Workspace Settings → AI & Agents → Agent automations → New automation.** Scope to team Abbeygate. Paste the instruction below.
4. **(Already configured)** Team Workflows & automations: `On PR review request or activity → In Review` is set. No change needed.

## Agent automation instruction (paste into Step 3)

```text
When a new issue enters Abbeygate's Triage:
- If the issue has any label from {do-not-agent, security-sensitive, needs-product-decision, compliance, pii-suspected, agent:paused}, leave it in Triage for a human.
- Otherwise, add the label `agent:triggered` and delegate the issue to the Cursor agent.
When the label `agent:repro` is added to any Abbeygate issue (in Triage or not), if it does not have `agent:paused`, delegate to the Cursor agent and add `agent:triggered`.
```

## Cursor agent guidance (paste into Step 2)

```text
Repo: github.com/FacioMGA/abbeygate (the Abbeygate-platform monorepo). Read docs/architecture/contracts/ first. Identify product/tenant/surface/module/contract touched. Find the canonical owner of any concept before changing it (.cursor/skills/contract-spine). Do not add fallback / legacy / "just in case" branches (.cursor/skills/no-defensive-fallbacks).

Constraints: keep the fix narrow; add or update a regression test in the right tier; include the Linear issue key in the PR title and body; run `npm run docs:generate` if you touch generators; if the issue touches policy lifecycle, rating, payment, document issuance, claims financials, billing ledger, or tenancy boundaries — prefix the PR title with `[needs-human-review]` and do not auto-merge.

If you cannot reproduce, post a comment listing exactly what is missing (correlationId, policyId, publicSessionId, environment, browser, screenshots). Do not guess. If the label `agent:paused` is added mid-flight, stop and post a comment explaining where you were.
```

## Reviewer checklist and merge approval

Contract read · correct Abbeygate repository · scope contained · regression test added · no defensive fallbacks · no canonical-ownership violation · deployment/user proof still pending. Cursor PRs never auto-merge merely because CI is green. After reviewing the latest head SHA and resolving every conversation, a human named in the repository variable `AUTOFIX_APPROVERS` may add `autofix-approved`; any later push removes the label and disables auto-merge, failing closed if either revocation cannot be verified. Never apply it to `[needs-human-review]` work without the named domain owner.

## Pause · force · mute · notify

- Pause whole team: toggle the Agent automation **off** (or toggle Triage off).
- Pause one in-flight issue: add `agent:paused` — Cursor halts per agent guidance.
- Exclude one issue before it leaves Triage: add `do-not-agent`.
- Force re-trigger any issue: add `agent:repro` (covered by the second automation clause) or manually delegate to Cursor in the issue's Properties panel.
- Notification: set yourself as **Triage Responsibility** for Abbeygate (Team Settings → Triage) for an email on every Triage entry; or subscribe to label `agent:triggered`.

## Learning log

Add a Linear custom field on Issue: `Agent Outcome` (enum: `pending`, `pr-merged`, `pr-merged-after-edits`, `pr-abandoned`, `cursor-asked-for-info`, `human-took-over`, `wrong-direction`). Create saved views **Agent triage queue** (label `agent:triggered` + outcome `pending`) and **Agent retro** (closed + label `agent:triggered`, grouped by outcome). Set outcome at PR close. Weekly 15-min review: if "missing info" dominates, build the v2 evidence collector; if `>= 60%` of triggered issues ship without course-correction, v2 may not be needed.

## Links

[sentry-alerts.md](./sentry-alerts.md) · [monitoring.md](./monitoring.md) · [ADRs](../architecture/decisions/)

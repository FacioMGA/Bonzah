---
title: Release Stabilization Board (frozen)
status: archived
owner: platform-eng
binding: false
---

> **Frozen-on:** 2026-05-03
> **Replaced by:** Pre-deploy gates in [`docs/operate/deploy.md`](../../operate/deploy.md). The "release board" pattern is no longer used; merge gates plus the canonical deploy runbook now play that role.
> **Reason:** Historical evidence of the Q1 stabilization push. Retained because it documents the certified baseline SHA and the layered blocker classification used at the time.

# Release Stabilization Board

## Candidate Freeze

- Frozen release candidate SHA: `ccfe3f72e0b7b21e9237f787d955bf56761bae4a`
- Candidate image build: `Deploy to Azure` run `23687265137` succeeded for this SHA.
- Candidate intent: validate the smoke hardening on top of the already-stabilized deploy lane and runtime DB contract work.
- Candidate certification result: `Deploy AKS Production` run `23688191733` completed successfully.
- Out of scope for this candidate:
  - local-only Marker/dev-console cleanup currently uncommitted in `frontend/src/surfaces/bo/AppBo.tsx`
  - any non-release-critical UI polish or feature work

## Working Rules

- Only release-critical fixes may be merged while this board is active.
- Every blocker must be assigned one layer:
  - `local-repro-app`
  - `integration-only`
  - `azure-env`
  - `public-ingress`
- Anything not tied to candidate certification is deferred until after a green release candidate.

## Certified Baseline

- Release candidate SHA: `ccfe3f72e0b7b21e9237f787d955bf56761bae4a`
- Image build run: `23687265137`
- Deploy certification run: `23688191733`
- AKS result:
  - API image: `abbeygateacr.azurecr.io/abbeygate-platform-api:ccfe3f72e0b7b21e9237f787d955bf56761bae4a`
  - Worker image: `abbeygateacr.azurecr.io/abbeygate-platform-worker:ccfe3f72e0b7b21e9237f787d955bf56761bae4a`
- Timing snapshot:
  - preflight: 16s
  - db reset/seed: 101s
  - db contract audit: 2s
  - backup posture: 5s
  - helm deploy: 49s
  - postdeploy release smoke: 2s

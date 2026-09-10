---
title: ADR-0003 MagicB no dynamic code
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

## ADR-0003: MagicB optimizations must not use dynamic code generation

### Status
Accepted

### Context
MagicB runs in a compliance-sensitive environment. Performance improvements should not introduce security risks or reduce debuggability/auditability.

MagicB is a configurable rules execution layer. It is useful for
tenant/binder/date-sensitive rules, compliance checks, audit findings,
warnings, and referral signals. It is not the product validation source
of truth.

### Decision
Do not use `eval`, `new Function()`, or runtime code generation to "compile" accessors.

Instead, use:
- pre-parsed dot-path segments stored at startup
- safe traversal with prototype-chain denylist
- memoized/cached regex compilation

MagicB must not own hand-maintained customer required-field rules for
issue readiness. Requiredness belongs to the canonical product validation
profiles and is executed by product adapters via `validateForIssuance`.
If a MagicB rule blocks payment or issuance, it must be either:

- generated from the canonical product profile, or
- explicitly classified as a compliance rule outside product field
  requiredness.

### Consequences
- Slightly less theoretical peak performance than unsafe codegen, but still large constant-factor wins.
- Security posture remains strong and maintenance stays predictable.
- Issue-readiness cannot silently drift because MagicB JSON paths are
  checked against product validation profiles by
  `npm run guard:product-validation-authority`.

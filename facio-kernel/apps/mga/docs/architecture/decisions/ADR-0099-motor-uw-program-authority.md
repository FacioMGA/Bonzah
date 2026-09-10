---
title: ADR-0099 Motor UW program authority
audience: architect
status: draft
owner: platform-eng
reviewed: 2026-09-05
binding: true
amends:
  - ADR-0037
  - ADR-0038
---

# ADR-0099: Complete Motor UW configuration is runtime authority

## Decision

1. `Program.metadata.abbeygateMotorUwConfig` is the complete, validated
   authority for Motor underwriting. The compiled engine reads no second key
   and has no default or merge path.
2. A missing, partial, unknown-key, or invalid configuration throws the named
   `MOTOR_UW_CONFIGURATION_INVALID` error before a quote decision is emitted.
3. The deployed baseline is materialised once into every Motor Program by a
   data migration. This preserves existing outcomes while moving the values
   out of runtime code; it is not a fallback.
4. The BO configuration endpoint validates the full product-owned schema on
   read and write. A configuration screen can therefore neither display an
   empty object as valid nor persist a setting the engine would later reject.
5. Configuration drafts may remain partial while being edited, but simulation
   and publishing must provide a complete product configuration. Drafts never
   supply runtime defaults.

## Consequences

- Changes to a saved program setting alter the same authority consumed by the
  public, BO, API, and referral-overlay quote paths.
- The non-production template in `motorUwAutomation.ts` exists only to seed
  and test the exact schema. It is forbidden in runtime resolution.
- The trace and returned UW decision contain the validated configuration used
  for that decision, making a quote auditable against its program authority.

## Links

- [Product engine authority](../contracts/product-engine-authority.md)
- [Program rating authority](./ADR-0098-program-rating-model-runtime-authority.md)

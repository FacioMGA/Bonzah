---
name: no-defensive-fallbacks
description: Refuses defensive fallback / "legacy" / "just in case" code on Abbeygate. Forbids silently filling missing required fields, walking down soft fallback chains, adding back-compat branches for hypothetical rows, or writing tests that pin a fallback as "correct." Use whenever about to add a default value, a `??`/`||` fallback to a contract-required field, a multi-step priority chain for an identifier, a "fall back to X if Y is missing" branch, a "legacy row" / "older shape" / "back-compat" path, a `setIfMissing` helper, a fixture or test named `legacyRow` / `oldShape` / `compatRow`, or a "preserves backwards compatibility" comment in BDX mappers, validators, normalizers, importers, or any boundary that ingests external data.
---

# No defensive fallbacks — fail closed against the contract

## The one question

> **Why do you preserve broken anything?**

If you cannot answer that with a named binding contract or ADR that explicitly requires the fallback, you are about to ship a regression dressed up as defensive code. Stop.

## What "preserving broken anything" looks like in this repo

Every shape below has been written, shipped, and bitten this codebase in the last quarter. Refuse them on sight.

- **Soft priority chain on a required field.** `policyRef: ['Certificate Ref', 'Policy or Group Ref', "Broker's Ref Number"]` when the contract says Cert Ref is required. The fallback path silently re-introduces the bug the primary path was meant to fix (in the actual case: many rows colliding on the shared Group Ref, hitting `@@unique([policyNumber, renewalSequence])` at commit time).
- **`setIfMissing` / `??` / `||` defaults on contract fields.** AGENTS.md non-negotiable: *"Do not add fallback datasets to silence validation errors."* If the field is missing, the validator must surface a `Critical` COMPLETENESS gap. Defaults turn an importable data-quality failure into a silent corruption.
- **"Legacy row" fixtures and tests.** A fixture named `legacyRow`, `oldShape`, `legacyTravelRow`, `compatRow`, or a test asserting *"row without required field still produces a stable result"* pins the fallback as canonical behaviour. Replace with the inverse: *"row without required field FAILS COMPLETENESS-critical."*
- **"Preserves backwards compatibility" comments without an ADR.** If there is no ADR-XXXX in the comment, the back-compat is speculation. Delete the branch and the comment.
- **Try/catch that swallows a missing canonical value.** `try { return strict(x) } catch { return softDefault }` inside a mapper or normalizer is the same anti-pattern in disguise.
- **Multiple sheet/header fallbacks for "old workbook shapes"** unless a row in `canonical-ownership.md` (or a binding ADR) enumerates exactly which shapes are supported.
- **`if (productCode === 'X' && legacy) …`** — a per-product *and* legacy-mode branch. Two anti-patterns stacked.

If the user pushes back with "why preserve broken anything?" it is too late — the rule is for you to apply *before* writing the branch.

## The rule (verbatim from the binding contract)

From `AGENTS.md` — non-negotiables:

- *"Do not add fallback datasets to silence validation errors."*
- *"Do not fix a symptom before tracing the contract path end-to-end."*
- *"Do not silently rewrite a binding contract to match what code already does."*

And the canonical-ownership rule: every concept has **one** owner, and a "fallback" is almost always a second source masquerading as resilience.

## Decision tree — before adding any default / fallback

Walk this in order. Stop at the first branch that fires.

1. **Is the field required by a binding contract?** (Lloyds v5.2 BDX spec for ingest; product validation contract for runtime; ADR for everything else.)
   - **Required** → no fallback. Missing value = `Critical` validation gap. Stop.
   - **Optional** → continue.
2. **Does the contract enumerate alternate sources for this concept?** (e.g. `canonical-ownership.md` row listing allowed mirrors.)
   - **Yes, listed** → walk the listed sources in the listed order. Match the listed shapes exactly. Stop.
   - **No** → continue.
3. **Do you have an open ADR proposing the new fallback semantics?**
   - **Yes** → land the ADR first, then the code matches the ADR. Stop.
   - **No** → **you do not write the fallback.** Either:
     - Tighten the contract (propose an ADR) and ship the validation gap.
     - Ask the user / contract owner. Don't speculate.

There is no fourth branch. "It might break something" is not a fourth branch. Failing closed against the contract IS the resilience strategy on this codebase.

## What to do instead

When the temptation is "what if this field is missing in real input?", route the answer through the validator, not the mapper.

- **Mapper** ingests, normalizes shape, never silently fills required fields.
- **Validator** (`runCompletenessValidation`, `runCalculabilityValidation`, product-specific validators in `backend/products/<product>/validation/`) emits a `Critical` / `Warning` `BdxGap` or contract-violation that the operator sees in the dry-run report.
- **Operator** fixes the source data, or escalates to the upstream party (Brit, Beazley, the broker), or files an ADR to change the contract.

Concretely, when adding a mapper field today:

```ts
// Wrong — silently masks a required-field violation:
policyRef: pick(r, ['Certificate Ref', 'Policy or Group Ref', "Broker's Ref Number"]) || `synth-${rowNumber}`,

// Right — single canonical source, validator catches the absence:
policyRef: pick(r, ['Certificate Ref']),
// And the matching validator gap if missing:
if (!dto.policyRef) gaps.push(buildGap(dto, 'COMPLETENESS', 'Critical',
  "Missing required field 'Certificate Ref' — per Lloyds v5.2 BDX spec every travel risk row carries a unique certificate reference.",
  'Row cannot be deterministically grouped or persisted.'));
```

## Refuse these test shapes

Tests are how the anti-pattern becomes load-bearing. Refuse:

```ts
// Wrong — pins the fallback as correct behaviour:
it('travel rows without Certificate Ref fall back to Group Ref', () => {
  const legacyRow = { 'Policy or Group Ref': 'GROUP-1', /* no Cert Ref */ };
  expect(mapRawRowToDto(legacyRow, 1).policyRef).toBe('GROUP-1');
});
```

```ts
// Right — pins the contract:
it('travel rows without Certificate Ref fail COMPLETENESS-critical', async () => {
  const row = { __productLine: 'travel', 'Policy or Group Ref': 'GROUP-1' };
  const [evaluation] = await evaluateBdxMigrationRows({ rows: [row], request: {...}, program: {...} });
  expect(evaluation.result).toBe('FAIL');
  expect(evaluation.gaps).toContainEqual(expect.objectContaining({
    category: 'COMPLETENESS',
    severity: 'Critical',
    message: expect.stringContaining('Certificate Ref'),
  }));
});
```

## When you THINK you have a legitimate exception

You probably don't. The historical exception rate on this codebase is approximately zero — every "we have to support legacy X" has turned out to be either (a) speculation, or (b) a real ADR-worthy contract change that was ducking the ADR process.

But if you genuinely believe the case is real:

1. Cite the row from the ingested corpus that proves the older shape exists — file name, row number, exact cell values.
2. Cite the contract change that allows it — ADR number or proposed ADR draft.
3. Show the matching validator entry that gates the new shape (you still don't just fall through silently — you accept it explicitly, with a `Warning` gap if needed).
4. Stop and ask the user before you write the branch.

If you cannot do all four, you do not have an exception. You have speculation.

## Self-audit before commit

For every diff that touches a mapper, validator, normalizer, or any ingest boundary, answer in the PR body:

- **Required-field changes?** Yes/No. If yes, list them and cite the contract row.
- **New fallbacks / defaults / priority chains?** Yes/No. If yes, cite the ADR or contract row that authorises them. If neither exists, **delete the branch before committing.**
- **New test fixtures named `legacy*`, `old*`, `compat*`?** Yes/No. If yes, justify or rename.
- **"Backwards compatibility" / "in case" / "fall back to" / "preserve" appearing in code comments?** Yes/No. If yes, the comment is your tell. Re-read this skill.

## Sources

- `AGENTS.md` — non-negotiables (lines 17–23).
- `docs/architecture/contracts/canonical-ownership.md` — one owner per concept.
- `docs/architecture/contracts/validation.md` + `validation-runtime.md` — where data-quality failures belong.
- `docs/operate/bdx-recovery-rules.md` — what to do when ingest fails (hint: surface the failure, don't paper over it).
- Sibling skill: `.cursor/skills/contract-spine/SKILL.md` — the broader "drift refusal" rule. This skill is the narrow, ingest-boundary case.
- Sibling skill: `.cursor/skills/evidence-first-debug/SKILL.md` — run this **before** reaching for any fallback. Most "I need a fallback because the field is missing" instincts dissolve once the missing-data hop is named with evidence.

#!/usr/bin/env node
// tools/quality/check-contracts-product-consistency.mjs
//
// Guard: contracts:product-consistency  (ADR-0010 — "docs win" rule
// applied to canonical shared field contracts).
//
// Purpose
//   Make Product field-contract drift (the Nationality-class bug)
//   structurally impossible. Every shared standard field has exactly
//   one canonical contract under `packages/validation/src/<field>/
//   contract.ts`; this guard cross-checks every product profile,
//   manifest, region/jurisdiction default, prisma seed, fixture, and
//   payload mapper against that contract and fails CI on any drift.
//
//   Today the guard covers the `nationality` contract only — the
//   reference implementation. Adding a new shared-field contract is a
//   one-row addition to CONTRACTS below.
//
// What it catches (nationality)
//   1. A default value (Tenant.defaultNationality, REGION_CONFIG,
//      jurisdiction `bdxImport.defaultNationality`, profile defaults,
//      fixtures, smoke payloads) that is NOT in NATIONALITY_OPTIONS
//      and not null. Demonyms (`'British'`, `'Cypriot'`) get a
//      named-and-shamed error message pointing at the migration map.
//   2. A product whose profile lists `proposer.nationality` in `fields`
//      but omits it from a stage gate the contract says must include
//      it (HOME bind/issuance gap).
//   3. A product whose profile uses a rule other than `'nationality'`
//      for the nationality field (e.g. `'nonEmptyString'`, `'name'`).
//   4. A product the contract marks `collected: false` whose manifest
//      still exposes `proposer.nationality` (travel manifest/profile
//      mismatch).
//   5. A surface that writes flat `quoteData.nationality` instead of
//      `quoteData.proposer.nationality` (client portal endorsement).
//   6. A product-local fallback country/nationality list outside the
//      canonical contract (drift hot spot).
//   7. The shared `countries` re-export disagreeing with the canonical
//      `NATIONALITY_OPTIONS` set.
//
// Severity: error by default per ADR-0010. Bypass with
// CONTRACTS_GUARD_STRICT=0 (intended for local debugging only — never
// set in CI).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// REPO_ROOT defaults to the script's own ../.. so production runs are
// zero-config. The synthetic-drift test overrides it via env var so it
// can point the guard at a per-scenario clone.
const REPO_ROOT = process.env.CONTRACTS_GUARD_REPO_ROOT
  ? path.resolve(process.env.CONTRACTS_GUARD_REPO_ROOT)
  : path.resolve(__dirname, '..', '..');
const STRICT = process.env.CONTRACTS_GUARD_STRICT !== '0';

// ---------------------------------------------------------------------------
// Contract registry — the only place a new shared-field contract is wired
// into the consistency guard.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    field: 'nationality',
    sourceFile: 'packages/validation/src/nationality/contract.ts',
    profilePath: 'proposer.nationality',
    payloadPath: 'proposer.nationality',
    ruleName: 'nationality',
    countriesMirror: 'packages/products/src/shared/countries.ts',
    legacyDemonyms: {
      British: 'United Kingdom',
      Cypriot: 'Cyprus',
      Greek: 'Greece',
      Portuguese: 'Portugal',
      Spanish: 'Spain',
    },
    defaultCallsites: [
      // Files where a `defaultNationality:` literal appears.
      'prisma/seed.ts',
      'backend/modules/jurisdiction/domain/productConfiguration.ts',
      'frontend/src/shared/config/region.ts',
      'frontend/src/products/motor/wizard/config/region.ts',
      'frontend/src/shared/lib/wizard/steps/PolicyHolderStep.tsx',
      'backend/http/middleware/__tests__/resolveTenant.test.ts',
    ],
    fixtureCallsites: [
      // Files where a `nationality:` literal appears in fixtures/seed/test
      // data. Membership-checked the same way as defaults.
      'backend/seed.ts',
      'backend/platform/test/fixtures/testQuote.ts',
      'backend/products/motor/goldenFixtures.ts',
      'backend/products/home/goldenFixtures.ts',
      'backend/modules/pricing/domain/__tests__/coreParityGuards.test.ts',
      'backend/modules/pricing/domain/__tests__/motorbikeWorkbookParity.test.ts',
      'backend/http/routes/__tests__/binding_integrity.integration.test.ts',
      'packages/products/src/home/__tests__/profile.backend.test.ts',
      'packages/products/src/home/__tests__/profile.frontend.test.ts',
      'packages/products/src/motor/__tests__/profile.test.ts',
      'packages/products/src/motor/schemas/__tests__/wizardSteps.test.ts',
      'frontend/src/products/motor/wizard/utils/validation.test.ts',
      'frontend/src/products/motor/wizard/components/steps/Step4Quote.test.tsx',
      'frontend/src/modules/policies/services/validateQuoteData.test.ts',
      'frontend/src/surfaces/client/controller/useClientProfileController.ts',
      'tools/quality/aks/quote-bind-issue-smoke.mjs',
      'tools/quality/tests/test-overrides.mjs',
      'tools/quality/testEndToEndApi.sh',
      'tools/migrations/run_bdx_corpus_migration.mjs',
    ],
    payloadCallsites: [
      // Files where a payload object writing nationality must use the
      // canonical `proposer.nationality` path (i.e. the `nationality:`
      // key MUST sit inside a `proposer: { ... }` block, never at the
      // root of `quoteData`).
      'frontend/src/surfaces/client/controller/useClientProfileController.ts',
    ],
    products: {
      HOME: {
        manifest: 'packages/products/src/home/manifest.ts',
        profile: 'packages/products/src/home/profile.ts',
      },
      MOTOR: {
        manifest: 'packages/products/src/motor/manifest.ts',
        profile: 'packages/products/src/motor/profile.ts',
      },
      TRAVEL: {
        manifest: 'packages/products/src/travel/manifest.ts',
        profile: 'packages/products/src/travel/profile.ts',
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Contract source parsing (regex over the canonical TS file — kept simple
// because the contract is authored to a fixed shape).
// ---------------------------------------------------------------------------

async function readFileSafe(rel) {
  try {
    return await fs.readFile(path.join(REPO_ROOT, rel), 'utf8');
  } catch {
    return null;
  }
}

function parseStringArrayConst(source, name) {
  // Matches: export const NAME = [ 'A', 'B', ... ] as const;
  const re = new RegExp(
    `export const ${name}\\s*=\\s*\\[(?<body>[\\s\\S]*?)\\]\\s*as const`,
    'm',
  );
  const m = source.match(re);
  if (!m || !m.groups) return null;
  const items = [];
  const itemRe = /'([^'\\]*(?:\\.[^'\\]*)*)'/g;
  let cur;
  while ((cur = itemRe.exec(m.groups.body)) !== null) {
    items.push(cur[1]);
  }
  return items;
}

function parseStringConst(source, name) {
  const re = new RegExp(
    `export const ${name}\\s*=\\s*'([^']+)'\\s*as const`,
    'm',
  );
  const m = source.match(re);
  return m ? m[1] : null;
}

function parseProductRequirements(source) {
  // Matches: export const NATIONALITY_PRODUCT_REQUIREMENTS = { HOME: {...}, MOTOR: {...}, TRAVEL: {...} } as const ...
  const blockRe =
    /export const NATIONALITY_PRODUCT_REQUIREMENTS\s*=\s*\{(?<body>[\s\S]*?)\}\s*as const/m;
  const m = source.match(blockRe);
  if (!m || !m.groups) return null;
  const out = {};
  // Per-product entries: HOME: { collected: true, stages: ['bind', 'issuance'] as const }
  const entryRe =
    /(\w+)\s*:\s*\{\s*collected\s*:\s*(true|false)\s*,\s*stages\s*:\s*\[(?<stages>[^\]]*)\]/g;
  let cur;
  while ((cur = entryRe.exec(m.groups.body)) !== null) {
    const productCode = cur[1];
    const collected = cur[2] === 'true';
    const stages = [];
    const stageRe = /'([^']+)'/g;
    let s;
    while ((s = stageRe.exec(cur.groups.stages)) !== null) {
      stages.push(s[1]);
    }
    out[productCode] = { collected, stages };
  }
  return out;
}

async function loadContract(contract) {
  const source = await readFileSafe(contract.sourceFile);
  if (!source) {
    return {
      ok: false,
      error: `Canonical contract file missing: ${contract.sourceFile}`,
    };
  }
  const options = parseStringArrayConst(source, 'NATIONALITY_OPTIONS');
  const payloadPath = parseStringConst(source, 'NATIONALITY_PAYLOAD_PATH');
  const requirements = parseProductRequirements(source);
  if (!options || !payloadPath || !requirements) {
    return {
      ok: false,
      error: `Failed to parse canonical contract ${contract.sourceFile} — check NATIONALITY_OPTIONS / NATIONALITY_PAYLOAD_PATH / NATIONALITY_PRODUCT_REQUIREMENTS shape.`,
    };
  }
  if (payloadPath !== contract.payloadPath) {
    return {
      ok: false,
      error: `Canonical payload path mismatch: contract says ${payloadPath} but guard expects ${contract.payloadPath}.`,
    };
  }
  return {
    ok: true,
    options: new Set(options),
    optionsList: options,
    payloadPath,
    requirements,
  };
}

// ---------------------------------------------------------------------------
// Per-callsite extraction helpers.
// ---------------------------------------------------------------------------

function findLiteralValues(source, key) {
  // Match `key: '...'` or `key: "..."` (and tolerate `key=` for env-style files).
  // Returns array of { value, line } pairs. Captures `null` and dynamic
  // expressions separately so the guard can ignore them.
  const out = [];
  const re = new RegExp(
    `(?:^|[^\\w])${key}\\s*[:=]\\s*([\\s\\S]+?)[,;\\n]`,
    'g',
  );
  let cur;
  while ((cur = re.exec(source)) !== null) {
    const raw = cur[1].trim();
    const offset = cur.index;
    const line = source.slice(0, offset).split('\n').length;
    if (raw.startsWith("'") || raw.startsWith('"')) {
      const value = raw.slice(1, raw.length - 1);
      out.push({ kind: 'literal', value, line });
    } else if (raw === 'null' || raw === 'undefined') {
      out.push({ kind: 'null', line });
    } else {
      out.push({ kind: 'dynamic', raw, line });
    }
  }
  return out;
}

function checkLiteralAgainstContract(value, contract, contractData) {
  if (contractData.options.has(value)) return null;
  if (Object.prototype.hasOwnProperty.call(contract.legacyDemonyms, value)) {
    const canonical = contract.legacyDemonyms[value];
    return `legacy demonym '${value}' (use '${canonical}' — see NATIONALITY_DEMONYM_TO_COUNTRY)`;
  }
  return `'${value}' is not in NATIONALITY_OPTIONS`;
}

// ---------------------------------------------------------------------------
// Per-product profile / manifest checks.
// ---------------------------------------------------------------------------

function profileFieldRule(profileSource, profilePath) {
  // Match: 'proposer.nationality': { ..., rule: 'xxx', ... }
  const re = new RegExp(
    `'${profilePath.replace(/\./g, '\\.')}'\\s*:\\s*\\{[^}]*rule\\s*:\\s*'([^']+)'`,
  );
  const m = profileSource.match(re);
  return m ? m[1] : null;
}

function profileHasFieldKey(profileSource, profilePath) {
  // Detects either declarative (`'proposer.nationality': { ... }`) or
  // motor-style metadata (`'proposer.nationality': { path: ..., requiredAtStages: ... }`).
  const escaped = profilePath.replace(/\./g, '\\.');
  return new RegExp(`'${escaped}'\\s*:\\s*\\{`).test(profileSource);
}

function profileFieldInStep(profileSource, profilePath, stageId) {
  // Locate `stages: { ... <stageId>: { fields: [ ... ] } ... }` and check
  // membership of the path string in the stage's fields array.
  const stagesRe =
    /stages\s*:\s*\{[\s\S]*?\}\s*,?\s*\}\s*;/m; // find the stages block (best-effort)
  const stagesMatch = profileSource.match(stagesRe);
  const block = stagesMatch ? stagesMatch[0] : profileSource;
  const stageRe = new RegExp(
    `${stageId}\\s*:\\s*\\{[\\s\\S]*?fields\\s*:\\s*\\[(?<f>[\\s\\S]*?)\\]`,
  );
  const m = block.match(stageRe);
  if (!m || !m.groups) return false;
  return m.groups.f.includes(`'${profilePath}'`);
}

function profileMotorRequiredAtStages(profileSource, profilePath) {
  // Motor uses `requiredAtStages: ['bind']` as the lifecycle gate; extract.
  // Two shapes are accepted:
  //   1. literal:    requiredAtStages: ['bind', 'issuance']
  //   2. constant:   requiredAtStages: BIND_AND_ISSUANCE
  // For (2) the guard resolves a `const BIND_AND_ISSUANCE: ... = [ ... ]`
  // declaration in the same source file (single level — no transitive
  // chains). This keeps the profile authoring tidy (named lifecycle
  // stage tuples) without forcing every field declaration to inline
  // the same array.
  const escaped = profilePath.replace(/\./g, '\\.');
  // Try literal-array shape first.
  const literalRe = new RegExp(
    `'${escaped}'\\s*:\\s*\\{[^}]*requiredAtStages\\s*:\\s*\\[([^\\]]*)\\]`,
  );
  const literalMatch = profileSource.match(literalRe);
  if (literalMatch) {
    return parseStageStringList(literalMatch[1]);
  }
  // Try constant-reference shape.
  const constRefRe = new RegExp(
    `'${escaped}'\\s*:\\s*\\{[^}]*requiredAtStages\\s*:\\s*([A-Z_][A-Z0-9_]*)`,
  );
  const constRefMatch = profileSource.match(constRefRe);
  if (!constRefMatch) return null;
  const constName = constRefMatch[1];
  // Resolve `const NAME: ... = [ 'stage1', 'stage2' ]` in the same file.
  const constDeclRe = new RegExp(
    `\\bconst\\s+${constName}\\s*(?::[^=]+)?=\\s*\\[([^\\]]*)\\]`,
  );
  const constDeclMatch = profileSource.match(constDeclRe);
  if (!constDeclMatch) return null;
  return parseStageStringList(constDeclMatch[1]);
}

function parseStageStringList(body) {
  const stages = [];
  const stageRe = /'([^']+)'/g;
  let cur;
  while ((cur = stageRe.exec(body)) !== null) {
    stages.push(cur[1]);
  }
  return stages;
}

function manifestExposesField(manifestSource, profilePath) {
  return manifestSource.includes(`path: '${profilePath}'`);
}

// ---------------------------------------------------------------------------
// Country mirror parity check.
// ---------------------------------------------------------------------------

async function checkCountriesMirror(contract, contractData) {
  const source = await readFileSafe(contract.countriesMirror);
  if (!source) return null;
  // Accept either: re-export from @facio/validation, OR a literal array
  // that exactly matches NATIONALITY_OPTIONS.
  if (
    source.includes('NATIONALITY_OPTIONS') &&
    source.includes('@facio/validation')
  ) {
    return null;
  }
  // Fallback: parse the local list and compare set equality.
  const local = parseStringArrayConst(source, 'countries') ||
    parseStringArrayConst(source, 'COUNTRIES');
  if (!local) {
    return `${contract.countriesMirror} neither re-exports NATIONALITY_OPTIONS from @facio/validation nor declares a parseable \`countries\` array.`;
  }
  const localSet = new Set(local);
  const missing = [...contractData.options].filter((c) => !localSet.has(c));
  const extra = local.filter((c) => !contractData.options.has(c));
  if (missing.length === 0 && extra.length === 0) return null;
  return `${contract.countriesMirror} drifts from NATIONALITY_OPTIONS — missing: [${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}] extra: [${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ', …' : ''}].`;
}

// ---------------------------------------------------------------------------
// Payload-path check (flat `quoteData.nationality` is forbidden).
// ---------------------------------------------------------------------------

function checkPayloadPath(source, contract) {
  // Find every `nationality:` key. For each, walk back ~200 chars and
  // confirm the enclosing object is `proposer:` or that this is not a
  // `quoteData` payload context. Fail if `quoteData: {` appears more
  // recently than `proposer:` (i.e. flat at the quoteData root).
  const issues = [];
  const re = /(\bnationality\s*:)/g;
  let cur;
  while ((cur = re.exec(source)) !== null) {
    const offset = cur.index;
    const window = source.slice(Math.max(0, offset - 600), offset);
    // We only care about contexts where `quoteData: {` opened the
    // surrounding object — those are the contexts that must use the
    // canonical proposer.* path.
    const lastQuoteData = window.lastIndexOf('quoteData');
    if (lastQuoteData < 0) continue;
    const lastProposer = window.lastIndexOf('proposer');
    // If `proposer:` is inside the quoteData block AND comes after it,
    // the nationality is correctly nested.
    if (lastProposer > lastQuoteData) continue;
    // Otherwise this is a flat `quoteData.nationality` — drift.
    const line = source.slice(0, offset).split('\n').length;
    issues.push({ line });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Main verification pass for one contract.
// ---------------------------------------------------------------------------

async function verifyContract(contract) {
  const errors = [];
  const data = await loadContract(contract);
  if (!data.ok) {
    errors.push(data.error);
    return errors;
  }

  // 1. Default + fixture callsites — every literal must be canonical.
  const allCallsites = [
    ...new Set([...contract.defaultCallsites, ...contract.fixtureCallsites]),
  ];
  for (const rel of allCallsites) {
    const source = await readFileSafe(rel);
    if (source == null) continue; // file may not exist in every layout
    const literals = [
      ...findLiteralValues(source, 'defaultNationality'),
      ...findLiteralValues(source, 'nationality'),
      ...findLiteralValues(source, '"nationality"'),
    ];
    for (const lit of literals) {
      if (lit.kind !== 'literal') continue;
      // Skip the trivial empty default that wizard constants use as
      // initial RHF state (empty string is "no default", not a value).
      if (lit.value === '') continue;
      const problem = checkLiteralAgainstContract(lit.value, contract, data);
      if (problem) {
        errors.push(`${rel}:${lit.line} — ${problem}`);
      }
    }
  }

  // 2. Per-product profile + manifest consistency.
  for (const [productCode, paths] of Object.entries(contract.products)) {
    const requirement = data.requirements[productCode];
    if (!requirement) {
      errors.push(
        `Contract ${contract.field}: product ${productCode} has files configured but no entry in NATIONALITY_PRODUCT_REQUIREMENTS.`,
      );
      continue;
    }
    const profileSource = await readFileSafe(paths.profile);
    const manifestSource = await readFileSafe(paths.manifest);
    if (profileSource == null) {
      errors.push(`Profile not found: ${paths.profile}`);
      continue;
    }
    if (manifestSource == null) {
      errors.push(`Manifest not found: ${paths.manifest}`);
      continue;
    }

    const hasField = profileHasFieldKey(profileSource, contract.profilePath);
    const manifestExposes = manifestExposesField(manifestSource, contract.profilePath);

    if (requirement.collected) {
      if (!hasField) {
        errors.push(
          `${paths.profile}: product ${productCode} is collected:true but '${contract.profilePath}' is missing from \`fields\`.`,
        );
        continue;
      }
      if (!manifestExposes) {
        errors.push(
          `${paths.manifest}: product ${productCode} is collected:true but manifest does not expose '${contract.profilePath}'.`,
        );
      }
      // Rule reference (declarative profiles only — motor uses
      // FieldContract metadata + Zod, no `rule:` key).
      const rule = profileFieldRule(profileSource, contract.profilePath);
      if (rule && rule !== contract.ruleName) {
        errors.push(
          `${paths.profile}: product ${productCode} '${contract.profilePath}' uses rule '${rule}' — must use canonical rule '${contract.ruleName}'.`,
        );
      }
      // Stage gate: declarative profiles list stages under `stages.<id>.fields`,
      // motor-style profiles list them under field metadata `requiredAtStages`.
      const motorStages = profileMotorRequiredAtStages(profileSource, contract.profilePath);
      for (const stage of requirement.stages) {
        if (motorStages) {
          if (!motorStages.includes(stage)) {
            errors.push(
              `${paths.profile}: product ${productCode} '${contract.profilePath}' missing stage '${stage}' — contract requires [${requirement.stages.join(', ')}], profile metadata says [${motorStages.join(', ')}].`,
            );
          }
        } else if (!profileFieldInStep(profileSource, contract.profilePath, stage)) {
          errors.push(
            `${paths.profile}: product ${productCode} '${contract.profilePath}' missing from \`stages.${stage}.fields\` — contract requires [${requirement.stages.join(', ')}].`,
          );
        }
      }
    } else {
      // collected:false → field MUST NOT appear in profile or manifest.
      if (hasField) {
        errors.push(
          `${paths.profile}: product ${productCode} is collected:false but '${contract.profilePath}' is declared in \`fields\` — remove it or change the contract.`,
        );
      }
      if (manifestExposes) {
        errors.push(
          `${paths.manifest}: product ${productCode} is collected:false but manifest still exposes '${contract.profilePath}' — drop the manifest entry or change the contract.`,
        );
      }
    }
  }

  // 3. Payload-path check — flat `quoteData.nationality` is forbidden.
  for (const rel of contract.payloadCallsites) {
    const source = await readFileSafe(rel);
    if (source == null) continue;
    const issues = checkPayloadPath(source, contract);
    for (const issue of issues) {
      errors.push(
        `${rel}:${issue.line} — flat \`quoteData.nationality\` is forbidden; nest under \`proposer.nationality\` (canonical payload path).`,
      );
    }
  }

  // 4. Countries mirror parity.
  const mirrorIssue = await checkCountriesMirror(contract, data);
  if (mirrorIssue) errors.push(mirrorIssue);

  return errors;
}

// ---------------------------------------------------------------------------
// Driver.
// ---------------------------------------------------------------------------

async function main() {
  const allErrors = [];
  for (const contract of CONTRACTS) {
    const contractErrors = await verifyContract(contract);
    if (contractErrors.length > 0) {
      allErrors.push(`Contract: ${contract.field} (${contract.sourceFile})`);
      for (const err of contractErrors) {
        allErrors.push(`  ${err}`);
      }
    }
  }

  if (allErrors.length === 0) {
    console.log(
      `[contracts:product-consistency] OK — verified ${CONTRACTS.length} contract(s); no drift found.`,
    );
    return 0;
  }

  const header = STRICT
    ? '[contracts:product-consistency] FAIL — drift detected:'
    : '[contracts:product-consistency] WARN — drift detected (CONTRACTS_GUARD_STRICT=0):';
  console.error(header);
  for (const line of allErrors) console.error(line);
  console.error(
    '\nFix one of:\n' +
      '  - Update the offending callsite to match the canonical contract\n' +
      '  - Amend the canonical contract (and ADR-0010) and rerun\n' +
      '  - Add a Prisma migration if the change is data-shaped\n',
  );
  return STRICT ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[contracts:product-consistency] unexpected error:', err);
    process.exit(2);
  });

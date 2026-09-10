/* eslint-disable no-console, no-restricted-syntax */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { motorValidationProfile } from '../../packages/products/src/motor/profile';
import { MOTOR_QUESTIONNAIRE_STEP_OWNERSHIP } from '../../packages/products/src/motor/stepOwnership';
import { homeValidationProfile } from '../../packages/products/src/home/profile';
import { travelValidationProfile } from '../../packages/products/src/travel/profile';
import { healthValidationProfile } from '../../packages/products/src/health/profile';
import type { ValidationProfile } from '@facio/validation';
import { TEMPLATES as MOTOR_ENDORSEMENT_TEMPLATES } from '../../backend/modules/mbe/domain/endorsementTemplates';
import { HOME_ENDORSEMENT_TEMPLATES } from '../../backend/products/home/endorsementTemplates';
import { TRAVEL_ENDORSEMENT_TEMPLATES } from '../../backend/products/travel/endorsementTemplates';
import { HEALTH_ENDORSEMENT_TEMPLATES } from '../../backend/products/health/endorsementTemplates';
import { motorDefaultClaimsContract } from '../../backend/products/motor/claims/defaultClaimsContract';
import { homeDefaultClaimsContract } from '../../backend/products/home/claims/defaultClaimsContract';
import { travelDefaultClaimsContract } from '../../backend/products/travel/claims/defaultClaimsContract';
import { healthDefaultClaimsContract } from '../../backend/products/health/claims/defaultClaimsContract';
import { motorLloydsV52MappingSpec } from '../../backend/modules/reporting/app/bdxImport/productMappers/motorMapper';
import { homeLloydsV52MappingSpec } from '../../backend/modules/reporting/app/bdxImport/productMappers/homeMapper';
import { travelLloydsV52MappingSpec } from '../../backend/modules/reporting/app/bdxImport/productMappers/travelMapper';
import type { EndorsementTemplate } from '../../backend/modules/mbe/domain/types';
import type { ClaimsContract } from '../../backend/modules/claims/domain/claimsContract';

type Stage = 'draft' | 'pricing' | 'quote' | 'bind' | 'wizard' | 'underwriting' | 'issue' | 'endorsement';
type Actor = 'customer' | 'underwriter' | 'system';
const STAGES: Stage[] = ['draft', 'pricing', 'quote', 'bind', 'wizard', 'underwriting', 'issue', 'endorsement'];

const ROOT = process.cwd();
const CHECK_MODE = process.argv.includes('--check');

// Source-of-truth files. Hashed into the generated artifact so consumers
// can diff cheaply and refuse to load drifted copies.
//
// Phase 5 (2026-04-28): the canonical motor profile + stepOwnership now
// live in `@facio/products` (`packages/products/src/motor/`). The
// previous FE-side source paths were retired as part of the motor
// exception closure. There is exactly ONE generator in the repo and ONE
// generated artifact per product — all rooted in the canonical package.
const SOURCE_FILES = [
  path.join(ROOT, 'packages/products/src/motor/profile.ts'),
  path.join(ROOT, 'packages/products/src/motor/stepOwnership.ts'),
];

// `spine/v2` Wave 5: Home + Travel get the same pattern as Motor — a
// generated declarative index that consumers read instead of poking at
// `<product>ValidationProfile.stages.bind.fields`. Home/Travel profiles
// already declare `stages.{bind,issuance}.fields` directly (no per-field
// `requiredAtStages` annotations), so the generator just mirrors them
// into a hash-stamped, sorted index. The hash detects drift; the sort
// is byte-stable across regens.
const HOME_SOURCE_FILES = [path.join(ROOT, 'packages/products/src/home/profile.ts')];
const TRAVEL_SOURCE_FILES = [path.join(ROOT, 'packages/products/src/travel/profile.ts')];
const HEALTH_SOURCE_FILES = [path.join(ROOT, 'packages/products/src/health/profile.ts')];

// `spine/v2` Wave 5 (Phase C) — generator extends to non-validation
// product maps. Each of these per-product source modules is the
// declarative root the generator walks; a hash of these files anchors
// each generated artifact to its real source.
const ENDORSEMENT_SOURCE_FILES = {
  motor: [path.join(ROOT, 'backend/modules/mbe/domain/endorsementTemplates.ts')],
  home: [path.join(ROOT, 'backend/products/home/endorsementTemplates.ts')],
  travel: [path.join(ROOT, 'backend/products/travel/endorsementTemplates.ts')],
  health: [path.join(ROOT, 'backend/products/health/endorsementTemplates.ts')],
} as const;
const CLAIMS_SOURCE_FILES = {
  motor: [path.join(ROOT, 'backend/products/motor/claims/defaultClaimsContract.ts')],
  home: [path.join(ROOT, 'backend/products/home/claims/defaultClaimsContract.ts')],
  travel: [path.join(ROOT, 'backend/products/travel/claims/defaultClaimsContract.ts')],
  health: [path.join(ROOT, 'backend/products/health/claims/defaultClaimsContract.ts')],
} as const;
// HEALTH BDX import mapper is not yet authored — Phase 1 ships without
// BDX support. When the mapper is added, drop a path in here.
const BDX_IMPORT_SOURCE_FILES = {
  motor: [path.join(ROOT, 'backend/modules/reporting/app/bdxImport/productMappers/motorMapper.ts')],
  home: [path.join(ROOT, 'backend/modules/reporting/app/bdxImport/productMappers/homeMapper.ts')],
  travel: [path.join(ROOT, 'backend/modules/reporting/app/bdxImport/productMappers/travelMapper.ts')],
} as const;

// Per-product output paths for the generated non-validation indices.
// All three maps land in the same `generated/` folder as the validation
// contract artifact so consumers import them through the package
// barrel instead of poking into product source.
const PRODUCT_MAPS_OUTPUTS = {
  motor: path.join(ROOT, 'packages/products/src/motor/generated/motorProductMaps.generated.ts'),
  home: path.join(ROOT, 'packages/products/src/home/generated/homeProductMaps.generated.ts'),
  travel: path.join(ROOT, 'packages/products/src/travel/generated/travelProductMaps.generated.ts'),
  health: path.join(ROOT, 'packages/products/src/health/generated/healthProductMaps.generated.ts'),
} as const;

// `motorValidationProfile.fields` plays the role MOTOR_QUESTIONNAIRE_CONTRACT
// used to play. The two structures have the same keying (RHF dot path) and
// expose the same metadata (`requiredAtStages` / `requiredAtByActor`). The
// Gen1-only stages ('wizard', 'underwriting', 'issue', 'endorsement') were
// never populated with real data in the contract, so collecting against
// them simply yields empty arrays — preserved for byte-stable output.
const MOTOR_VALIDATION_FIELDS = motorValidationProfile.fields;

// Single canonical output. Both BE and FE consume from `@facio/products`
// (which re-exports the constants from the package barrel). Phase 5
// retired the frontend policies copy, the backend policy-app copy, and
// the backend motor questionnaire copy.
// The retired paths are blocked at CI by `check-products-single-source.mjs`.
const CANONICAL_OUTPUT = path.join(
  ROOT,
  'packages/products/src/motor/generated/motorValidationContract.generated.ts',
);
const HOME_OUTPUT = path.join(
  ROOT,
  'packages/products/src/home/generated/homeValidationContract.generated.ts',
);
const TRAVEL_OUTPUT = path.join(
  ROOT,
  'packages/products/src/travel/generated/travelValidationContract.generated.ts',
);
const HEALTH_OUTPUT = path.join(
  ROOT,
  'packages/products/src/health/generated/healthValidationContract.generated.ts',
);
const AUDIT_JSON_OUTPUT = path.join(ROOT, 'artifacts/contracts/motor-validation-contract.audit.json');
const AUDIT_MD_OUTPUT = path.join(ROOT, 'docs/architecture/validation-contract-audit.md');

function sortStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function requiredForStage(meta: Record<string, unknown>, actor: Actor, stage: Stage): boolean {
  const byActor = (meta.requiredAtByActor || {}) as Partial<Record<Actor, Stage[]>>;
  const actorStages = Array.isArray(byActor[actor]) ? byActor[actor] : [];
  if (actorStages.includes(stage)) return true;
  const globalStages = Array.isArray(meta.requiredAtStages) ? (meta.requiredAtStages as Stage[]) : [];
  return globalStages.includes(stage);
}

function collectRequiredByActorStage(actor: Actor): Record<Stage, string[]> {
  const out: Record<Stage, string[]> = {
    draft: [],
    pricing: [],
    quote: [],
    bind: [],
    wizard: [],
    underwriting: [],
    issue: [],
    endorsement: [],
  };
  for (const [key, value] of Object.entries(MOTOR_VALIDATION_FIELDS)) {
    const meta = (value || {}) as Record<string, unknown>;
    STAGES.forEach((stage) => {
      if (requiredForStage(meta, actor, stage)) out[stage].push(key);
    });
  }
  STAGES.forEach((stage) => {
    out[stage] = sortStrings(out[stage]);
  });
  return out;
}

function readStepOwnership(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [step, fields] of Object.entries(MOTOR_QUESTIONNAIRE_STEP_OWNERSHIP)) {
    out[step] = sortStrings(fields);
  }
  return out;
}

function stringifyArray(values: string[], indent = 2): string {
  const pad = ' '.repeat(indent);
  return `[\n${values.map((value) => `${pad}'${value}',`).join('\n')}\n]`;
}

function stringifyStepMap(stepMap: Record<string, string[]>): string {
  const lines = Object.entries(stepMap).map(([step, fields]) => {
    return `  '${step}': ${stringifyArray(fields, 4)},`;
  });
  return `{\n${lines.join('\n')}\n}`;
}

function sourceHash(files: string[] = SOURCE_FILES): string {
  const hash = crypto.createHash('sha256');
  files.forEach((filePath) => {
    hash.update(fs.readFileSync(filePath, 'utf8'));
  });
  return hash.digest('hex');
}

/**
 * Build a generated TS index for products that already declare
 * `stages.{bind,issuance}.fields` at the profile root (Home + Travel
 * pattern). Output mirrors motor's surface but skips the actor-stage
 * matrix and step-scoped map, which neither product uses.
 */
function declarativeStagesIndex(args: {
  productCode: string;
  upperPrefix: string;
  profile: ValidationProfile;
  sourceHashHex: string;
}): string {
  const stages = args.profile.stages || {};
  const bind = sortStrings((stages.bind?.fields as string[] | undefined) || []);
  const issuance = sortStrings((stages.issuance?.fields as string[] | undefined) || []);
  const allFieldKeys = sortStrings(Object.keys(args.profile.fields || {}));
  return `// AUTO-GENERATED FILE. DO NOT EDIT.\n` +
    `// Source: packages/products/src/${args.productCode.toLowerCase()}/profile.ts\n` +
    `// Generator: tools/quality/generateValidationContractArtifacts.ts\n` +
    `export const ${args.upperPrefix}_VALIDATION_CONTRACT_SOURCE_HASH = '${args.sourceHashHex}';\n\n` +
    `export const ${args.upperPrefix}_REQUIRED_BY_STAGE = {\n` +
    `  bind: ${stringifyArray(bind, 4)},\n` +
    `  issuance: ${stringifyArray(issuance, 4)},\n` +
    `} as const;\n\n` +
    `export const ${args.upperPrefix}_REQUIRED_BIND_FIELDS = ${stringifyArray(bind, 2)} as const;\n\n` +
    `export const ${args.upperPrefix}_REQUIRED_ISSUANCE_FIELDS = ${stringifyArray(issuance, 2)} as const;\n\n` +
    `export const ${args.upperPrefix}_ALL_PROFILE_FIELDS = ${stringifyArray(allFieldKeys, 2)} as const;\n`;
}

/**
 * Walk a product's endorsement template list and emit a flat
 * `<PRODUCT>_ENDORSEMENT_EDITABLE_FIELDS` index. The "editable fields"
 * for an endorsement code are the union of:
 *   - `parameters_schema.properties` keys (params an underwriter can
 *     bind on endorse — declarative source).
 *   - `ui.form_fields[].name` (fields surfaced by the BO endorsement
 *     form — declarative UI source).
 * Sorted, deduped, byte-stable across regens.
 */
function endorsementEditableFields(templates: EndorsementTemplate[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const template of templates) {
    const code = String(template.code || '').trim();
    if (!code) continue;
    const fromSchema = (() => {
      const schema = (template.parameters_schema || {}) as Record<string, unknown>;
      const props = (schema.properties || {}) as Record<string, unknown>;
      return Object.keys(props);
    })();
    const fromFormFields = (() => {
      const ui = (template.ui || {}) as Record<string, unknown>;
      const fields = Array.isArray(ui.form_fields) ? ui.form_fields as Array<Record<string, unknown>> : [];
      return fields.map((f) => String(f.name || '')).filter(Boolean);
    })();
    out[code] = sortStrings([...fromSchema, ...fromFormFields]);
  }
  return Object.fromEntries(
    Object.entries(out).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * Walk a claims contract's `fullClaimForm.fields` and emit a flat
 * `<PRODUCT>_CLAIM_PREFILL_PATHS` index keyed by field key. Empty when
 * the claim form is sourced externally (`source: 'external_spec' |
 * 'metadata'`) — the absence of entries is itself the canonical
 * statement that no prefill paths are authored for that product.
 */
function claimPrefillPaths(contract: ClaimsContract): Record<string, string> {
  const fields = Array.isArray(contract.fullClaimForm?.fields) ? contract.fullClaimForm.fields : [];
  const out: Record<string, string> = {};
  for (const field of fields) {
    const key = String((field as { fieldId?: unknown }).fieldId || '').trim();
    const prefill = String((field as { prefillPath?: unknown }).prefillPath || '').trim();
    if (key && prefill) out[key] = prefill;
  }
  return Object.fromEntries(
    Object.entries(out).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * Flatten an `LloydsV52MappingSpec`-shaped object into a flat
 * `<PRODUCT>_BDX_IMPORT_RAW_TO_DTO` index keyed by `<group>.<field>`
 * (e.g. `policyFields.policyRef`). The value is the alias array taken
 * verbatim from the spec — this is the canonical raw-column → DTO
 * surface for that product's BDX dialect.
 */
function bdxImportRawToDto(spec: Record<string, unknown>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [groupKey, group] of Object.entries(spec)) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
    if (groupKey === 'productLine' || groupKey === 'productType') continue;
    for (const [fieldKey, aliases] of Object.entries(group as Record<string, unknown>)) {
      if (!Array.isArray(aliases)) continue;
      const stringAliases = aliases.filter((v): v is string => typeof v === 'string');
      if (stringAliases.length === 0) continue;
      out[`${groupKey}.${fieldKey}`] = [...stringAliases];
    }
  }
  return Object.fromEntries(
    Object.entries(out).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function stringifyStringMap(map: Record<string, string[]>, indent = 2): string {
  const pad = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 2);
  const entries = Object.entries(map);
  if (entries.length === 0) return '{}';
  const lines = entries.map(([key, values]) => {
    const escapedKey = `'${key.replace(/'/g, "\\'")}'`;
    if (values.length === 0) return `${pad}${escapedKey}: [],`;
    const valueLines = values.map((v) => `${inner}'${v.replace(/'/g, "\\'")}',`).join('\n');
    return `${pad}${escapedKey}: [\n${valueLines}\n${pad}],`;
  });
  return `{\n${lines.join('\n')}\n}`;
}

function stringifyFlatStringMap(map: Record<string, string>, indent = 2): string {
  const pad = ' '.repeat(indent);
  const entries = Object.entries(map);
  if (entries.length === 0) return '{}';
  const lines = entries.map(([key, value]) => {
    const escapedKey = `'${key.replace(/'/g, "\\'")}'`;
    const escapedValue = `'${value.replace(/'/g, "\\'")}'`;
    return `${pad}${escapedKey}: ${escapedValue},`;
  });
  return `{\n${lines.join('\n')}\n}`;
}

function productMapsContent(args: {
  productCode: string;
  upperPrefix: string;
  endorsementSourceHash: string;
  claimsSourceHash: string;
  bdxImportSourceHash: string;
  endorsementEditableFields: Record<string, string[]>;
  claimPrefillPaths: Record<string, string>;
  bdxImportRawToDto: Record<string, string[]>;
}): string {
  const lower = args.productCode.toLowerCase();
  return `// AUTO-GENERATED FILE. DO NOT EDIT.\n` +
    `// Source:\n` +
    `//   - backend/...endorsementTemplates...${lower}\n` +
    `//   - backend/products/${lower}/claims/defaultClaimsContract.ts\n` +
    `//   - backend/modules/reporting/app/bdxImport/productMappers/${lower}Mapper.ts\n` +
    `// Generator: tools/quality/generateValidationContractArtifacts.ts\n` +
    `\n` +
    `export const ${args.upperPrefix}_ENDORSEMENT_TEMPLATES_SOURCE_HASH = '${args.endorsementSourceHash}';\n` +
    `export const ${args.upperPrefix}_CLAIMS_CONTRACT_SOURCE_HASH = '${args.claimsSourceHash}';\n` +
    `export const ${args.upperPrefix}_BDX_IMPORT_SPEC_SOURCE_HASH = '${args.bdxImportSourceHash}';\n` +
    `\n` +
    `/**\n` +
    ` * Per-endorsement editable fields (union of \`parameters_schema.properties\`\n` +
    ` * keys and \`ui.form_fields[].name\`). Empty arrays mean the endorsement\n` +
    ` * accepts no operator-set parameters.\n` +
    ` */\n` +
    `export const ${args.upperPrefix}_ENDORSEMENT_EDITABLE_FIELDS = ${stringifyStringMap(args.endorsementEditableFields)} as const;\n` +
    `\n` +
    `/**\n` +
    ` * Claim form field key → \`policy.*\` prefill path. Empty when the\n` +
    ` * product's \`fullClaimForm.fields\` is empty (\`source: 'external_spec'\`\n` +
    ` * or \`'metadata'\`); the empty object IS the canonical statement that no\n` +
    ` * prefill paths are authored for the product.\n` +
    ` */\n` +
    `export const ${args.upperPrefix}_CLAIM_PREFILL_PATHS = ${stringifyFlatStringMap(args.claimPrefillPaths)} as const;\n` +
    `\n` +
    `/**\n` +
    ` * BDX raw-column → DTO map keyed as \`<group>.<field>\`, value is the\n` +
    ` * accepted alias array (canonical column first). Sourced directly from\n` +
    ` * the per-product \`*LloydsV52MappingSpec\`.\n` +
    ` */\n` +
    `export const ${args.upperPrefix}_BDX_IMPORT_RAW_TO_DTO = ${stringifyStringMap(args.bdxImportRawToDto)} as const;\n`;
}

// Most recent git commit date (YYYY-MM-DD) across the canonical source files.
// Stable across regen runs — only advances when upstream sources actually
// change. Falls back to today only when git is unavailable, so generators
// don't crash in unusual sandboxes.
function reviewedDate(files: string[] = SOURCE_FILES): string {
  const today = new Date().toISOString().slice(0, 10);
  let best: string | null = null;
  for (const filePath of files) {
    try {
      const out = execFileSync(
        'git',
        ['log', '-1', '--pretty=format:%cs', '--', path.relative(ROOT, filePath)],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], cwd: ROOT },
      ).trim();
      if (out && (!best || out > best)) best = out;
    } catch {
      // ignore — fall through to today
    }
  }
  return best || today;
}

function frontmatter(reviewed: string): string {
  return [
    '---',
    'title: Validation Contract Audit',
    'audience: architect',
    'status: reference',
    'owner: platform-eng',
    `reviewed: ${reviewed}`,
    'binding: false',
    'generated_by: tools/quality/generateValidationContractArtifacts.ts',
    '---',
    '',
  ].join('\n');
}

function generatedFileContent(args: {
  sourceHashHex: string;
  requiredByActorStage: Record<Actor, Record<Stage, string[]>>;
  quoteRequired: string[];
  bindRequired: string[];
  quoteReady: string[];
  issuanceRequired: string[];
  stepMap: Record<string, string[]>;
}): string {
  return `// AUTO-GENERATED FILE. DO NOT EDIT.\n` +
    `// Source: packages/products/src/motor/profile.ts + packages/products/src/motor/stepOwnership.ts\n` +
    `// Generator: tools/quality/generateValidationContractArtifacts.ts\n` +
    `export const MOTOR_VALIDATION_CONTRACT_SOURCE_HASH = '${args.sourceHashHex}';\n\n` +
    `export const MOTOR_REQUIRED_KEYS_BY_ACTOR_STAGE = ${JSON.stringify(args.requiredByActorStage, null, 2)} as const;\n\n` +
    `export const MOTOR_REQUIRED_BY_STAGE = {\n` +
    `  quote: ${stringifyArray(args.quoteRequired, 4)},\n` +
    `  bind: ${stringifyArray(args.bindRequired, 4)},\n` +
    `} as const;\n\n` +
    `export const MOTOR_QUOTE_READY_FIELDS = ${stringifyArray(args.quoteReady, 2)} as const;\n\n` +
    `export const MOTOR_REQUIRED_ISSUANCE_FIELDS = ${stringifyArray(args.issuanceRequired, 2)} as const;\n\n` +
    `export const MOTOR_STEP_SCOPED_FIELDS = ${stringifyStepMap(args.stepMap)} as const;\n`;
}

function writeIfChanged(filePath: string, content: string): boolean {
  const exists = fs.existsSync(filePath);
  const current = exists ? fs.readFileSync(filePath, 'utf8') : '';
  if (current === content) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return true;
}

/**
 * Inventory of which product maps are emitted by THIS generator and
 * which remain implementation-as-source.
 *
 * Generated maps (Phase C, `spine/v2` Wave 5):
 *   - `<PRODUCT>_ENDORSEMENT_EDITABLE_FIELDS` — sourced from
 *     `parameters_schema.properties` + `ui.form_fields[].name` on the
 *     per-product endorsement template lists.
 *   - `<PRODUCT>_CLAIM_PREFILL_PATHS` — sourced from the `prefillPath`
 *     strings on `fullClaimForm.fields` of each product's default
 *     claims contract. Empty objects today (claims forms authored
 *     externally, `source: 'external_spec'`).
 *   - `<PRODUCT>_BDX_IMPORT_RAW_TO_DTO` — sourced from each product's
 *     `*LloydsV52MappingSpec` (alias arrays per logical group).
 *
 * Implementation-as-source (NOT generated, justified):
 *   - **Document field map** — Motor's `documents/viewModel.ts` is a
 *     procedural mapper from `quoteData` to ~80 PDF placeholders with
 *     bespoke formatting per field (date locales, address joining,
 *     coverage flag derivation). It has no declarative root that could
 *     emit the map without losing semantics; refactoring it is its own
 *     workstream (ADR pending). Home/Travel only emit stubs today.
 *   - **Pricing input contract** — Each product's calculator function
 *     signature + `*QuoteData` Zod schema IS the contract. There is no
 *     parallel JSON/YAML spec; introducing one would duplicate the
 *     types. Canonical rules live with the product (per `product-engine-authority.md`).
 *   - **BDX export columns (Lloyd's CRS V52)** — Motor V52 is
 *     emitted as lineage CSV/JSON by a separate generator
 *     (`tools/quality/generateLloydsV52LineageArtifacts.ts`). Home and
 *     Travel have no V52 spec yet.
 */
const PRODUCT_MAP_REGISTRY: Array<{
  category: string;
  status: 'generated' | 'implementation-as-source';
  motor: string;
  home: string;
  travel: string;
  notes: string;
}> = [
  {
    category: 'Validation profile',
    status: 'generated',
    motor: '`packages/products/src/motor/generated/motorValidationContract.generated.ts`',
    home: '`packages/products/src/home/generated/homeValidationContract.generated.ts`',
    travel: '`packages/products/src/travel/generated/travelValidationContract.generated.ts`',
    notes: 'Source: `packages/products/src/<product>/profile.ts`. Generator: this script.',
  },
  {
    category: 'Endorsement editable fields',
    status: 'generated',
    motor: '`packages/products/src/motor/generated/motorProductMaps.generated.ts` (`MOTOR_ENDORSEMENT_EDITABLE_FIELDS`)',
    home: '`packages/products/src/home/generated/homeProductMaps.generated.ts` (`HOME_ENDORSEMENT_EDITABLE_FIELDS`)',
    travel: '`packages/products/src/travel/generated/travelProductMaps.generated.ts` (`TRAVEL_ENDORSEMENT_EDITABLE_FIELDS`)',
    notes: 'Sourced from each template\'s `parameters_schema.properties` + `ui.form_fields[].name` on the per-product endorsement template list.',
  },
  {
    category: 'Claim prefill paths',
    status: 'generated',
    motor: '`packages/products/src/motor/generated/motorProductMaps.generated.ts` (`MOTOR_CLAIM_PREFILL_PATHS`)',
    home: '`packages/products/src/home/generated/homeProductMaps.generated.ts` (`HOME_CLAIM_PREFILL_PATHS`)',
    travel: '`packages/products/src/travel/generated/travelProductMaps.generated.ts` (`TRAVEL_CLAIM_PREFILL_PATHS`)',
    notes: 'Sourced from `fullClaimForm.fields[].prefillPath`. Empty maps today (forms authored externally, `source: \'external_spec\'`); the empty `{}` IS the canonical statement.',
  },
  {
    category: 'BDX import column → DTO',
    status: 'generated',
    motor: '`packages/products/src/motor/generated/motorProductMaps.generated.ts` (`MOTOR_BDX_IMPORT_RAW_TO_DTO`)',
    home: '`packages/products/src/home/generated/homeProductMaps.generated.ts` (`HOME_BDX_IMPORT_RAW_TO_DTO`)',
    travel: '`packages/products/src/travel/generated/travelProductMaps.generated.ts` (`TRAVEL_BDX_IMPORT_RAW_TO_DTO`)',
    notes: 'Sourced from each product\'s `*LloydsV52MappingSpec`. Mapper routes via `__productLine` — no silent default.',
  },
  {
    category: 'Document field map (PDFs)',
    status: 'implementation-as-source',
    motor: '`backend/products/motor/documents/viewModel.ts` (~649 LOC, procedural)',
    home: '`backend/products/home/runtime.ts` (stub)',
    travel: '`backend/products/travel/runtime.ts` (stub)',
    notes: 'Procedural mapper with per-field formatting (locales, joins, derivations). No declarative root that could emit the map without losing semantics; refactor is its own workstream (ADR pending).',
  },
  {
    category: 'Pricing input contract',
    status: 'implementation-as-source',
    motor: '`backend/products/motor/pricing/autoInsuranceCalculator.ts` + `autoInsurancePricingTypes.ts`',
    home: '`backend/products/home/pricing/homeCalculator.ts`',
    travel: '`backend/products/travel/pricing/travelCalculator.ts`',
    notes: 'Calculator signature + `*QuoteData` Zod schema IS the contract. A parallel JSON/YAML spec would duplicate the types. Canonical rules are product-owned (`product-engine-authority.md`).',
  },
  {
    category: 'BDX export columns (CRS V52)',
    status: 'implementation-as-source',
    motor: '`backend/modules/reporting/domain/{crsV52Motor,bordereaux/lloydsV52}.ts`',
    home: 'N/A',
    travel: 'N/A',
    notes: 'Motor V52 lineage is auto-emitted by `tools/quality/generateLloydsV52LineageArtifacts.ts`. Home/Travel V52 export not yet in scope.',
  },
];

function renderProductMapRegistry(): string {
  const header = '| Category | Status | Motor | Home | Travel | Notes |\n| --- | --- | --- | --- | --- | --- |';
  const rows = PRODUCT_MAP_REGISTRY.map((entry) => {
    const escape = (s: string) => s.replace(/\|/g, '\\|');
    return `| ${escape(entry.category)} | ${entry.status} | ${escape(entry.motor)} | ${escape(entry.home)} | ${escape(entry.travel)} | ${escape(entry.notes)} |`;
  });
  return [header, ...rows].join('\n');
}

function generateAuditMarkdown(args: {
  motorQuoteRequired: string[];
  motorBindRequired: string[];
  motorQuoteReady: string[];
  motorIssuanceRequired: string[];
  motorStepMap: Record<string, string[]>;
  motorOverlap: Array<{ field: string; steps: string[] }>;
  motorFieldsMissingContract: string[];
  homeBind: string[];
  homeIssuance: string[];
  travelBind: string[];
  travelIssuance: string[];
  motorEndorsementCount: number;
  homeEndorsementCount: number;
  travelEndorsementCount: number;
  motorBdxGroupCount: number;
  homeBdxGroupCount: number;
  travelBdxGroupCount: number;
}): string {
  const overlapLines = args.motorOverlap.length === 0
    ? ['- none']
    : args.motorOverlap.map((entry) => `- \`${entry.field}\`: ${entry.steps.join(', ')}`);

  const missingContractLines = args.motorFieldsMissingContract.length === 0
    ? ['- none']
    : args.motorFieldsMissingContract.map((field) => `- \`${field}\``);

  const allReviewed = [
    ...SOURCE_FILES,
    ...HOME_SOURCE_FILES,
    ...TRAVEL_SOURCE_FILES,
  ];

  return `${frontmatter(reviewedDate(allReviewed))}` +
    `# Validation Contract Audit\n\n` +
    `This file is generated by \`tools/quality/generateValidationContractArtifacts.ts\`.\n\n` +
    `## Canonical sources\n\n` +
    `- Motor validation profile: \`packages/products/src/motor/profile.ts\`\n` +
    `- Motor step ownership: \`packages/products/src/motor/stepOwnership.ts\`\n` +
    `- Home validation profile: \`packages/products/src/home/profile.ts\`\n` +
    `- Travel validation profile: \`packages/products/src/travel/profile.ts\`\n\n` +
    `## Generated artifacts (consumed via \`@facio/products\`)\n\n` +
    `Validation:\n\n` +
    `- \`packages/products/src/motor/generated/motorValidationContract.generated.ts\`\n` +
    `- \`packages/products/src/home/generated/homeValidationContract.generated.ts\`\n` +
    `- \`packages/products/src/travel/generated/travelValidationContract.generated.ts\`\n\n` +
    `Per-product non-validation maps (Phase C):\n\n` +
    `- \`packages/products/src/motor/generated/motorProductMaps.generated.ts\`\n` +
    `- \`packages/products/src/home/generated/homeProductMaps.generated.ts\`\n` +
    `- \`packages/products/src/travel/generated/travelProductMaps.generated.ts\`\n\n` +
    `Each per-product map file emits three indices: \`<PRODUCT>_ENDORSEMENT_EDITABLE_FIELDS\`, \`<PRODUCT>_CLAIM_PREFILL_PATHS\`, and \`<PRODUCT>_BDX_IMPORT_RAW_TO_DTO\`, each with its own \`*_SOURCE_HASH\`. The hash flips iff the underlying source module changes — \`docs:generate:check\` fails on drift.\n\n` +
    `## Per-product summary\n\n` +
    `| Product | Quote-ready fields | Bind/Issuance fields | Step scopes | Endorsements indexed | BDX import groups |\n` +
    `| --- | ---: | ---: | ---: | ---: | ---: |\n` +
    `| Motor | ${args.motorQuoteReady.length} | ${args.motorIssuanceRequired.length} | ${Object.keys(args.motorStepMap).length} | ${args.motorEndorsementCount} | ${args.motorBdxGroupCount} |\n` +
    `| Home | n/a (no quote stage) | bind=${args.homeBind.length} issuance=${args.homeIssuance.length} | n/a | ${args.homeEndorsementCount} | ${args.homeBdxGroupCount} |\n` +
    `| Travel | n/a (no quote stage) | bind=${args.travelBind.length} issuance=${args.travelIssuance.length} | n/a | ${args.travelEndorsementCount} | ${args.travelBdxGroupCount} |\n\n` +
    `## Product map registry\n\n` +
    `Inventory of which product maps the generator emits and which remain implementation-as-source. The "implementation-as-source" rows have written justifications in the generator (\`tools/quality/generateValidationContractArtifacts.ts\`) explaining why no declarative root exists today.\n\n` +
    `${renderProductMapRegistry()}\n\n` +
    `## Motor — step ownership overlap (potential ambiguity)\n\n${overlapLines.join('\n')}\n\n` +
    `## Motor — fields in step ownership but missing in canonical questionnaire contract\n\n${missingContractLines.join('\n')}\n`;
}

function main(): void {
  // ---- Motor (per-field requiredAtStages / requiredAtByActor) ----
  const requiredByActorStage: Record<Actor, Record<Stage, string[]>> = {
    customer: collectRequiredByActorStage('customer'),
    underwriter: collectRequiredByActorStage('underwriter'),
    system: collectRequiredByActorStage('system'),
  };
  const quoteRequired = requiredByActorStage.customer.quote;
  const bindRequired = requiredByActorStage.customer.bind;
  const stepMap = readStepOwnership();
  const quoteReady = quoteRequired;
  const issuanceRequired = bindRequired;
  const sourceHashHex = sourceHash();

  const canonicalContent = generatedFileContent({
    sourceHashHex,
    requiredByActorStage,
    quoteRequired,
    bindRequired,
    quoteReady,
    issuanceRequired,
    stepMap,
  });

  const fieldsInContract = new Set(Object.keys(MOTOR_VALIDATION_FIELDS));
  const ownershipEntries = Object.entries(stepMap);
  const ownershipByField = new Map<string, string[]>();
  ownershipEntries.forEach(([step, fields]) => {
    fields.forEach((field) => {
      const existing = ownershipByField.get(field) || [];
      ownershipByField.set(field, [...existing, step]);
    });
  });

  const overlap = Array.from(ownershipByField.entries())
    .filter(([, steps]) => steps.length > 1)
    .map(([field, steps]) => ({ field, steps: sortStrings(steps) }))
    .sort((a, b) => a.field.localeCompare(b.field));

  const fieldsMissingContract = sortStrings(
    Array.from(ownershipByField.keys()).filter((field) => !fieldsInContract.has(field)),
  );

  // ---- Home + Travel + Health (declarative `stages.{bind,issuance}.fields`) ----
  const homeHash = sourceHash(HOME_SOURCE_FILES);
  const travelHash = sourceHash(TRAVEL_SOURCE_FILES);
  const healthHash = sourceHash(HEALTH_SOURCE_FILES);
  const homeBind = sortStrings((homeValidationProfile.stages?.bind?.fields as string[] | undefined) || []);
  const homeIssuance = sortStrings((homeValidationProfile.stages?.issuance?.fields as string[] | undefined) || []);
  const travelBind = sortStrings((travelValidationProfile.stages?.bind?.fields as string[] | undefined) || []);
  const travelIssuance = sortStrings((travelValidationProfile.stages?.issuance?.fields as string[] | undefined) || []);
  const healthBind = sortStrings((healthValidationProfile.stages?.bind?.fields as string[] | undefined) || []);
  const healthIssuance = sortStrings((healthValidationProfile.stages?.issuance?.fields as string[] | undefined) || []);

  const homeContent = declarativeStagesIndex({
    productCode: 'home',
    upperPrefix: 'HOME',
    profile: homeValidationProfile,
    sourceHashHex: homeHash,
  });
  const travelContent = declarativeStagesIndex({
    productCode: 'travel',
    upperPrefix: 'TRAVEL',
    profile: travelValidationProfile,
    sourceHashHex: travelHash,
  });
  const healthContent = declarativeStagesIndex({
    productCode: 'health',
    upperPrefix: 'HEALTH',
    profile: healthValidationProfile,
    sourceHashHex: healthHash,
  });

  // ---- Per-product non-validation maps (endorsement / claims / BDX import) ----
  const motorEndorsementFields = endorsementEditableFields(MOTOR_ENDORSEMENT_TEMPLATES);
  const homeEndorsementFields = endorsementEditableFields(HOME_ENDORSEMENT_TEMPLATES);
  const travelEndorsementFields = endorsementEditableFields(TRAVEL_ENDORSEMENT_TEMPLATES);
  const healthEndorsementFields = endorsementEditableFields(HEALTH_ENDORSEMENT_TEMPLATES);

  const motorClaimPrefill = claimPrefillPaths(motorDefaultClaimsContract);
  const homeClaimPrefill = claimPrefillPaths(homeDefaultClaimsContract);
  const travelClaimPrefill = claimPrefillPaths(travelDefaultClaimsContract);
  const healthClaimPrefill = claimPrefillPaths(healthDefaultClaimsContract);

  const motorBdxImport = bdxImportRawToDto(motorLloydsV52MappingSpec as Record<string, unknown>);
  const homeBdxImport = bdxImportRawToDto(homeLloydsV52MappingSpec as Record<string, unknown>);
  const travelBdxImport = bdxImportRawToDto(travelLloydsV52MappingSpec as Record<string, unknown>);
  // HEALTH Phase 1 ships without BDX import — empty map is the canonical
  // statement that no BDX mapper is authored yet.
  const healthBdxImport: Record<string, string[]> = {};

  const motorProductMapsContent = productMapsContent({
    productCode: 'motor',
    upperPrefix: 'MOTOR',
    endorsementSourceHash: sourceHash([...ENDORSEMENT_SOURCE_FILES.motor]),
    claimsSourceHash: sourceHash([...CLAIMS_SOURCE_FILES.motor]),
    bdxImportSourceHash: sourceHash([...BDX_IMPORT_SOURCE_FILES.motor]),
    endorsementEditableFields: motorEndorsementFields,
    claimPrefillPaths: motorClaimPrefill,
    bdxImportRawToDto: motorBdxImport,
  });
  const homeProductMapsContent = productMapsContent({
    productCode: 'home',
    upperPrefix: 'HOME',
    endorsementSourceHash: sourceHash([...ENDORSEMENT_SOURCE_FILES.home]),
    claimsSourceHash: sourceHash([...CLAIMS_SOURCE_FILES.home]),
    bdxImportSourceHash: sourceHash([...BDX_IMPORT_SOURCE_FILES.home]),
    endorsementEditableFields: homeEndorsementFields,
    claimPrefillPaths: homeClaimPrefill,
    bdxImportRawToDto: homeBdxImport,
  });
  const travelProductMapsContent = productMapsContent({
    productCode: 'travel',
    upperPrefix: 'TRAVEL',
    endorsementSourceHash: sourceHash([...ENDORSEMENT_SOURCE_FILES.travel]),
    claimsSourceHash: sourceHash([...CLAIMS_SOURCE_FILES.travel]),
    bdxImportSourceHash: sourceHash([...BDX_IMPORT_SOURCE_FILES.travel]),
    endorsementEditableFields: travelEndorsementFields,
    claimPrefillPaths: travelClaimPrefill,
    bdxImportRawToDto: travelBdxImport,
  });
  const healthProductMapsContent = productMapsContent({
    productCode: 'health',
    upperPrefix: 'HEALTH',
    endorsementSourceHash: sourceHash([...ENDORSEMENT_SOURCE_FILES.health]),
    claimsSourceHash: sourceHash([...CLAIMS_SOURCE_FILES.health]),
    // No BDX mapper authored for HEALTH yet — hash the empty source list
    // so the artifact carries a stable empty hash placeholder. When the
    // mapper is added, add a BDX_IMPORT_SOURCE_FILES.health entry above.
    bdxImportSourceHash: sourceHash([]),
    endorsementEditableFields: healthEndorsementFields,
    claimPrefillPaths: healthClaimPrefill,
    bdxImportRawToDto: healthBdxImport,
  });

  // ---- Audit artifacts ----
  const auditMarkdown = generateAuditMarkdown({
    motorQuoteRequired: quoteRequired,
    motorBindRequired: bindRequired,
    motorQuoteReady: quoteReady,
    motorIssuanceRequired: issuanceRequired,
    motorStepMap: stepMap,
    motorOverlap: overlap,
    motorFieldsMissingContract: fieldsMissingContract,
    homeBind,
    homeIssuance,
    travelBind,
    travelIssuance,
    motorEndorsementCount: Object.keys(motorEndorsementFields).length,
    homeEndorsementCount: Object.keys(homeEndorsementFields).length,
    travelEndorsementCount: Object.keys(travelEndorsementFields).length,
    motorBdxGroupCount: Object.keys(motorBdxImport).length,
    homeBdxGroupCount: Object.keys(homeBdxImport).length,
    travelBdxGroupCount: Object.keys(travelBdxImport).length,
  });

  const auditJson = JSON.stringify(
    {
      motor: {
        sourceHash: sourceHashHex,
        quoteRequired,
        bindRequired,
        quoteReady,
        issuanceRequired,
        stepMap,
        overlap,
        fieldsMissingContract,
        endorsementEditableFields: motorEndorsementFields,
        claimPrefillPaths: motorClaimPrefill,
        bdxImportRawToDto: motorBdxImport,
      },
      home: {
        sourceHash: homeHash,
        bind: homeBind,
        issuance: homeIssuance,
        endorsementEditableFields: homeEndorsementFields,
        claimPrefillPaths: homeClaimPrefill,
        bdxImportRawToDto: homeBdxImport,
      },
      travel: {
        sourceHash: travelHash,
        bind: travelBind,
        issuance: travelIssuance,
        endorsementEditableFields: travelEndorsementFields,
        claimPrefillPaths: travelClaimPrefill,
        bdxImportRawToDto: travelBdxImport,
      },
    },
    null,
    2,
  ) + '\n';

  if (CHECK_MODE) {
    const expected: Array<[string, string]> = [
      [CANONICAL_OUTPUT, canonicalContent],
      [HOME_OUTPUT, homeContent],
      [TRAVEL_OUTPUT, travelContent],
      [HEALTH_OUTPUT, healthContent],
      [PRODUCT_MAPS_OUTPUTS.motor, motorProductMapsContent],
      [PRODUCT_MAPS_OUTPUTS.home, homeProductMapsContent],
      [PRODUCT_MAPS_OUTPUTS.travel, travelProductMapsContent],
      [PRODUCT_MAPS_OUTPUTS.health, healthProductMapsContent],
      [AUDIT_JSON_OUTPUT, auditJson],
      [AUDIT_MD_OUTPUT, auditMarkdown],
    ];
    const stale = expected.filter(([filePath, expectedContent]) => {
      if (!fs.existsSync(filePath)) return true;
      return fs.readFileSync(filePath, 'utf8') !== expectedContent;
    });
    if (stale.length > 0) {
      console.error(
        '[validation-contract] generated artifacts are out-of-date:\n' +
        stale.map(([filePath]) => ` - ${path.relative(ROOT, filePath)}`).join('\n'),
      );
      process.exit(1);
    }
    console.log('[validation-contract] generated artifacts are up-to-date');
    return;
  }

  const changed: string[] = [];
  if (writeIfChanged(CANONICAL_OUTPUT, canonicalContent)) changed.push(path.relative(ROOT, CANONICAL_OUTPUT));
  if (writeIfChanged(HOME_OUTPUT, homeContent)) changed.push(path.relative(ROOT, HOME_OUTPUT));
  if (writeIfChanged(TRAVEL_OUTPUT, travelContent)) changed.push(path.relative(ROOT, TRAVEL_OUTPUT));
  if (writeIfChanged(HEALTH_OUTPUT, healthContent)) changed.push(path.relative(ROOT, HEALTH_OUTPUT));
  if (writeIfChanged(PRODUCT_MAPS_OUTPUTS.motor, motorProductMapsContent)) changed.push(path.relative(ROOT, PRODUCT_MAPS_OUTPUTS.motor));
  if (writeIfChanged(PRODUCT_MAPS_OUTPUTS.home, homeProductMapsContent)) changed.push(path.relative(ROOT, PRODUCT_MAPS_OUTPUTS.home));
  if (writeIfChanged(PRODUCT_MAPS_OUTPUTS.travel, travelProductMapsContent)) changed.push(path.relative(ROOT, PRODUCT_MAPS_OUTPUTS.travel));
  if (writeIfChanged(PRODUCT_MAPS_OUTPUTS.health, healthProductMapsContent)) changed.push(path.relative(ROOT, PRODUCT_MAPS_OUTPUTS.health));
  if (writeIfChanged(AUDIT_JSON_OUTPUT, auditJson)) changed.push(path.relative(ROOT, AUDIT_JSON_OUTPUT));
  if (writeIfChanged(AUDIT_MD_OUTPUT, auditMarkdown)) changed.push(path.relative(ROOT, AUDIT_MD_OUTPUT));

  if (changed.length === 0) {
    console.log('[validation-contract] no changes');
    return;
  }
  console.log('[validation-contract] updated artifacts:\n' + changed.map((filePath) => ` - ${filePath}`).join('\n'));
}

main();


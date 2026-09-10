#!/usr/bin/env node
/**
 * Architecture locks guard (Phase 7c — Final Consolidation Pass closure).
 *
 * The Questionnaire Path Consolidation passes (Phases 4 → 8) collapsed
 * every product manifest, validation profile, validation contract, FE
 * Zod tree, BO orchestration, wizard chrome, and policyholder step into
 * a small number of canonical sources. Phase 7c locks those decisions
 * in so the architecture cannot quietly regress.
 *
 * The guard fails on any of the following patterns:
 *
 *   A. Renderer-engine resurrection.
 *      - Any new `customRenderer` prop / `renderQuestion` registry / per-
 *        product render hook that re-creates the manifest-to-component
 *        framework explicitly rejected in baseline §11. We grep the few
 *        identifier shapes that previous attempts used. Renaming the
 *        identifier is allowed only with an audit-log entry — the guard
 *        catches the obvious shapes.
 *
 *   B. New "Legacy / Compat / Aliases" identifiers in source.
 *      - Phase 7c reduced the surface to a small documented set of
 *        load-bearing aliases (motor flat data shape, persisted DB
 *        columns). Adding new identifiers ending in / containing
 *        `Legacy`, `Compat`, or `Aliases` in source files (excluding
 *        an explicit allow-list) is forbidden. `legacy` in a comment
 *        is allowed.
 *
 *   C. FE-only product Zod schemas reintroduced.
 *      - This is also enforced by check-products-single-source.mjs
 *        (Rule 5). Re-asserted here so a single guard run gives a clear
 *        "architecture is locked" verdict.
 *
 *   D. New `.passthrough()` calls in canonical BE Zod schemas.
 *      - Phase 8 deleted every `.passthrough()` from the backend
 *        canonical motor schemas. New `.passthrough()` calls under
 *        `backend/products/<product>/` and `backend/modules/policy/` are
 *        forbidden — schemas must reject unknown keys. Per-step wizard
 *        schemas under `packages/products/src/<product>/schemas/` may
 *        keep `.passthrough()` for cross-step tolerance and are exempt.
 *
 *   E. Flat `quoteData.firstName / .lastName / .email / .phone` reads.
 *      - Phase 6k canonicalised every product's `quoteData.proposer.*`
 *        accessor (`PolicyHolderProfile`). Flat reads at the wizard /
 *        BO / claims surface re-introduce the very drift the canonical
 *        type was created to prevent, so any expression of the form
 *        `<name>.firstName` / `<name>.lastName` / `<name>.email` /
 *        `<name>.phone` where `<name>` resolves to a parsed quoteData
 *        record (matched syntactically by `qd.<field>` /
 *        `quoteData.<field>` / `quoteData?.<field>`) is forbidden.
 *        Consumers read `proposer.<field>` directly — no helper, no
 *        shim. Introduced for Wave 1 of `spine/v2`.
 *
 *   F. Issuance-gate bypass.
 *      - `evaluateIssueReadiness` is the canonical pre-issuance gate
 *        (Wave 5 cutover protocol §convergence-gate item 6). Any file
 *        calling `transitionPolicyLifecycle({ to: 'ISSUING' | 'ISSUED'
 *        | 'AWAITING_PAYMENT' | 'ACTIVE' })` MUST also call
 *        `evaluateIssueReadiness(` somewhere in the file, OR appear in
 *        ISSUANCE_BYPASS_ALLOWLIST with a documented carve-out reason.
 *        Adding a new bypasser without an allow-list entry is
 *        forbidden — it represents a side-door re-introduction.
 *
 *   G. Pricing-façade deletion + leaf-calculator isolation.
 *      - `modules/pricing/app/calculator.ts` and
 *        `modules/pricing/app/autoInsuranceCalculator.ts` were deleted
 *        as dead façades. Canonical pricing is `IProductAdapter`
 *        (`buildQuoteResponse` / `calculatePremium`). Re-creating
 *        either file, or any source reference to the paths, is
 *        forbidden — it re-introduces a fake canonical road.
 *      - The per-product leaf calculators
 *        (`calculate(Auto|Home|Travel)Insurance(Premium|QuoteResponse)`
 *        and the family of `calculate*Premium` / `calculate*QuoteResponse`
 *        functions exported from `backend/products/<product>/pricing/`)
 *        may ONLY be imported by the matching per-product engine
 *        (`backend/products/<product>/engines/`), the leaf module itself,
 *        approved test fixtures, and approved seed/migration tooling.
 *        Any other source-form reference is a bypass — it re-introduces
 *        an alternate pricing road around `adapter.buildQuoteResponse`
 *        and `adapter.calculatePremium`. New consumers MUST go through
 *        the adapter; no exceptions added without an entry in
 *        `LEAF_PRICING_IMPORT_ALLOWLIST` and a baseline note.
 *
 * Exit codes:
 *   0 = clean
 *   1 = at least one architecture lock was tripped
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const SOURCE_EXT = /\.(ts|tsx|mjs|cjs|js|jsx)$/;
const SCAN_ROOTS = ['frontend/src', 'backend', 'packages', 'tools/migrations', 'apps'];
const SKIP_DIR_NAMES = new Set([
  'node_modules', 'dist', 'build', '.next', '.turbo', 'coverage', 'artifacts',
]);

// This guard file is the only non-doc place where the forbidden
// identifiers are listed for enforcement; skip self.
const SELF = 'tools/quality/check-architecture-locks.mjs';

function toPosix(value) { return String(value || '').replaceAll('\\', '/'); }

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(abs);
    else if (entry.isFile()) yield abs;
  }
}

// ---------------------------------------------------------------------------
// Lock A — renderer-engine resurrection
// ---------------------------------------------------------------------------

const RENDERER_ENGINE_PATTERNS = [
  // The exact escape-hatch prop the BO renderer carried before Phase 6a.
  /\bcustomRenderer\s*[:=?]/,
  // Per-product render registries.
  /\brenderQuestion(?:Registry|Map|Lookup)\b/,
  // Manifest-driven component dispatchers.
  /\bquestionnaireRendererRegistry\b/,
];

// Files that legitimately mention these tokens in test names / comments
// to assert the absence of the escape hatch.
const RENDERER_ALLOWLIST = new Set([
  'frontend/src/modules/policies/underwriting/renderers/__tests__/QuestionnaireQuestionCard.test.tsx',
  'tools/quality/check-architecture-locks.mjs',
]);

// ---------------------------------------------------------------------------
// Lock B — new Legacy / Compat / Aliases identifiers
// ---------------------------------------------------------------------------

// PascalCase / camelCase identifier shapes ending in or containing
// Legacy / Compat / Aliases at a token boundary.
const LEGACY_TOKEN_PATTERN = /\b[A-Za-z][A-Za-z0-9_]*(?:Legacy|Compat|Aliases)\b/;

// Documented load-bearing legacy surfaces. Each entry is an exact
// `"<file>:<symbol>"` pair. Adding a new entry requires (a) a baseline
// note explaining why removing the symbol requires deferred work
// (typically Phase 6k — motor flat→nested, or a DB schema migration),
// and (b) an explicit PR review.
const LEGACY_ALLOWLIST = new Set([
  // Motor-only UW adjustment line type. Phase 6k removed the policyholder
  // flat-shape; this UW-line legacy alias is a separate persistence
  // concern (single-vs-array `uwAdjustment`) and continues until the
  // adjustments-list normalisation lands in a follow-up.
  'frontend/src/products/motor/wizard/types/index.ts:UwAdjustmentLineLegacy',
  'backend/platform/types/autoInsurance.ts:UwAdjustmentLineLegacy',
  // Single-vs-array `uwAdjustment` legacy alias inside motor docs view.
  // Adjustments-list normalisation, separate from Phase 6k.
  'backend/products/motor/documents/viewModel.ts:rawLegacy',
]);

// Files exempt from the Lock B scan entirely (test fixtures, fixtures
// for legacy data, generated code, the guard itself).
const LEGACY_FILE_ALLOWLIST = new Set([
  SELF,
  // Generated artifacts.
  'packages/products/src/motor/generated/motorValidationContract.generated.ts',
]);

// ---------------------------------------------------------------------------
// Lock C — FE-only product Zod-schema trees (mirrors Rule 5 of
// check-products-single-source.mjs).
// ---------------------------------------------------------------------------

const FE_PRODUCTS_DIR = 'frontend/src/products';

// ---------------------------------------------------------------------------
// Lock D — new .passthrough() in canonical BE Zod
// ---------------------------------------------------------------------------

const PASSTHROUGH_PATTERN = /\.passthrough\s*\(\s*\)/;

// `.passthrough()` is allowed in:
//   - per-step wizard schemas (cross-step tolerance is a feature)
//   - test fixtures
const PASSTHROUGH_ALLOWED_PATH_PREFIXES = [
  'packages/products/src/motor/schemas/',
  'packages/products/src/travel/schemas/',
  'packages/products/src/home/schemas/',
];
const PASSTHROUGH_ALLOWED_FILE_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts'];

// Only enforce on canonical BE quote/policy data Zod surfaces. Admin
// surfaces (binder simulation, accounts admin, claims intake) keep
// `.passthrough()` for genuinely heterogeneous payloads — they are not
// the strictness target Phase 8 hardened.
const PASSTHROUGH_ENFORCED_ROOTS = [
  // `motorQuoteDataSchema.ts` was deleted in `spine/v2` Wave 2; the
  // motor Zod tree now lives in `packages/products/src/motor/schemas/`
  // and is consumed via `validateForContext` step + stage refinements.
  'backend/products/motor/quotes/',
  'backend/products/home/',
  'backend/products/travel/',
];

// ---------------------------------------------------------------------------
// Lock E — flat policyholder reads (Phase 6k → Wave 1 of spine/v2)
// ---------------------------------------------------------------------------

// Match `qd.firstName`, `quoteData.firstName`, `quoteData?.firstName`, etc.
// for the four canonical proposer fields. Anchored to a leading `qd.` /
// `quoteData.` / `quoteData?.` token so we don't false-positive on e.g.
// `someUserRecord.firstName` (which is not a quoteData read).
const FLAT_POLICYHOLDER_PATTERN =
  /\b(?:qd|quoteData|quote_data)\??\.(?:firstName|lastName|email|phone)\b/;

// Tests and fixtures legitimately reference the legacy flat shape to
// assert it is rejected; the canonical type file describes the shape in
// a docstring; the guard self-references the pattern.
const FLAT_POLICYHOLDER_FILE_ALLOWLIST = new Set([
  SELF,
  'packages/products/src/shared/policyHolder.ts',
]);
const FLAT_POLICYHOLDER_PATH_ALLOW_PREFIXES = [
  // Generated artefacts emitted from the canonical contract; the names
  // appear in maps but the values are read via canonical paths.
  'packages/products/src/motor/generated/',
];
const FLAT_POLICYHOLDER_FILE_SUFFIX_ALLOW = ['.test.ts', '.test.tsx', '.spec.ts'];

// ---------------------------------------------------------------------------
// Lock F — issuance-gate bypass (Wave 5 cutover convergence gate item 6)
// ---------------------------------------------------------------------------

// File contains a call to transitionPolicyLifecycle (any signature).
const TRANSITION_CALL_PATTERN = /\btransitionPolicyLifecycle\s*\(/;

// Same file (anywhere) targets one of the issuance lifecycle states
// via an inline literal `to: 'ISSUING' | 'ISSUED' | 'AWAITING_PAYMENT'
// | 'ACTIVE'`. We tolerate trailing whitespace and either quote style.
const ISSUANCE_TARGET_PATTERN =
  /\bto\s*:\s*['"](?:ISSUING|ISSUED|AWAITING_PAYMENT|ACTIVE)['"]/;

// Files that legitimately bypass evaluateIssueReadiness, with reason.
// New entries require a baseline / cutover-doc note explaining the
// carve-out. Each entry: `<file>` → `<reason>`.
const ISSUANCE_BYPASS_ALLOWLIST = new Map([
  // The transition function definition itself.
  ['backend/modules/policy/app/commands/policyLifecycleCommands.ts',
    'definition file — defines transitionPolicyLifecycle.'],
  // Payment webhook → ISSUED/ACTIVE. Readiness was already gated when
  // BindPolicy moved the policy to AWAITING_PAYMENT; re-running gate
  // on payment confirmation would risk false-blocks if the readiness
  // state changed between bind and pay (e.g. transient sanctions
  // provider outage). Documented in Wave 5 cutover convergence gate.
  ['backend/modules/payments/app/cardcorpPolicyIssuanceService.ts',
    'post-payment issuance webhook — readiness gated upstream by BindPolicy.'],
  // Pre-issuance "checkout started" best-effort transition to
  // AWAITING_PAYMENT. Idempotent — policy is already AWAITING_PAYMENT
  // after BindPolicy. Wrapped in `.catch(() => undefined)`.
  ['backend/modules/payments/app/cardcorpCheckoutService.ts',
    'pre-issuance idempotent AWAITING_PAYMENT setter — readiness gated upstream.'],
  // BO admin status override. Operates on policies whose readiness
  // was already established; admin authority is the gate. Logged via
  // POLICY_HEADER_UPDATE reason.
  ['backend/modules/policy/http/statusRouter.ts',
    'BO admin status override — admin authority is the gate; audit-logged.'],
  // Cancellation reject flow restores CANCELLATION_REQUESTED → ACTIVE.
  // Not a new issuance event; the policy was already ACTIVE before
  // the cancellation request. Re-gating readiness here would be a
  // category error.
  ['backend/modules/policy/http/cancellationsRouter.ts',
    'cancellation-reject restoration to prior ACTIVE state — not an issuance event.'],
]);

// ---------------------------------------------------------------------------
// Lock G — pricing-façade deletion (resurrection OR source reference)
// ---------------------------------------------------------------------------

// Match any source-form reference to either deleted path (imports,
// dynamic imports, `vi.mock(...)` strings, re-export specifiers).
const DELETED_PRICING_FACADE_PATTERN =
  /pricing\/app\/(?:calculator|autoInsuranceCalculator)(?:\.(?:ts|js|mjs|cjs))?\b/;

// Match any source-form import of a leaf pricing function. Catches
// `calculateAutoInsurancePremium`, `calculateAutoInsuranceQuoteResponse`,
// `calculateHomePremium`, `calculateTravelQuoteResponse`, and any
// `calculate<X>(Premium|QuoteResponse)` symbol exported from a
// product's `pricing/` directory. We match the identifier in import-
// like contexts (named import / dynamic import / vi.mock / require)
// rather than every textual occurrence, to avoid false positives in
// docs/comments.
const LEAF_PRICING_IMPORT_PATTERN =
  /\bcalculate[A-Za-z]+(?:Premium|QuoteResponse)\b/;
const LEAF_PRICING_CONTEXT_PATTERN =
  /(?:^|\W)(?:import\s*\{[^}]*|import\([^)]*['"][^'"]*pricing|from\s*['"][^'"]*pricing|require\(['"][^'"]*pricing|vi\.mock\(['"][^'"]*pricing)/;

// Files allowed to reach into the leaf calculators directly. Each
// entry is a relative path under repo root. New entries require a
// documented justification in the same PR that adds them.
//
// Approved categories:
//   - The leaf module itself (defines + may re-export within the file).
//   - The per-product engine module (canonical caller).
//   - Tests under `**/__tests__/` and `**/*.test.ts(x)`.
//   - Seed (`backend/seed.ts`) — bootstraps fixture data, runs once
//     per environment, never serves user traffic.
//   - Migrations under `tools/migrations/` — historical data fixes.
//   - Recommendations cataloging (Motor only, today) — uses the leaf
//     to compute marginal premium impact for each option without
//     bypassing the BO Recalculate path. See baseline note.
const LEAF_PRICING_IMPORT_ALLOWLIST = new Set([
  // Per-product engines (canonical caller of the leaf):
  'backend/products/motor/pricing/autoInsuranceCalculator.ts',
  'backend/products/motor/engines/MotorCompiledRatingEngine.ts',
  'backend/products/home/pricing/homeCalculator.ts',
  // Symphony source engine is split at function boundaries. These are internal
  // modules of the registered COMMERCIAL calculator, never transport consumers.
  // See ADR-0104 source-engine composition boundary.
  'backend/products/commercial/pricing/premium.ts',
  'backend/products/commercial/pricing/productLines.ts',
  // Home + Travel inline their compiled rating engine inside
  // `runtime.ts` rather than carrying a dedicated `engines/` module
  // (Motor has the dedicated module). Their `runtime.ts` IS the
  // engine — adding them here is the canonical-engine allowance,
  // not a bypass.
  'backend/products/home/runtime.ts',
  'backend/products/travel/pricing/travelCalculator.ts',
  'backend/products/travel/runtime.ts',
  // HEALTH follows the same `runtime.ts` IS the engine pattern as Home
  // and Travel — no dedicated `engines/` module. Its runtime calls the
  // leaf calculator directly because the compiled engine lives in the
  // same file. Identical canonical-engine allowance, not a bypass.
  'backend/products/health/runtime.ts',
  // Bootstrap fixtures + historical migrations (no user traffic).
  // The seed entrypoint was split into per-stage modules in PR 2.3b
  // of the errors-and-warnings cleanup; helpers.ts is the only one
  // that reaches into the leaf calculator (the per-stage files use
  // it via `createComputedAutoQuote`).
  'backend/seed.ts',
  'backend/seed/helpers.ts',
  // Recommendations catalog computes marginal premium for each
  // recommendation option. Refactor to an adapter-based marginal-
  // pricing API is its own workstream — tracked as a follow-up in
  // canonical-ownership.md. Listed here so the lock holds the line
  // at "no NEW bypasses" without breaking the existing one.
  'backend/modules/recommendations/domain/catalog/abbeygate/auto.ts',
]);
function isAllowedLeafPricingCaller(rel) {
  if (LEAF_PRICING_IMPORT_ALLOWLIST.has(rel)) return true;
  if (/\b__tests__\b/.test(rel)) return true;
  if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(rel)) return true;
  if (rel.startsWith('tools/migrations/')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const violations = [];

// G (resurrection): either deleted file existing on disk is itself a violation.
for (const rel of [
  'backend/modules/pricing/app/calculator.ts',
  'backend/modules/pricing/app/autoInsuranceCalculator.ts',
]) {
  if (fs.existsSync(path.join(ROOT, rel))) {
    violations.push({ kind: 'pricing-facade-resurrected', path: rel });
  }
}

for (const root of SCAN_ROOTS) {
  for (const file of walk(path.join(ROOT, root))) {
    if (!SOURCE_EXT.test(file)) continue;
    const rel = toPosix(path.relative(ROOT, file));
    if (rel === SELF) continue;

    const src = fs.readFileSync(file, 'utf8');

    // A: renderer-engine
    if (!RENDERER_ALLOWLIST.has(rel)) {
      for (const pattern of RENDERER_ENGINE_PATTERNS) {
        if (pattern.test(src)) {
          violations.push({ kind: 'renderer-engine', path: rel, pattern: String(pattern) });
          break;
        }
      }
    }

    // B: legacy identifiers — only flag declarations / exports, not comments.
    if (!LEGACY_FILE_ALLOWLIST.has(rel)) {
      const lines = src.split(/\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip pure comment lines.
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
        const match = line.match(LEGACY_TOKEN_PATTERN);
        if (!match) continue;
        const symbol = match[0];
        const allowKey = `${rel}:${symbol}`;
        if (LEGACY_ALLOWLIST.has(allowKey)) continue;
        violations.push({ kind: 'legacy-identifier', path: rel, symbol, line: i + 1 });
      }
    }

    // D: passthrough on BE canonical Zod (skip pure comment lines and
    // backtick-quoted prose mentions in headers).
    const isEnforcedForPassthrough = PASSTHROUGH_ENFORCED_ROOTS.some((r) => rel.startsWith(r));
    const isExemptForPassthrough = PASSTHROUGH_ALLOWED_PATH_PREFIXES.some((p) => rel.startsWith(p))
      || PASSTHROUGH_ALLOWED_FILE_SUFFIXES.some((s) => rel.endsWith(s));
    if (isEnforcedForPassthrough && !isExemptForPassthrough) {
      const lines = src.split(/\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
        if (PASSTHROUGH_PATTERN.test(line)) {
          violations.push({ kind: 'be-zod-passthrough', path: rel, line: i + 1 });
          break;
        }
      }
    }

    // E: flat policyholder reads (Phase 6k → spine/v2 Wave 1).
    const isFlatHolderExempt = FLAT_POLICYHOLDER_FILE_ALLOWLIST.has(rel)
      || FLAT_POLICYHOLDER_PATH_ALLOW_PREFIXES.some((p) => rel.startsWith(p))
      || FLAT_POLICYHOLDER_FILE_SUFFIX_ALLOW.some((s) => rel.endsWith(s));
    if (!isFlatHolderExempt) {
      const lines = src.split(/\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
        const match = line.match(FLAT_POLICYHOLDER_PATTERN);
        if (!match) continue;
        violations.push({ kind: 'flat-policyholder-read', path: rel, line: i + 1, expression: match[0] });
      }
    }

    // F: issuance-gate bypass (Wave 5 cutover convergence gate item 6).
    // Test files legitimately exercise lifecycle transitions in
    // isolation; only enforce on production source.
    const isTestFile = /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(rel);
    if (!isTestFile && !ISSUANCE_BYPASS_ALLOWLIST.has(rel)) {
      const transitions = TRANSITION_CALL_PATTERN.test(src);
      const targetsIssuance = ISSUANCE_TARGET_PATTERN.test(src);
      if (transitions && targetsIssuance) {
        const callsGate = /\bevaluateIssueReadiness\s*\(/.test(src);
        if (!callsGate) {
          violations.push({ kind: 'issuance-gate-bypass', path: rel });
        }
      }
    }

    // G: any source reference to the deleted pricing-façade paths.
    if (DELETED_PRICING_FACADE_PATTERN.test(src)) {
      violations.push({ kind: 'pricing-facade-reference', path: rel });
    }

    // G (extension): leaf pricing calculator imported from outside the
    // approved consumer set. Detect the import-context first to avoid
    // matching docs/comments that mention the symbol name.
    if (!isAllowedLeafPricingCaller(rel)) {
      const lines = src.split(/\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
        if (!LEAF_PRICING_IMPORT_PATTERN.test(line)) continue;
        // Combine the line with its predecessor + successor for multi-
        // line import statements (`import {\n  calculateX\n} from ...`).
        const window = [
          lines[i - 2] || '', lines[i - 1] || '', line, lines[i + 1] || '', lines[i + 2] || '',
        ].join('\n');
        if (LEAF_PRICING_CONTEXT_PATTERN.test(window)) {
          const symMatch = line.match(LEAF_PRICING_IMPORT_PATTERN);
          violations.push({
            kind: 'leaf-pricing-bypass',
            path: rel,
            line: i + 1,
            symbol: symMatch ? symMatch[0] : '?',
          });
          break;
        }
      }
    }
  }
}

// C: FE-only product Zod-schema trees (re-assertion of single-source Rule 5)
const productsDirAbs = path.join(ROOT, FE_PRODUCTS_DIR);
if (fs.existsSync(productsDirAbs)) {
  for (const entry of fs.readdirSync(productsDirAbs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const product = entry.name;
    const schemasRel = `${FE_PRODUCTS_DIR}/${product}/wizard/schemas`;
    if (fs.existsSync(path.join(ROOT, schemasRel))) {
      violations.push({ kind: 'fe-only-wizard-schemas-dir', path: schemasRel, product });
    }
  }
}

if (violations.length > 0) {
  console.error('[architecture-locks] FAILED — a Phase 7c architecture invariant tripped.');
  console.error('');
  console.error('See docs/architecture/questionnaire-consolidation/baseline.md §11–13.');
  console.error('');
  for (const v of violations) {
    if (v.kind === 'renderer-engine') {
      console.error(`  - renderer-engine pattern reintroduced: ${v.path} (matched ${v.pattern})`);
      console.error('       Phase 6a deleted the BO `customRenderer` escape hatch and');
      console.error('       baseline §11 permanently rejects manifest-to-component');
      console.error('       framework patterns. Render via the existing static dispatch');
      console.error('       in `QuestionnaireQuestionCard` instead.');
    } else if (v.kind === 'legacy-identifier') {
      console.error(`  - new Legacy/Compat/Aliases identifier: ${v.path}:${v.line} → ${v.symbol}`);
      console.error('       Add the symbol to LEGACY_ALLOWLIST only with a baseline');
      console.error('       note explaining why removing it requires deferred work.');
    } else if (v.kind === 'fe-only-wizard-schemas-dir') {
      console.error(`  - FE-only wizard schemas dir reintroduced for '${v.product}': ${v.path}`);
      console.error('       Phase 8 absorbed every product\'s Zod tree into @facio/products.');
    } else if (v.kind === 'be-zod-passthrough') {
      console.error(`  - new .passthrough() in canonical BE Zod: ${v.path}`);
      console.error('       Phase 8 made backend canonical schemas strict. Reject unknown');
      console.error('       keys at the boundary; coerce/normalise upstream instead.');
    } else if (v.kind === 'flat-policyholder-read') {
      console.error(`  - flat policyholder read: ${v.path}:${v.line} → ${v.expression}`);
      console.error('       Phase 6k canonicalised the proposer shape. Read');
      console.error('       `proposer.firstName` / `.lastName` / `.email` / `.phone`');
      console.error('       directly off `quoteData.proposer`. No helper, no shim.');
    } else if (v.kind === 'issuance-gate-bypass') {
      console.error(`  - issuance-gate bypass: ${v.path}`);
      console.error('       File transitions a policy into ISSUING/ISSUED/');
      console.error('       AWAITING_PAYMENT/ACTIVE without calling');
      console.error('       evaluateIssueReadiness first. Wave 5 cutover');
      console.error('       convergence gate item 6 forbids this. Either:');
      console.error('       (a) call evaluateIssueReadiness in this file before');
      console.error('           the transition, or');
      console.error('       (b) add the file to ISSUANCE_BYPASS_ALLOWLIST with a');
      console.error('           documented carve-out reason in this guard.');
    } else if (v.kind === 'pricing-facade-resurrected' || v.kind === 'pricing-facade-reference') {
      console.error(`  - deleted pricing façade ${v.kind === 'pricing-facade-resurrected' ? 're-introduced' : 'referenced'}: ${v.path}`);
      console.error('       Canonical pricing is IProductAdapter (buildQuoteResponse /');
      console.error('       calculatePremium). Remove the file/import/mock/string.');
    } else if (v.kind === 'leaf-pricing-bypass') {
      console.error(`  - leaf pricing calculator imported outside approved consumers: ${v.path}:${v.line} → ${v.symbol}`);
      console.error('       Canonical road: route through `IProductAdapter.buildQuoteResponse`');
      console.error('       (or `.calculatePremium`). The leaf calculators in');
      console.error('       `backend/products/<product>/pricing/` may only be reached by');
      console.error('       the per-product engine, the leaf module itself, approved');
      console.error('       tests/seeds/migrations, or an entry in');
      console.error('       LEAF_PRICING_IMPORT_ALLOWLIST. New consumers MUST go through');
      console.error('       the adapter — no exceptions added without a baseline note.');
    }
  }
  process.exit(1);
}

console.log('[architecture-locks] OK');

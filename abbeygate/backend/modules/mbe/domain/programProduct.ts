import { MagicBRegistry, type EndorsementCatalog } from './registry.js';
import { MagicBRulesEngine } from './rulesEngine.js';
import type { EndorsementTemplate } from './types.js';

/**
 * This module operates on the motor program's MBE DSL (rich rules, effects,
 * schedule sections). It is intentionally motor-scoped; non-motor products
 * drive their coverage behaviour through the manifest + product adapter instead.
 */
type UnknownRecord = Record<string, unknown>;
const asRecord = (x: unknown): UnknownRecord =>
  Boolean(x) && typeof x === 'object' && !Array.isArray(x) ? (x as UnknownRecord) : {};

function readPath(source: unknown, path: string): unknown {
  return String(path || '').split('.').filter(Boolean).reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as UnknownRecord)[part];
  }, source);
}

function selectedWhenMatches(template: EndorsementTemplate, snapshot: UnknownRecord): boolean {
  const rules = asRecord(template.option_defaults).selectedWhen;
  if (!Array.isArray(rules)) return false;
  return rules.some((rule) => {
    const record = asRecord(rule);
    const path = String(record.path || '').trim();
    if (!path) return false;
    const actual = readPath(snapshot, path);
    if (Object.prototype.hasOwnProperty.call(record, 'equals')) return actual === record.equals;
    return Boolean(actual);
  });
}

export type ProgramMbeProductConfigV1 = {
  schemaVersion: 1;
  /**
   * Identifies which registry templates belong to this program.
   * Defaults to the first available catalog program code unless explicitly set.
   */
  programCode: string;

  /**
   * Templates that are automatically "in force" for the product when applicable.
   * These are used to populate schedule sections (Coverages/Excess/Extensions/Conditions/Extras)
   * and can also drive pricing via ADD_PREMIUM_ROW / ADD_EXCESS effects.
   */
  base: Array<{
    code: string;
    enabled: boolean;
    params?: UnknownRecord;
  }>;

  /**
   * Optional templates that can be toggled by the customer/BO as part of quote flow.
   * If `enabledByDefault` is true, they are treated as included unless explicitly disabled.
   */
  options: Array<{
    code: string;
    enabledByDefault: boolean;
    params?: UnknownRecord;
  }>;
};

export type ProgramMbeProductConfig = ProgramMbeProductConfigV1;

// Default only for flows that genuinely have no product context at all.
const DEFAULT_PROGRAM_CODE = process.env.DEFAULT_PROGRAM_CODE || 'abbeygate_motor';

function isObject(x: unknown): x is UnknownRecord {
  return Boolean(x) && typeof x === 'object' && !Array.isArray(x);
}

function inferProductTypeFromProgramCode(programCode: string): string | null {
  const raw = String(programCode || '').trim().toLowerCase();
  if (!raw) return null;
  const match = raw.match(/^abbeygate_(.+)$/);
  return match?.[1] ? String(match[1]).toUpperCase() : null;
}

function resolveDefaultProgramCode(args?: {
  productType?: string;
  programCode?: string;
}): string {
  const explicitProgramCode = String(args?.programCode || '').trim();
  const productType = String(args?.productType || '').trim().toLowerCase();
  if (explicitProgramCode) {
    const inferred = inferProductTypeFromProgramCode(explicitProgramCode)?.toLowerCase();
    if (!productType || !inferred || inferred === productType) return explicitProgramCode;
  }
  if (productType) return `abbeygate_${productType}`;
  return DEFAULT_PROGRAM_CODE;
}

function resolveCatalog(opts?: {
  productType?: string;
  programCode?: string;
  catalog?: EndorsementCatalog;
}): EndorsementCatalog {
  if (opts?.catalog) return opts.catalog;
  const productType = String(opts?.productType || '').trim().toUpperCase()
    || inferProductTypeFromProgramCode(String(opts?.programCode || ''))
    || 'MOTOR';
  return MagicBRegistry.forProduct(productType);
}

function buildGenericDefaultProgramMbeProductConfig(args?: {
  productType?: string;
  programCode?: string;
  catalog?: EndorsementCatalog;
}): ProgramMbeProductConfigV1 {
  const catalog = resolveCatalog(args);
  const inferredProgramCode = resolveDefaultProgramCode({
    productType: args?.productType || catalog.productType,
    programCode: args?.programCode,
  });
  const templates = catalog.getAll().filter((t) => String(t.program_code || '').trim() === inferredProgramCode);

  const hasExplicitOptionDefaults = templates.some((t) => typeof asRecord(t.option_defaults).enabledByDefault === 'boolean');

  // Generic rule:
  // - if templates declare option_defaults.enabledByDefault, treat those as base-enabled
  // - otherwise fall back to current rich-template heuristic (mostly Motor)
  const base = templates
    .filter((t) => {
      const explicitDefault = asRecord(t.option_defaults).enabledByDefault;
      if (typeof explicitDefault === 'boolean') return explicitDefault;
      if (t.type === 'WARRANTY' || t.type === 'EXCLUSION' || t.type === 'CONDITION' || t.type === 'SECURITY' || t.type === 'PROTECTION') {
        return true;
      }
      if (!hasExplicitOptionDefaults && (t.type === 'COVERAGE' || t.code === 'ABG001')) {
        return true;
      }
      return false;
    })
    .map((t) => ({ code: t.code, enabled: true, params: {} }));

  const baseCodes = new Set(base.map((t) => t.code));
  const options = templates
    .filter((t) => !baseCodes.has(String(t.code || '').trim()))
    .map((t) => ({
      code: t.code,
      enabledByDefault: Boolean(asRecord(t.option_defaults).enabledByDefault),
      params: {},
    }));

  return { schemaVersion: 1, programCode: inferredProgramCode, base, options };
}

export function buildDefaultProgramMbeProductConfig(
  programCodeOrArgs: string | { productType?: string; programCode?: string; catalog?: EndorsementCatalog } = DEFAULT_PROGRAM_CODE,
): ProgramMbeProductConfigV1 {
  if (typeof programCodeOrArgs === 'string') {
    return buildGenericDefaultProgramMbeProductConfig({ programCode: programCodeOrArgs });
  }
  return buildGenericDefaultProgramMbeProductConfig(programCodeOrArgs);
}

export function normalizeProgramMbeProductConfig(
  raw: unknown,
  opts?: { productType?: string; programCode?: string; catalog?: EndorsementCatalog },
): ProgramMbeProductConfigV1 {
  const resolvedCatalog = resolveCatalog({
    productType: opts?.productType,
    programCode: opts?.programCode,
    catalog: opts?.catalog,
  });
  const fallback = buildGenericDefaultProgramMbeProductConfig({
    productType: opts?.productType,
    programCode: opts?.programCode,
    catalog: resolvedCatalog,
  });
  if (!isObject(raw)) return fallback;

  const schemaVersion = raw.schemaVersion === 1 ? 1 : 1;
  const expectedProgramCode = resolveDefaultProgramCode({ productType: opts?.productType, programCode: opts?.programCode });
  const programCode = typeof raw.programCode === 'string' && raw.programCode.trim()
    ? raw.programCode.trim()
    : resolveDefaultProgramCode({ productType: opts?.productType, programCode: opts?.programCode });
  let base = Array.isArray(raw.base)
    ? raw.base
      .filter((x) => isObject(x) && typeof x.code === 'string')
      .map((x) => ({
        code: String(x.code),
        enabled: Boolean(x.enabled),
        params: isObject(x.params) ? x.params : {},
      }))
    : fallback.base;

  let options = Array.isArray(raw.options)
    ? raw.options
      .filter((x) => isObject(x) && typeof x.code === 'string')
      .map((x) => ({
        code: String(x.code),
        enabledByDefault: Boolean(x.enabledByDefault),
        params: isObject(x.params) ? x.params : {},
      }))
    : fallback.options;

  const validCodes = new Set(
    resolvedCatalog
      .getAll()
      .filter((template) => String(template.program_code || '').trim() === expectedProgramCode)
      .map((template) => String(template.code || '').trim())
      .filter(Boolean),
  );
  const filteredBase = base.filter((entry) => validCodes.has(String(entry.code || '').trim()));
  const filteredOptions = options.filter((entry) => validCodes.has(String(entry.code || '').trim()));

  const rawLooksForeign =
    programCode !== expectedProgramCode ||
    ((base.length > 0 || options.length > 0) && filteredBase.length === 0 && filteredOptions.length === 0);

  if (rawLooksForeign) {
    return fallback;
  }

  base = filteredBase.length > 0 || base.length === 0 ? filteredBase : fallback.base;
  options = filteredOptions.length > 0 || options.length === 0 ? filteredOptions : fallback.options;

  // Reconcile catalog templates introduced AFTER this config was persisted.
  // A stored config would otherwise freeze the catalog at save time: quote
  // resolution iterates cfg.options, so a newly shipped conditional
  // endorsement (e.g. HEALTH-GESY-CLAIMS-CONDITION with a `selectedWhen`
  // rule) would never even be evaluated for existing programs. Missing
  // codes are appended as DISABLED options — never into base and never
  // auto-enabled — which is behaviour-preserving for plain templates while
  // letting quote-time `selectedWhen` rules (read from the catalog, not the
  // stored flag) fire. `getOrInitProgramMbeProductConfig` persists the
  // reconciled shape back, so existing programs self-heal on first read.
  const presentCodes = new Set(
    [...base, ...options].map((entry) => String(entry.code || '').trim()).filter(Boolean),
  );
  for (const code of validCodes) {
    if (!presentCodes.has(code)) {
      options.push({ code, enabledByDefault: false, params: {} });
    }
  }

  return { schemaVersion, programCode, base, options };
}

// Re-export DB-dependent functions from app layer for backward compatibility.
// New code should import directly from mbe/app/programProductRepo.
export { getOrInitProgramMbeProductConfig, saveProgramMbeProductConfig } from '../app/programProductRepo.js';

export type AppliedEndorsementInput = { code: string; params?: UnknownRecord; targetId?: string };
export type ResolvedCoverageSetItem = {
  code: string;
  title: string;
  summary?: string;
  type: EndorsementTemplate['type'];
  scope: EndorsementTemplate['scope'];
  group?: string;
  enabled: boolean;
  selected: boolean;
  source: 'base' | 'option';
  params: UnknownRecord;
  targetId?: string;
};

export type ResolvedCoverageSet = {
  productType: string;
  programCode: string;
  selectedCodes: string[];
  items: ResolvedCoverageSetItem[];
  applied: AppliedEndorsementInput[];
};

/**
 * Resolve which templates are "in force" for a quote based on:
 * - program MBE product config
 * - quoteData toggles (e.g. windscreen enabled/disabled)
 * - template prerequisites (validated against the quote snapshot)
 *
 * Returns objects in the same shape expected by the pricing engine: {code, params}
 */
export function resolveAppliedEndorsementsForQuote(args: {
  quoteData: unknown;
  cfg: ProgramMbeProductConfigV1;
  selectedOptions?: Record<string, boolean>; // code -> enabled
  paramsByCode?: Record<string, unknown>; // code -> param overrides
}): AppliedEndorsementInput[] {
  return resolveCoverageV1({
    quoteData: args.quoteData,
    cfg: args.cfg,
    selectedOptions: args.selectedOptions,
    paramsByCode: args.paramsByCode,
  }).applied;
}

export function resolveCoverageV1(args: {
  productType?: string;
  programCode?: string;
  catalog?: EndorsementCatalog;
  quoteData: unknown;
  cfg: ProgramMbeProductConfigV1;
  selectedOptions?: Record<string, boolean>; // code -> enabled
  paramsByCode?: Record<string, unknown>; // code -> param overrides
}): ResolvedCoverageSet {
  const { quoteData, cfg, selectedOptions, paramsByCode } = args;
  const snapshot = asRecord(quoteData);
  const catalog = resolveCatalog({
    productType: args.productType,
    programCode: args.programCode || cfg.programCode,
    catalog: args.catalog,
  });
  const effectiveSelectedOptions: Record<string, boolean> = {
    ...(selectedOptions || {}),
  };
  // Backward-compatible bridge: if a flow still sends protectNCB at quoteData level
  // and no explicit CV 172 toggle is provided, treat it as the CV 172 selection.
  if (!Object.prototype.hasOwnProperty.call(effectiveSelectedOptions, 'CV 172') && typeof snapshot.protectNCB === 'boolean') {
    effectiveSelectedOptions['CV 172'] = Boolean(snapshot.protectNCB);
  }
  // Normalize into a stable flag surface area for prerequisites.
  // This keeps template logic data-driven without baking template codes into the engine.
  const snapshotForMbe: UnknownRecord = {
    ...(snapshot || {}),
    flags: {
      ...asRecord(snapshot.flags),
      isComprehensive: String(snapshot.coverRequired || '') !== 'Third Party Liability',
      windscreenDisabled: snapshot.windscreenCover === false || snapshot.disableWindscreen === true,
      isMotorbike:
        Boolean(asRecord(snapshot.flags).isMotorbike) ||
        String(snapshot.vehicleType || '').toLowerCase().includes('motorbike') ||
        String(snapshot.vehicleType || '').toLowerCase().includes('motorcycle'),
      classic_car:
        Boolean(asRecord(snapshot.flags).classic_car) ||
        String(snapshot.vehicleType || '').toLowerCase().includes('classic'),
      homeHasBuildings: Number(asRecord(asRecord(snapshot).coverage).buildings || 0) > 0,
      homeHasContents: Number(asRecord(asRecord(snapshot).coverage).contents || 0) > 0,
    },
  };

  const resolvePolicyTermMonths = (s: UnknownRecord): number => {
    const mbeTermMonthsRaw = Number(s?.__mbePolicyTermMonths);
    if (Number.isFinite(mbeTermMonthsRaw) && mbeTermMonthsRaw > 0) return mbeTermMonthsRaw;
    const termMonthsRaw = Number(s?.policyTermMonths);
    if (Number.isFinite(termMonthsRaw) && termMonthsRaw > 0) return termMonthsRaw;
    return String(s?.policyTerm || '').toLowerCase().includes('6') ? 6 : 12;
  };

  const applyComputedParams = (tmpl: EndorsementTemplate, params: UnknownRecord) => {
    const defs = Array.isArray(tmpl.computed_params) ? tmpl.computed_params : [];
    if (!defs.length) return;

    for (const def of defs) {
      if (!def || typeof def !== 'object') continue;
      if (def.type === 'PRO_RATE_BY_POLICY_TERM_MONTHS') {
        const termMonths = resolvePolicyTermMonths(snapshotForMbe);
        const termFactor = termMonths <= 6 ? 0.6 : 1.0;
        const paramName = String(def.param || '').trim();
        if (!paramName) continue;

        const raw = Number(params[paramName]);
        const base = Number.isFinite(raw) ? raw : Number(def.defaultValue) || 0;
        const precision = Number.isFinite(Number(def.precision)) ? Number(def.precision) : 2;
        const pow = Math.pow(10, Math.max(0, precision));
        params[paramName] = Math.round(base * termFactor * pow) / pow;
      }
    }
  };

  const enabledBase = (cfg.base || []).filter((x) => {
    const explicit = effectiveSelectedOptions[x.code];
    const enabled = typeof explicit === 'boolean' ? explicit : Boolean(x.enabled);
    return Boolean(enabled);
  });

  // Determine per-option enablement:
  // - If a caller supplies explicit selectedOptions, respect it
  // - Otherwise fall back to enabledByDefault
  const enabledOptions = (cfg.options || []).filter((opt) => {
    const tmpl = catalog.get(opt.code);
    const explicit = effectiveSelectedOptions[opt.code];
    let enabled: boolean;
    if (typeof explicit === 'boolean') enabled = explicit;
    else if (tmpl && selectedWhenMatches(tmpl, snapshot)) enabled = true;
    else enabled = Boolean(opt.enabledByDefault);
    return Boolean(enabled);
  });

  // Guard against duplicate codes across base/options in legacy metadata.
  // Duplicate application would double-charge ADD_PREMIUM_ROW effects.
  const candidateByCode = new Map<string, { code: string; enabled?: boolean; params?: UnknownRecord }>();
  [...enabledBase, ...enabledOptions].forEach((c) => {
    const code = String(c.code || '').trim();
    if (!code) return;
    candidateByCode.set(code, c);
  });
  const candidates = [...candidateByCode.values()];
  const enabledCodes = candidates.map((c) => String(c.code));
  const out: AppliedEndorsementInput[] = [];

  const items: ResolvedCoverageSetItem[] = [];
  for (const c of candidates) {
    const tmpl = catalog.get(c.code);
    if (!tmpl) continue;
    const explicitParamsForCode = paramsByCode && isObject(paramsByCode[tmpl.code]) ? asRecord(paramsByCode[tmpl.code]) : undefined;
    const hasExplicitExcessAmountOverride =
      Object.prototype.hasOwnProperty.call(c.params || {}, 'excess_amount_eur') ||
      Object.prototype.hasOwnProperty.call(explicitParamsForCode || {}, 'excess_amount_eur');

    // Default params can be overridden by program config
    const params = {
      ...(asRecord(tmpl.default_params) || {}),
      ...(c.params || {}),
      ...(explicitParamsForCode || {}),
    };

    // Dynamic excess amounts for schedule and endorsement accuracy.
    if ((tmpl.code === 'CV 4' || tmpl.code === 'CV 5') && !hasExplicitExcessAmountOverride) {
      const rawExcess = Number(String(snapshot.requiredExcess || '').replace(/[^0-9.]/g, ''));
      if (Number.isFinite(rawExcess) && rawExcess > 0) {
        params.excess_amount_eur = rawExcess;
      }
    }

    // Best-effort applicability: skip templates whose prerequisites don't pass
    // Apply computed params (if any) before validation/pricing.
    applyComputedParams(tmpl, params);

    const validation = MagicBRulesEngine.validate(
      tmpl,
      { policySnapshot: snapshotForMbe, endorsementCode: tmpl.code, params, existingEndorsements: enabledCodes },
      enabledCodes,
      catalog,
    );
    if (!validation.valid) continue;

    const targetId = typeof params.targetId === 'string'
      ? params.targetId
      : typeof params.target_vehicle_id === 'string'
        ? params.target_vehicle_id
        : undefined;
    out.push({ code: tmpl.code, params, targetId });
    items.push({
      code: tmpl.code,
      title: tmpl.title,
      summary: tmpl.summary,
      type: tmpl.type,
      scope: tmpl.scope,
      group: tmpl.ui?.group,
      enabled: true,
      selected: typeof effectiveSelectedOptions[tmpl.code] === 'boolean' ? effectiveSelectedOptions[tmpl.code] : true,
      source: enabledBase.some((x) => String(x.code) === String(tmpl.code)) ? 'base' : 'option',
      params,
      targetId,
    });
  }

  return {
    productType: catalog.productType,
    programCode: String(cfg.programCode || ''),
    selectedCodes: items.map((i) => i.code),
    items,
    applied: out,
  };
}

export type MbeScheduleCoverageRow = { sectionId: string; sectionLabel: string; title: string; limit: string; excess: string };
export type MbeScheduleConditionRow = { code: string; text: string };
export type MbeScheduleAssistance = { provider?: string; tel?: string; restrictions?: string[]; price_eur?: number };
export type MbeSchedulePremiumRow = { itemCode: string; amount: string };

export function buildMagicBSectionsForSchedule(args: {
  quoteData: unknown;
  applied: Array<{ code: string; params?: unknown }>;
}): {
  coverages: MbeScheduleCoverageRow[];
  conditions: MbeScheduleConditionRow[];
  assistance: MbeScheduleAssistance | null;
  premiumRows: MbeSchedulePremiumRow[];
} {
  const snapshot = asRecord(args.quoteData);
  const coverages: MbeScheduleCoverageRow[] = [];
  const conditions: MbeScheduleConditionRow[] = [];
  let assistance: MbeScheduleAssistance | null = null;
  const premiumRows: MbeSchedulePremiumRow[] = [];

  const fmtMoney = (amount: number) =>
    new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

  const mapSectionLabel = (idRaw: unknown) => {
    const id = String(idRaw || '').trim();
    // Customer-facing labels (avoid leaking internal codes).
    if (!id) return '—';
    if (id.startsWith('SECTION_3')) return 'Section 3';
    if (id.startsWith('SECTION_2')) return 'Section 2';
    if (id.startsWith('SECTION_1')) return 'Section 1';
    if (id.startsWith('SECTION_4')) return 'Section 4';
    if (id.startsWith('SECTION_5')) return 'Section 5';
    if (id.startsWith('SECTION_6')) return 'Section 6';
    if (id.startsWith('SECTION_7')) return 'Section 7';
    if (id.startsWith('SECTION_8')) return 'Section 8';
    if (id.startsWith('SECTION_9')) return 'Section 9';
    if (id.startsWith('SECTION_10')) return 'Section 10';
    // Non-section targets (e.g. convertible roof claims)
    if (id.toUpperCase().includes('CONVERTIBLE')) return 'Section 2';
    if (id.toUpperCase().includes('WINDSCREEN')) return 'Section 2';
    return 'As per schedule';
  };

  const motorCatalog = MagicBRegistry.motorOnly();
  for (const a of args.applied || []) {
    const tmpl = motorCatalog.get(a.code);
    if (!tmpl) continue;
    const params = { ...asRecord(tmpl.default_params), ...asRecord(a.params) };

    // Resolve conditionals and flatten effects for this template instance.
    const effects = MagicBRulesEngine.computeCombinedEffects([{ template: tmpl, params }], snapshot) || [];

    effects.forEach((e, idx: number) => {
      if (e.type === 'ADD_COVER') {
        const sectionId = tmpl.section_id || e.section || e.target || tmpl.code;
        const title = tmpl.title;

        // Attempt to render a human-readable limit from known params
        let limit = 'As per schedule';
        if (params.limit_bodily_injury_eur && params.limit_property_damage_eur) {
          limit = `BI: €${Number(params.limit_bodily_injury_eur).toLocaleString()} / PD: €${Number(params.limit_property_damage_eur).toLocaleString()}`;
        } else if (params.max_liability_eur) {
          limit = `€${Number(params.max_liability_eur).toLocaleString()}`;
        } else if (params.cy_limit_eur || params.other_limit_eur) {
          const cy = params.cy_limit_eur ? `CY: €${Number(params.cy_limit_eur).toLocaleString()}` : '';
          const ot = params.other_limit_eur ? `Other: €${Number(params.other_limit_eur).toLocaleString()}` : '';
          limit = [cy, ot].filter(Boolean).join(' / ') || limit;
        }

        // Excess is policy-level; show the required excess field (the schedule template also shows totalExcess elsewhere).
        const excess = snapshot?.requiredExcess ? `€${String(snapshot.requiredExcess).replace(/[^0-9]/g, '')}` : 'Nil';
        coverages.push({ sectionId, sectionLabel: mapSectionLabel(sectionId), title, limit, excess });
      }

      if (e.type === 'ADD_EXCESS') {
        const sectionId = e.target || tmpl.section_id || tmpl.code;
        const title = tmpl.title || String(sectionId);
        const amountKey = String(e.amount_param || '').trim();
        const amount = amountKey && params && params[amountKey] != null ? Number(params[amountKey]) : Number(asRecord(e).amount || 0);
        const excess = Number.isFinite(amount) && amount > 0 ? `€${amount.toLocaleString()}` : 'As per schedule';
        coverages.push({ sectionId, sectionLabel: mapSectionLabel(sectionId), title, limit: '—', excess });
      }

      if (e.type === 'ADD_RESTRICTION') {
        const text = String(e.text || '').trim() || String(tmpl.legal_text || '').trim();
        if (text) conditions.push({ code: `${tmpl.code}-${idx + 1}`, text });
      }

      if (e.type === 'ADD_WARRANTY') {
        const text = String(e.text || '').trim() || String(tmpl.legal_text || '').trim();
        if (text) conditions.push({ code: `${tmpl.code}-${idx + 1}`, text });
      }

      if (e.type === 'ADD_PREMIUM_ROW') {
        const pm = 'params_map' in e ? asRecord((e as { params_map?: unknown }).params_map) : {};
        const rawItem = pm.item_name;
        const rawAmount = pm.amount;
        const itemCode =
          typeof rawItem === 'string'
            ? (params && params[rawItem] != null ? String(params[rawItem]) : String(rawItem))
            : String(tmpl.title || tmpl.code);
        const amountVal =
          typeof rawAmount === 'string' && params && params[rawAmount] != null ? Number(params[rawAmount]) : Number(rawAmount);
        if (itemCode && Number.isFinite(amountVal) && amountVal !== 0) {
          premiumRows.push({ itemCode, amount: fmtMoney(amountVal) });
        }
      }

      if (e.type === 'ASSISTANCE_ATTACH' || tmpl.type === 'ASSISTANCE') {
        // Support template-driven assistance blocks when present.
        assistance = assistance || {};
        if (params.provider) assistance.provider = String(params.provider);
        if (params.tel) assistance.tel = String(params.tel);
        if (Array.isArray(params.restrictions)) assistance.restrictions = params.restrictions.map(String);
        if (Number.isFinite(Number(params.price_eur))) assistance.price_eur = Number(params.price_eur);
      }
    });
  }

  return { coverages, conditions, assistance, premiumRows };
}


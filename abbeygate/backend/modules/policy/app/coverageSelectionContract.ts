import { parseRecord } from '../../../platform/json/parseRecord.js';
import {
  normalizeProgramMbeProductConfig,
  resolveCoverageV1,
  type AppliedEndorsementInput,
  type ResolvedCoverageSet,
  type ProgramMbeProductConfigV1,
} from '../../mbe/domain/programProduct.js';

export type CoverageSelectionParams = Record<string, unknown>;
export type CoverageSelectionMap = Record<string, boolean>;

export type CoverageSelectionSnapshot = {
  schemaVersion: 1;
  programId: string | null;
  programCode: string | null;
  selected: CoverageSelectionMap;
  params: Record<string, CoverageSelectionParams>;
  source?: string;
  updatedAt?: string;
  requiresProgram?: boolean;
  bo_initialized?: boolean;
};

export type TruthfulCoverageContract = CoverageSelectionSnapshot & {
  defaults: {
    selected: CoverageSelectionMap;
    params: Record<string, CoverageSelectionParams>;
  };
  resolvedCoverageSet: ResolvedCoverageSet;
};

function toBooleanRecord(value: unknown): Record<string, boolean> {
  const rec = parseRecord(value);
  const out: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(rec)) {
    out[key] = Boolean(entry);
  }
  return out;
}

export function parseCoverageSelectionSnapshot(value: unknown): CoverageSelectionSnapshot {
  const rec = parseRecord(value);
  const paramsRaw = parseRecord(rec.params);
  const params: Record<string, CoverageSelectionParams> = {};
  for (const [code, entry] of Object.entries(paramsRaw)) {
    params[code] = parseRecord(entry);
  }
  return {
    schemaVersion: 1,
    programId: typeof rec.programId === 'string' && rec.programId.trim() ? rec.programId.trim() : null,
    programCode: typeof rec.programCode === 'string' && rec.programCode.trim() ? rec.programCode.trim() : null,
    selected: toBooleanRecord(rec.selected),
    params,
    source: typeof rec.source === 'string' && rec.source.trim() ? rec.source.trim() : undefined,
    updatedAt: typeof rec.updatedAt === 'string' && rec.updatedAt.trim() ? rec.updatedAt.trim() : undefined,
    requiresProgram: rec.requiresProgram === true ? true : undefined,
    bo_initialized: rec.bo_initialized === true ? true : undefined,
  };
}

export function normalizeCoverageSelectionSnapshot(args: {
  value: unknown;
  programId: string | null;
  programCode: string | null;
  allowedCodes?: Iterable<string>;
  source?: string;
  updatedAt?: string;
  requiresProgram?: boolean;
  boInitialized?: boolean;
}): CoverageSelectionSnapshot {
  const parsed = parseCoverageSelectionSnapshot(args.value);
  const allowedCodes = args.allowedCodes ? new Set(Array.from(args.allowedCodes, (code) => String(code || '').trim()).filter(Boolean)) : null;
  const incomingProgramId = String(parsed.programId || '').trim();
  const programCompatible = !args.programId || !incomingProgramId || incomingProgramId === args.programId;
  const selected: CoverageSelectionMap = {};
  const params: Record<string, CoverageSelectionParams> = {};
  const selectedSource = programCompatible ? parsed.selected : {};
  const paramsSource = programCompatible ? parsed.params : {};

  const selectedCodes = allowedCodes ? Array.from(allowedCodes) : Object.keys(selectedSource);
  for (const code of selectedCodes) {
    if (Object.prototype.hasOwnProperty.call(selectedSource, code)) {
      selected[code] = Boolean(selectedSource[code]);
    }
  }

  const paramCodes = allowedCodes ? Array.from(allowedCodes) : Object.keys(paramsSource);
  for (const code of paramCodes) {
    if (Object.prototype.hasOwnProperty.call(paramsSource, code)) {
      params[code] = parseRecord(paramsSource[code]);
    }
  }

  return {
    schemaVersion: 1,
    programId: args.programId,
    programCode: args.programCode,
    selected,
    params,
    source: args.source || parsed.source,
    updatedAt: args.updatedAt || parsed.updatedAt,
    requiresProgram: args.requiresProgram === true ? true : undefined,
    bo_initialized: args.boInitialized === true ? true : parsed.bo_initialized === true ? true : undefined,
  };
}

export function getCoverageAllowedCodes(cfg: ProgramMbeProductConfigV1): string[] {
  const codes = new Set<string>();
  for (const item of cfg.base || []) {
    const code = String(item.code || '').trim();
    if (code) codes.add(code);
  }
  for (const item of cfg.options || []) {
    const code = String(item.code || '').trim();
    if (code) codes.add(code);
  }
  return [...codes];
}

function buildInitialParamsMap(cfg: ProgramMbeProductConfigV1): Record<string, CoverageSelectionParams> {
  const out: Record<string, CoverageSelectionParams> = {};
  for (const item of [...(cfg.base || []), ...(cfg.options || [])]) {
    const code = String(item.code || '').trim();
    if (!code) continue;
    out[code] = parseRecord(item.params);
  }
  return out;
}

function buildSelectedMap(allowedCodes: string[], applied: AppliedEndorsementInput[]): CoverageSelectionMap {
  const out: CoverageSelectionMap = {};
  const appliedCodes = new Set(applied.map((entry) => String(entry.code || '').trim()).filter(Boolean));
  for (const code of allowedCodes) {
    out[code] = appliedCodes.has(code);
  }
  return out;
}

function hasAnyKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0;
}

export function resolveEffectiveCoverageContract(args: {
  productType?: string;
  quoteData: unknown;
  cfg: ProgramMbeProductConfigV1;
  storedSelection?: unknown;
  programId?: string | null;
  source?: string;
  updatedAt?: string;
  requiresProgram?: boolean;
  boInitialized?: boolean;
}): TruthfulCoverageContract {
  const cfg = normalizeProgramMbeProductConfig(args.cfg, {
    productType: String(args.productType || '').trim().toUpperCase() || undefined,
    programCode: String((args.cfg as ProgramMbeProductConfigV1)?.programCode || '').trim() || undefined,
  });
  const allowedCodes = getCoverageAllowedCodes(cfg);
  const normalizedStored = normalizeCoverageSelectionSnapshot({
    value: args.storedSelection,
    programId: args.programId ?? null,
    programCode: cfg.programCode,
    allowedCodes,
    source: args.source,
    updatedAt: args.updatedAt,
    requiresProgram: args.requiresProgram,
    boInitialized: args.boInitialized,
  });

  const productType = String(args.productType || '').trim().toUpperCase() || undefined;
  const defaultsResolved = resolveCoverageV1({
    productType,
    quoteData: args.quoteData,
    cfg,
  });
  const resolvedCoverageSet = resolveCoverageV1({
    productType,
    quoteData: args.quoteData,
    cfg,
    selectedOptions: hasAnyKeys(normalizedStored.selected as Record<string, unknown>) ? normalizedStored.selected : undefined,
    paramsByCode: hasAnyKeys(normalizedStored.params) ? normalizedStored.params : undefined,
  });

  const defaultsParams = buildInitialParamsMap(cfg);
  for (const entry of defaultsResolved.applied) {
    const code = String(entry.code || '').trim();
    if (!code) continue;
    defaultsParams[code] = parseRecord(entry.params);
  }

  return {
    ...normalizedStored,
    defaults: {
      selected: buildSelectedMap(allowedCodes, defaultsResolved.applied),
      params: defaultsParams,
    },
    resolvedCoverageSet,
  };
}

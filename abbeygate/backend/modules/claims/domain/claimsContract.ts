import { z } from 'zod';
import { ProductRegistry } from '../../policy/domain/ProductRegistry.js';

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};

const asString = (value: unknown): string => String(value ?? '').trim();

const isObject = (value: unknown): value is UnknownRecord =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const claimFieldTypeSchema = z.enum(['text', 'date', 'select', 'textarea', 'checkbox']);
const claimFieldModeSchema = z.enum(['locked', 'editable_prefilled', 'blank_required', 'blank_optional', 'derived']);

const fnolIncidentTypeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  thirdPartyStep: z.boolean().optional().default(false),
});

const fullClaimFieldSchema = z.object({
  fieldId: z.string().min(1),
  section: z.string().min(1),
  label: z.string().min(1),
  type: claimFieldTypeSchema,
  mode: claimFieldModeSchema,
  required: z.boolean().optional().default(false),
  valueSource: z.enum(['policy', 'fnol', 'user', 'derived']).optional().default('user'),
  prefillPath: z.string().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional().default([]),
  visibility: z.string().optional(),
  validation: z.string().optional(),
  riskSignals: z.string().optional(),
});

const claimsContractSchema = z.object({
  version: z.number().int().min(1).default(1),
  productType: z.string(),
  fnol: z.object({
    incidentTypes: z.array(fnolIncidentTypeSchema).default([]),
    thirdPartyKinds: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })).default([]),
    rules: z
      .object({
        minDescriptionLength: z.number().int().min(1).default(10),
        allowedCountries: z.array(z.string().min(1)).default([]),
        requiresThirdPartyFor: z.array(z.string().min(1)).default([]),
        requiresPoliceFor: z.array(z.string().min(1)).default([]),
      })
      .default(() => ({
        minDescriptionLength: 10,
        allowedCountries: [],
        requiresThirdPartyFor: [],
        requiresPoliceFor: [],
      })),
  }),
  fullClaimForm: z.object({
    fields: z.array(fullClaimFieldSchema).default([]),
    source: z.enum(['metadata', 'external_spec']).optional().default('metadata'),
  }),
});

export type ClaimsContract = z.infer<typeof claimsContractSchema>;
export type ClaimContractField = z.infer<typeof fullClaimFieldSchema>;

const emptyClaimsContract: ClaimsContract = {
  version: 1,
  productType: 'UNKNOWN',
  fnol: {
    incidentTypes: [],
    thirdPartyKinds: [],
    rules: {
      minDescriptionLength: 10,
      allowedCountries: [],
      requiresThirdPartyFor: [],
      requiresPoliceFor: [],
    },
  },
  fullClaimForm: {
    fields: [],
    source: 'external_spec',
  },
};

function normalizeVisibilityToken(raw: string): string {
  const t = String(raw || '').trim().toLowerCase();
  if (!t) return '';
  if (t.includes('all')) return 'all';
  if (t.includes('collision')) return 'collision';
  if (t.includes('single')) return 'single_vehicle';
  if (t.includes('theft')) return 'theft';
  if (t.includes('fire')) return 'fire';
  if (t.includes('vandal')) return 'vandalism';
  if (t.includes('wind') || t.includes('glass')) return 'windscreen';
  if (t.includes('weather')) return 'weather';
  if (t.includes('parked')) return 'damage_parked';
  if (t.includes('other')) return 'other';
  return t.replace(/\s+/g, '_');
}

export function visibilityMatchesIncident(visibilityRaw: string | undefined, incidentTypeRaw: string): boolean {
  const visibility = asString(visibilityRaw);
  if (!visibility) return true;
  const incidentType = normalizeVisibilityToken(incidentTypeRaw);
  const tokens = visibility
    .split(/[,/|]/g)
    .map((s) => normalizeVisibilityToken(s))
    .filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.includes('all')) return true;
  if (tokens.includes(incidentType)) return true;
  if (incidentType === 'collision' && tokens.some((t) => t.includes('vehicle') || t.includes('third_party'))) return true;
  return false;
}

export function resolveClaimsContractFromProgram(args: {
  productType?: unknown;
  programMetadata?: unknown;
}): ClaimsContract {
  const productType = asString(args.productType || '').toUpperCase();
  const metadata = asRecord(args.programMetadata);
  const claimsConfig = metadata.claimsConfig;
  const adapter = productType ? ProductRegistry.getInstance().getAdapter(productType) : null;
  const defaultContract = adapter?.getDefaultClaimsContract() ?? emptyClaimsContract;
  const base = {
    ...defaultContract,
    productType: productType || defaultContract.productType,
  };
  const parsed = claimsContractSchema.safeParse({
    ...(isObject(claimsConfig) ? claimsConfig : {}),
    productType: base.productType,
  });
  if (!parsed.success) return base;
  return {
    ...base,
    ...parsed.data,
    fnol: {
      ...base.fnol,
      ...parsed.data.fnol,
      rules: {
        ...base.fnol.rules,
        ...parsed.data.fnol.rules,
      },
      incidentTypes: parsed.data.fnol.incidentTypes.length ? parsed.data.fnol.incidentTypes : base.fnol.incidentTypes,
      thirdPartyKinds: parsed.data.fnol.thirdPartyKinds.length ? parsed.data.fnol.thirdPartyKinds : base.fnol.thirdPartyKinds,
    },
    fullClaimForm: {
      ...base.fullClaimForm,
      ...parsed.data.fullClaimForm,
    },
  };
}

function readPrefillFromPath(path: string, snapshot: { policy: UnknownRecord; fnol: UnknownRecord }): unknown {
  const key = asString(path);
  if (!key) return null;
  const source =
    key.startsWith('policy.')
      ? snapshot.policy
      : key.startsWith('fnol.')
        ? snapshot.fnol
        : null;
  if (!source) return null;
  const parts = key.replace(/^policy\./, '').replace(/^fnol\./, '').split('.').filter(Boolean);
  let current: unknown = source;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
    current = (current as UnknownRecord)[part];
  }
  return current ?? null;
}

export function buildContractClaimFormFields(args: {
  contract: ClaimsContract;
  incidentType: string;
  policySnapshot: UnknownRecord;
  fnolSnapshot: UnknownRecord;
}): Array<{
  fieldId: string;
  section: string;
  label: string;
  type: 'text' | 'date' | 'select' | 'textarea' | 'checkbox';
  mode: 'locked' | 'editable_prefilled' | 'blank_required' | 'blank_optional' | 'derived';
  required: boolean;
  valueSource: 'policy' | 'fnol' | 'user' | 'derived';
  prefill?: string | boolean | null;
  options?: Array<{ value: string; label: string }>;
  visibility?: string;
  validation?: string;
  riskSignals?: string;
}> {
  const snapshot = {
    policy: asRecord(args.policySnapshot),
    fnol: asRecord(args.fnolSnapshot),
  };
  return (args.contract.fullClaimForm.fields || [])
    .filter((field) => visibilityMatchesIncident(field.visibility, args.incidentType))
    .map((field) => {
      const prefillValue = field.prefillPath ? readPrefillFromPath(field.prefillPath, snapshot) : null;
      return {
        fieldId: field.fieldId,
        section: field.section,
        label: field.label,
        type: field.type,
        mode: field.mode,
        required: Boolean(field.required),
        valueSource: field.valueSource,
        prefill: prefillValue === null ? null : (prefillValue as string | boolean),
        options: field.options?.length ? field.options : undefined,
        visibility: field.visibility,
        validation: field.validation,
        riskSignals: field.riskSignals,
      };
    });
}


import { z } from 'zod';
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

export class ClaimsProgrammeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaimsProgrammeConfigurationError';
  }
}

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

/**
 * Resolves the claims behaviour published in the programme questionnaire
 * component. Programme-specific claim rules are not product defaults and may
 * not be reconstructed from Program.metadata.
 */
export function resolveClaimsContractFromProgram(args: {
  productType?: unknown;
  programmeQuestionnaire?: unknown;
}): ClaimsContract {
  const productType = asString(args.productType || '').toUpperCase();
  if (!productType) throw new ClaimsProgrammeConfigurationError('Claims contract requires a product type.');
  const questionnaire = asRecord(args.programmeQuestionnaire);
  const claimsContract = questionnaire.claimsContract;
  if (!isObject(claimsContract)) {
    throw new ClaimsProgrammeConfigurationError(
      `Published ${productType} programme questionnaire requires claimsContract.`,
    );
  }
  const parsed = claimsContractSchema.safeParse({ ...claimsContract, productType });
  if (!parsed.success) {
    throw new ClaimsProgrammeConfigurationError(
      `Published ${productType} programme claimsContract is invalid: ${parsed.error.issues[0]?.message || 'unknown error'}.`,
    );
  }
  return parsed.data;
}

/** Validate claims configuration while a programme definition is published. */
export function validateClaimsProgrammeQuestionnaire(args: {
  productType: unknown;
  questionnaire: unknown;
}): void {
  resolveClaimsContractFromProgram({
    productType: args.productType,
    programmeQuestionnaire: args.questionnaire,
  });
}

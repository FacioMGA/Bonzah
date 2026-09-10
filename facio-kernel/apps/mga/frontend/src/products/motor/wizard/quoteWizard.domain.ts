import type { QuoteData, QuoteResponse } from './types';
import { initialQuoteData } from './quoteWizard.constants';

type UnknownRecord = Record<string, unknown>;

export type MissingIssuedField = { slug: string; label: string; customerHash?: string };
export type ConditionalRequirement = { code: string; message: string; severity?: 'BLOCK' | 'WARN' };

export type PublicSessionApiResponse = {
  success?: boolean;
  data?: {
    snapshot?: {
      quoteData?: unknown;
      quoteResponse?: unknown;
    };
    quoteData?: unknown;
    quoteResponse?: unknown;
  };
};

export const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};

export const asQuoteData = (value: unknown): QuoteData => ({ ...initialQuoteData, ...asRecord(value) });
export const serializeQuoteInputs = (value: QuoteData): string => JSON.stringify(value);

export const extractMissingIssuedFields = (readiness: unknown): MissingIssuedField[] => {
  const normalizeMissing = (items: unknown[]): MissingIssuedField[] =>
    items
      .map((m) => {
        const r = asRecord(m);
        const slug = String(r.slug || '').trim();
        return {
          slug,
          label: String(r.label || r.message || slug).trim(),
          customerHash: String(r.customerHash || '').trim() || undefined,
        };
      })
      .filter((m) => m.slug && m.label);

  const data = asRecord(readiness);
  const topLevelMissing = Array.isArray(data.missingFields) ? data.missingFields : [];
  if (topLevelMissing.length > 0) {
    return normalizeMissing(topLevelMissing);
  }
  const blockers = Array.isArray(data.blockers) ? data.blockers : [];
  for (const b of blockers) {
    const blocker = asRecord(b);
    const code = String(blocker.code || '');
    if (code !== 'DOCUMENT_FIELDS_MISSING' && code !== 'QUOTE_DATA_INVALID') continue;
    const details = asRecord(blocker.details);
    const missing = Array.isArray(details.missingFields)
      ? details.missingFields
      : Array.isArray(details.missingForIssuedPack)
        ? details.missingForIssuedPack
        : Array.isArray(details.schemaIssues)
          ? details.schemaIssues
          : Array.isArray(details.blockingErrors)
            ? details.blockingErrors
            : Array.isArray(details.missingSlugs)
              ? details.missingSlugs.map((slug) => ({ slug, label: String(slug) }))
              : [];
    return normalizeMissing(missing);
  }
  return [];
};

export const extractConditionalRequirements = (readiness: unknown): ConditionalRequirement[] => {
  const data = asRecord(readiness);
  const topLevel = Array.isArray(data.conditionalRequirements) ? data.conditionalRequirements : [];
  if (topLevel.length > 0) {
    return topLevel
      .map((entry) => {
        const req = asRecord(entry);
        const mapped: ConditionalRequirement = {
          code: String(req.code || '').trim(),
          message: String(req.message || '').trim(),
          severity: String(req.severity || '').trim() === 'WARN' ? 'WARN' : 'BLOCK',
        };
        return mapped;
      })
      .filter((entry) => entry.code && entry.message);
  }

  const blockers = Array.isArray(data.blockers) ? data.blockers : [];
  for (const b of blockers) {
    const blocker = asRecord(b);
    if (String(blocker.code || '') !== 'CONDITIONAL_REQUIREMENTS_UNMET') continue;
    const details = asRecord(blocker.details);
    const rows = Array.isArray(details.conditionalRequirements) ? details.conditionalRequirements : [];
    return rows
      .map((entry) => {
        const req = asRecord(entry);
        const mapped: ConditionalRequirement = {
          code: String(req.code || '').trim(),
          message: String(req.message || '').trim(),
          severity: String(req.severity || '').trim() === 'WARN' ? 'WARN' : 'BLOCK',
        };
        return mapped;
      })
      .filter((entry) => entry.code && entry.message);
  }
  return [];
};

export const isQuoteResponse = (value: unknown): value is QuoteResponse => {
  const v = asRecord(value);
  return (
    typeof v.reference === 'string' &&
    typeof v.currency === 'string' &&
    Array.isArray(v.alternatives) &&
    typeof v.status === 'string' &&
    Boolean(v.primaryOption && typeof v.primaryOption === 'object')
  );
};

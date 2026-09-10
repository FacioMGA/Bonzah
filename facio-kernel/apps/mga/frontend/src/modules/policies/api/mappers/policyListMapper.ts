import { asRecord } from '@/src/shared/lib/record';
type PolicyListError = {
  code?: string;
  message?: string;
};

type PolicyHolderContact = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
};

type PolicyHolderInfo = {
  name?: string;
  contact?: PolicyHolderContact;
};

export type PolicyReferralField = {
  key: string;
  answer?: string | null;
};

export type PolicyReferralTrigger = {
  code?: string;
  message?: string;
  explanation?: string;
  fields: string[];
};

export type PolicyReferralSummary = {
  outcome?: string | null;
  lane?: string | null;
  triggerCount?: number;
  reason?: string;
  explanation?: string | null;
  triggers: PolicyReferralTrigger[];
  fields: PolicyReferralField[];
  clientLink?: string | null;
};

export type PolicyListRecord = {
  id: string;
  policyId?: string;
  policyNumber?: string;
  productType?: string;
  segment?: string;
  insuredName?: string;
  insuredDisplay?: string;
  vehicleDisplay?: string;
  policyholderDisplay?: string;
  policyholderEmail?: string;
  policyholderPhone?: string;
  name?: string;
  status?: string;
  bo_status?: string | null;
  statusSortRank?: number | null;
  bo_statusSortRank?: number | null;
  startDate?: string;
  coverageStart?: string;
  inceptionDate?: string;
  endDate?: string;
  coverageEnd?: string;
  expiryDate?: string;
  createdAt?: string;
  updatedAt?: string;
  premium?: number;
  totalPremium?: number;
  renewalDate?: string;
  quoteExpiryDate?: string;
  cancellationPending?: boolean;
  customerActionRequired?: boolean;
  uwActionRequired?: boolean;
  vehicleInfo?: unknown;
  quoteData?: unknown;
  policyHolder?: PolicyHolderInfo;
  referralSummary?: PolicyReferralSummary | null;
};

export type PolicyListMappedResponse = {
  success: boolean;
  data: PolicyListRecord[];
  error?: PolicyListError;
  pagination?: unknown;
};

function toStringOrUndefined(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function toNumberOrUndefined(value: unknown): number | undefined {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
}

function toNullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return toNumberOrUndefined(value);
}

function toBooleanOrUndefined(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  return undefined;
}

function toPolicyHolderInfo(value: unknown): PolicyHolderInfo | undefined {
  const holder = asRecord(value);
  if (Object.keys(holder).length === 0) return undefined;
  const contactRaw = holder.contact;
  const contact = (() => {
    if (typeof contactRaw === 'string') {
      try {
        return asRecord(JSON.parse(contactRaw));
      } catch {
        return {};
      }
    }
    return asRecord(contactRaw);
  })();
  const mappedContact: PolicyHolderContact = {
    firstName: toStringOrUndefined(contact.firstName),
    lastName: toStringOrUndefined(contact.lastName),
    email: toStringOrUndefined(contact.email),
    phone: toStringOrUndefined(contact.phone),
  };
  return {
    name: toStringOrUndefined(holder.name),
    contact: Object.values(mappedContact).some(Boolean) ? mappedContact : undefined,
  };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => toStringOrUndefined(item)).filter((item): item is string => Boolean(item))
    : [];
}

function toReferralSummary(value: unknown): PolicyReferralSummary | null {
  const summary = asRecord(value);
  if (Object.keys(summary).length === 0) return null;
  const triggers = Array.isArray(summary.triggers)
    ? summary.triggers.map((trigger) => {
      const rec = asRecord(trigger);
      return {
        code: toStringOrUndefined(rec.code),
        message: toStringOrUndefined(rec.message),
        explanation: toStringOrUndefined(rec.explanation),
        fields: toStringArray(rec.fields),
      };
    })
    : [];
  const fields = Array.isArray(summary.fields)
    ? summary.fields.map((field) => {
      const rec = asRecord(field);
      return {
        key: toStringOrUndefined(rec.key) || '',
        answer: rec.answer === null ? null : toStringOrUndefined(rec.answer),
      };
    }).filter((field) => field.key)
    : [];

  return {
    outcome: summary.outcome === null ? null : toStringOrUndefined(summary.outcome),
    lane: summary.lane === null ? null : toStringOrUndefined(summary.lane),
    triggerCount: toNumberOrUndefined(summary.triggerCount),
    reason: toStringOrUndefined(summary.reason),
    explanation: summary.explanation === null ? null : toStringOrUndefined(summary.explanation),
    triggers,
    fields,
    clientLink: summary.clientLink === null ? null : toStringOrUndefined(summary.clientLink),
  };
}

function mapPolicyListRecord(value: unknown): PolicyListRecord | null {
  const input = asRecord(value);
  const canonicalId =
    toStringOrUndefined(input.policyId)
    || toStringOrUndefined(input.id)
    || toStringOrUndefined(input.policy_id);
  if (!canonicalId) return null;

  return {
    id: canonicalId,
    policyId: toStringOrUndefined(input.policyId) || canonicalId,
    policyNumber: toStringOrUndefined(input.policyNumber),
    productType: toStringOrUndefined(input.productType),
    segment: toStringOrUndefined(input.segment),
    insuredName: toStringOrUndefined(input.insuredName),
    insuredDisplay: toStringOrUndefined(input.insuredDisplay),
    vehicleDisplay: toStringOrUndefined(input.vehicleDisplay),
    policyholderDisplay: toStringOrUndefined(input.policyholderDisplay),
    policyholderEmail: toStringOrUndefined(input.policyholderEmail),
    policyholderPhone: toStringOrUndefined(input.policyholderPhone),
    name: toStringOrUndefined(input.name),
    status: toStringOrUndefined(input.status),
    bo_status: input.bo_status === null ? null : toStringOrUndefined(input.bo_status),
    statusSortRank: toNullableNumber(input.statusSortRank),
    bo_statusSortRank: toNullableNumber(input.bo_statusSortRank),
    startDate: toStringOrUndefined(input.startDate),
    coverageStart: toStringOrUndefined(input.coverageStart),
    inceptionDate: toStringOrUndefined(input.inceptionDate),
    endDate: toStringOrUndefined(input.endDate),
    coverageEnd: toStringOrUndefined(input.coverageEnd),
    expiryDate: toStringOrUndefined(input.expiryDate),
    createdAt: toStringOrUndefined(input.createdAt),
    updatedAt: toStringOrUndefined(input.updatedAt),
    premium: toNumberOrUndefined(input.premium),
    totalPremium: toNumberOrUndefined(input.totalPremium),
    renewalDate: toStringOrUndefined(input.renewalDate),
    quoteExpiryDate: toStringOrUndefined(input.quoteExpiryDate),
    cancellationPending: toBooleanOrUndefined(input.cancellationPending),
    customerActionRequired: toBooleanOrUndefined(input.customerActionRequired),
    uwActionRequired: toBooleanOrUndefined(input.uwActionRequired),
    vehicleInfo: input.vehicleInfo,
    quoteData: input.quoteData,
    policyHolder: toPolicyHolderInfo(input.policyHolder),
    referralSummary: toReferralSummary(input.referralSummary),
  };
}

export function mapPolicyListResponse(raw: unknown): PolicyListMappedResponse {
  const root = asRecord(raw);
  const data = Array.isArray(root.data)
    ? root.data
      .map(mapPolicyListRecord)
      .filter((item): item is PolicyListRecord => Boolean(item))
    : [];
  const errorRecord = asRecord(root.error);
  const error = Object.keys(errorRecord).length
    ? {
      code: toStringOrUndefined(errorRecord.code),
      message: toStringOrUndefined(errorRecord.message),
    }
    : undefined;
  return {
    success: Boolean(root.success),
    data,
    error,
    pagination: root.pagination,
  };
}

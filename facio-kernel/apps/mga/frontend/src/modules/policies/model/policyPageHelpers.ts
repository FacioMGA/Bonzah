import { isPossiblePhoneNumber } from 'react-phone-number-input';
import { REGION_CONFIG } from '@/src/shared/config/region';
import { normalizeSchemaMessageText, validateQuoteData } from '@/src/modules/policies/services/public';
import { ProductRegistry } from '@/src/shared/lib/products';
import {
  normalizePostCodeForCountry,
  validatePostCodeForCountry,
  validateProvinceForCountry,
} from '@facio/products';
import { EMAIL_REGEX } from '@facio/validation';
import type { PolicyUwAnswers } from './policy';
import { asRecord } from '@/src/shared/lib/record';

export type UnknownRecord = Record<string, unknown>;

// Phase 6k: dotted-path setter so policyPage validation can write nested
// `quoteData.proposer.*` (and `proposer.address.*`) values into the
// canonical shape without resurrecting flat-policyholder aliasing.
function setAtPath(source: UnknownRecord, path: string, value: unknown): UnknownRecord {
  const parts = path.split('.').filter(Boolean);
  if (parts.length <= 1) return { ...source, [path]: value };
  const next: UnknownRecord = { ...source };
  let cursor = next;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      cursor[part] = value;
      return;
    }
    const existing = cursor[part];
    const child = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as UnknownRecord) }
      : {};
    cursor[part] = child;
    cursor = child;
  });
  return next;
}

function getAtPath(source: unknown, path: string): unknown {
  if (!source || typeof source !== 'object') return undefined;
  const parts = path.split('.').filter(Boolean);
  let cursor: unknown = source;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

export function parseJsonRecord(value: unknown): UnknownRecord {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return asRecord(value);
}

export const initialUwAnswers: PolicyUwAnswers = {
  agentName: '',
  contactFirstName: '',
  contactLastName: '',
  contactEmail: '',
  contactPhone: '',
  legalInsuredName: '',
  hqAddressLine1: '',
  hqAddressLine2: '',
  city: '',
  state: '',
  zip: '',
  businessType: 'Property Owner',
  managerAuthorized: null,
  yearsInBusiness: '',
  rentsCollectedPct: '',
  renewalRate: '',
  mission: '',
  otherInfo: '',
  productsInterest: [],
  goLiveDate: '',
  offerDepositAlternative: null,
  depositProvider: '',
  offerTll: null,
  tllProvider: '',
  desiredLiabilityLimit: '',
  totalUnits: '',
  unitsSeekingCoverage: '',
  communitiesCount: '',
  vacancyRate: '',
  singleFamilyCount: '',
  multiFamilyCount: '',
  classAPct: '',
  classBPct: '',
  classCPct: '',
  studentPct: '',
  seniorPct: '',
  subsidizedPct: '',
  otherClassPct: '',
  multiState: null,
  portfolioStates: [],
  avgFico: '',
  incomeUnder50kPct: '',
  affordabilityOver30Pct: '',
  furnishedPct: '',
  unfurnishedPct: '',
  concentrationOver20Pct: null,
  minFico: '',
  maxAffordabilityRatio: '',
  minIncomeRule: '',
  verifyFunds: null,
  bondOrDepositOption: null,
  securityDepositRequired: null,
  guarantorsPermitted: null,
  guarantorReplacementPermitted: null,
  guarantorReplacementProvider: '',
  pmSoftware: [],
  defaultProcedures: '',
  evictionProcedures: '',
  damageProcedures: '',
  liabilityClaims3y: null,
  propertyClaims5y: null,
  defaultsCount: '',
  evictionsCount: '',
  damageClaimsCount: '',
  notes: '',
  termsAcceptedAt: '',
  termsVersion: '',
  followUpRequests: [],
  outstandingRequests: [],
  calculationMethod: 'Standard Rate (23% of Limit)',
  premiumRate: 345,
  limitPerOccurrence: '1500',
  aggregateLimit: '10000000',
  policyCurrency: REGION_CONFIG.defaultCurrency,
  endorsementStartDate: '',
  endorsementEndDate: '',
};

export const toISODateOnly = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const parseDateLoose = (input: unknown): Date | undefined => {
  if (!input) return undefined;
  const d = new Date(String(input));
  if (isNaN(d.getTime())) return undefined;
  return d;
};

export const normalizeStatusToken = (input: unknown): string => {
  return String(input || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_');
};

export const isIssuedLifecycleStatus = (input: unknown): boolean => {
  const status = normalizeStatusToken(input);
  return status === 'ACTIVE' || status === 'ISSUED' || status === 'BOUND' || status === 'BOUND_DRAFT_ISSUED';
};

export const isBoundLikeStatus = (input: unknown): boolean => {
  const status = normalizeStatusToken(input);
  return status === 'BOUND' || status === 'BOUND_DRAFT_ISSUED' || status === 'ISSUED' || status === 'ACTIVE';
};

export const isQuoteSubmittedStatus = (input: unknown): boolean => {
  const status = normalizeStatusToken(input);
  return ['QUOTED', 'AWAITING_PAYMENT', 'BOUND', 'BOUND_DRAFT_ISSUED', 'ISSUED', 'ACTIVE'].includes(status);
};

/** Minimal version row shape for endorsement-draft detection while snapshots load. */
export type PolicyVersionRowLike = {
  riskTransactionId?: unknown;
  transactionType?: unknown;
  status?: unknown;
};

export function isEndorsementDraftVersionRow(row: PolicyVersionRowLike | null | undefined): boolean {
  if (!row) return false;
  const ty = normalizeStatusToken(row.transactionType);
  const st = normalizeStatusToken(row.status);
  return ty === 'ENDORSEMENT' && st === 'DRAFT';
}

/**
 * Resolve the active endorsement draft risk transaction id for BO workspace mode.
 * Falls back to the versions list while the snapshot request is still in flight —
 * without this, issued policies stay read-only until snapshot hydration completes.
 */
export function resolveEndorsementDraftRiskTransactionId(args: {
  viewingRiskTransactionId: string | null;
  viewingRiskTransactionSnapshot: UnknownRecord | null;
  policyVersions?: PolicyVersionRowLike[];
}): string | null {
  const viewingId = String(args.viewingRiskTransactionId || '').trim();
  if (!viewingId) return null;

  const snapshot = args.viewingRiskTransactionSnapshot;
  if (snapshot) {
    const snapshotId = String(snapshot.riskTransactionId || '').trim();
    if (snapshotId && snapshotId !== viewingId) return null;
    const ty = normalizeStatusToken(snapshot.transactionType);
    const st = normalizeStatusToken(snapshot.status);
    if (ty === 'ENDORSEMENT' && st === 'DRAFT') return viewingId;
    return null;
  }

  const versionRow = (args.policyVersions || []).find(
    (row) => String(row?.riskTransactionId || '').trim() === viewingId,
  );
  return isEndorsementDraftVersionRow(versionRow) ? viewingId : null;
}

export function buildEndorsementDraftSnapshotStub(riskTransactionId: string): UnknownRecord {
  const id = String(riskTransactionId || '').trim();
  return {
    riskTransactionId: id,
    transactionType: 'ENDORSEMENT',
    status: 'DRAFT',
    snapshot: {},
  };
}

export const calcExpiryDateFromStart = (start: Date): Date => {
  const end = new Date(start);
  end.setFullYear(start.getFullYear() + 1);
  end.setDate(end.getDate() - 1);
  return end;
};

export function normalizePolicyForState(args: {
  policyDataRaw: unknown;
  prevPortfolio: unknown;
}): {
  nextPortfolio: UnknownRecord;
  backendUwData: UnknownRecord;
} {
  const policyData = asRecord(args.policyDataRaw);
  const prevRecord = asRecord(args.prevPortfolio);

  let holderData: UnknownRecord = {};
  let agentFromHolder: string | undefined;
  let agentContactFromHolder: UnknownRecord | undefined;
  const includedPH =
    policyData.policyHolder && typeof policyData.policyHolder === 'object' ? policyData.policyHolder : null;
  if (includedPH) {
    const ph = asRecord(includedPH);
    const phContact = parseJsonRecord(ph.contact);
    agentFromHolder = String(phContact?.agent || phContact?.agentName || '').trim() || undefined;
    agentContactFromHolder = asRecord(phContact?.agentContact);
    holderData = {
      name: ph.name || policyData.name,
      segment: ph.segment || policyData.segment,
      address: ph.address,
      contact: {
        firstName: phContact?.firstName,
        lastName: phContact?.lastName,
        email: phContact?.email,
        phone: phContact?.phone,
      },
    };
  }

  let backendUwData: UnknownRecord = {};
  let vehicleInfo: UnknownRecord = {};
  let driverInfo: UnknownRecord = {};
  let quoteData: UnknownRecord = {};
  let quoteResponse: UnknownRecord = {};

  vehicleInfo = parseJsonRecord(policyData.vehicleInfo);
  driverInfo = parseJsonRecord(policyData.driverInfo);
  quoteData = parseJsonRecord(policyData.quoteData);
  quoteResponse = parseJsonRecord(policyData.quoteResponse);

  let dateOverrides: UnknownRecord = {};
  if (policyData.inceptionDate && policyData.expiryDate) {
    dateOverrides = {
      start: toISODateOnly(new Date(String(policyData.inceptionDate))),
      end: toISODateOnly(new Date(String(policyData.expiryDate))),
      inceptionDate: new Date(String(policyData.inceptionDate)),
      expiryDate: new Date(String(policyData.expiryDate)),
    };
  }

  return {
    nextPortfolio: {
      ...prevRecord,
      ...policyData,
      isNew: false,
      ...holderData,
      ...dateOverrides,
      productType: (policyData as { productType?: string })?.productType || prevRecord.productType || null,
      vehicleInfo,
      driverInfo,
      quoteData,
      quoteResponse,
      agent: agentFromHolder || policyData.agent || prevRecord.agent,
      agentContact:
        agentContactFromHolder ||
        asRecord(asRecord(backendUwData?.propertyInfo).agentContact) ||
        prevRecord.agentContact ||
        {},
    },
    backendUwData,
  };
}

export function parsePercentMaybe(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const n = Number(raw.replace('%', '').trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

export function parseNumberMaybe(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

export function validatePolicyField(
  field: string,
  value: string,
  portfolio: unknown,
  previousErrors: Record<string, string>,
): Record<string, string> {
  const nameRegex = /^[a-zA-Z\s\-']{2,50}$/;
  const errors = { ...previousErrors };
  const portfolioRecord = asRecord(portfolio);
  const statusUpper = String(portfolioRecord.status || '').toUpperCase();
  const productType = String(portfolioRecord.productType || '').trim().toUpperCase();
  const draftRequiredness = validateQuoteData({
    data: asRecord(portfolioRecord.quoteData),
    productType,
    actor: 'underwriter',
    stage: 'draft',
    mode: 'save',
    programId: String(portfolioRecord.programId || ''),
  });
  const requiredDraftSet = new Set(Object.keys(draftRequiredness.fieldErrors).map((key) => key.replace(/^quoteData\./, '')));
  const stage = ((): 'draft' | 'pricing' | 'quote' | 'bind' => {
    if (['BOUND', 'ISSUED', 'ACTIVE', 'CANCELLED', 'EXPIRED'].includes(statusUpper)) return 'bind';
    if (['QUOTED', 'AWAITING_PAYMENT', 'REFERRAL', 'INFO_REQUIRED'].includes(statusUpper)) return 'quote';
    if (['DRAFT', 'INTAKE'].includes(statusUpper)) return 'draft';
    return 'pricing';
  })();
  // Product-level quote validation fires whenever a manifest is registered for
  // the portfolio's productType. Shared validateQuoteData delegates to the
  // product's schema under the hood.
  if (String(field || '').startsWith('quoteData.') && ProductRegistry.has(String(portfolioRecord.productType || ''))) {
    const key = String(field || '').replace(/^quoteData\./, '');
    const quoteData = asRecord(portfolioRecord.quoteData);
    // Phase 6k: write nested values via setAtPath so dotted policyholder paths
    // like `proposer.firstName` materialize into the canonical shape rather
    // than as flat `'proposer.firstName'` keys.
    const validation = validateQuoteData({
      data: setAtPath(quoteData, key, value),
      productType,
      actor: 'underwriter',
      stage,
      mode: 'blur',
      focusField: key,
      programId: String(portfolioRecord.programId || ''),
    });
    const next = { ...errors };
    const err = validation.fieldErrors[key];
    if (err?.message) next[field] = err.message;
    else delete next[field];
    return next;
  }

  switch (field) {
    case 'name':
      if (!value?.trim() || value.length < 2) errors.name = 'Legal Entity Name must be at least 2 characters';
      else delete errors.name;
      break;
    case 'address':
      if (!value?.trim() || value.length < 5) errors.address = 'Please enter a valid full address';
      else delete errors.address;
      break;
    case 'contact.firstName':
      if (!value?.trim()) errors['contact.firstName'] = 'First Name is required';
      else if (!nameRegex.test(value)) errors['contact.firstName'] = 'Enter a valid name (letters only)';
      else delete errors['contact.firstName'];
      break;
    case 'contact.lastName':
      if (!value?.trim()) errors['contact.lastName'] = 'Last Name is required';
      else if (!nameRegex.test(value)) errors['contact.lastName'] = 'Enter a valid name (letters only)';
      else delete errors['contact.lastName'];
      break;
    case 'contact.phone':
      if (!value?.trim()) errors['contact.phone'] = 'Phone number is required';
      else if (!isPossiblePhoneNumber(value || '')) errors['contact.phone'] = 'Enter a valid phone number';
      else delete errors['contact.phone'];
      break;
    case 'contact.email':
      if (!value?.trim()) errors['contact.email'] = 'Email is required';
      else if (!EMAIL_REGEX.test(value || '')) errors['contact.email'] = 'Enter a valid email address';
      else delete errors['contact.email'];
      break;
    case 'quoteData.proposer.firstName':
      if (!value?.trim()) errors['quoteData.proposer.firstName'] = 'First Name is required';
      else if (!nameRegex.test(value)) errors['quoteData.proposer.firstName'] = 'Enter a valid name (letters only)';
      else delete errors['quoteData.proposer.firstName'];
      break;
    case 'quoteData.proposer.lastName':
      if (!value?.trim()) errors['quoteData.proposer.lastName'] = 'Last Name is required';
      else if (!nameRegex.test(value)) errors['quoteData.proposer.lastName'] = 'Enter a valid name (letters only)';
      else delete errors['quoteData.proposer.lastName'];
      break;
    case 'quoteData.proposer.dateOfBirth': {
      const v = String(value || '').trim();
      if (!v) {
        errors['quoteData.proposer.dateOfBirth'] = 'Date of Birth is required';
        break;
      }
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        errors['quoteData.proposer.dateOfBirth'] = 'Enter a valid date';
        break;
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      d.setHours(0, 0, 0, 0);
      if (d > today) {
        errors['quoteData.proposer.dateOfBirth'] = 'Date of Birth cannot be in the future';
        break;
      }
      const age = today.getFullYear() - d.getFullYear();
      const monthDiff = today.getMonth() - d.getMonth();
      const actualAge = monthDiff < 0 || (monthDiff === 0 && today.getDate() < d.getDate()) ? age - 1 : age;
      if (actualAge < 18) {
        errors['quoteData.proposer.dateOfBirth'] = 'Insured must be at least 18 years old';
        break;
      }
      delete errors['quoteData.proposer.dateOfBirth'];
      break;
    }
    case 'quoteData.proposer.address.line1':
      if (!value?.trim() || String(value).trim().length < 3) errors['quoteData.proposer.address.line1'] = 'Address Line is required';
      else delete errors['quoteData.proposer.address.line1'];
      break;
    case 'quoteData.proposer.address.city':
      if (!value?.trim()) errors['quoteData.proposer.address.city'] = 'City is required';
      else delete errors['quoteData.proposer.address.city'];
      break;
    case 'quoteData.proposer.address.province': {
      const addr = asRecord(getAtPath(asRecord(portfolio).quoteData, 'proposer.address'));
      const country = String(addr.country || '');
      const province = String(value || '').trim();
      const shouldValidate = requiredDraftSet.has('proposer.address.province') || Boolean(province);
      if (!shouldValidate) {
        delete errors['quoteData.proposer.address.province'];
      } else {
        const provinceErr = validateProvinceForCountry(province, country);
        if (provinceErr) errors['quoteData.proposer.address.province'] = provinceErr;
        else delete errors['quoteData.proposer.address.province'];
      }
      break;
    }
    case 'quoteData.proposer.address.postcode': {
      const addr = asRecord(getAtPath(asRecord(portfolio).quoteData, 'proposer.address'));
      const country = String(addr.country || '');
      const postCode = String(value || '').trim();
      const shouldValidate = requiredDraftSet.has('proposer.address.postcode') || Boolean(postCode);
      if (!shouldValidate) {
        delete errors['quoteData.proposer.address.postcode'];
      } else {
        const normalizedPostCode = normalizePostCodeForCountry(postCode, country);
        const postCodeErr = validatePostCodeForCountry(normalizedPostCode, country);
        if (postCodeErr) errors['quoteData.proposer.address.postcode'] = postCodeErr;
        else delete errors['quoteData.proposer.address.postcode'];
      }
      break;
    }
    case 'quoteData.proposer.address.country': {
      const country = String(value || '').trim();
      const addr = asRecord(getAtPath(asRecord(portfolio).quoteData, 'proposer.address'));
      if (!country && requiredDraftSet.has('proposer.address.country')) errors['quoteData.proposer.address.country'] = 'Country is required';
      else delete errors['quoteData.proposer.address.country'];
      const province = String(addr.province || '').trim();
      const postCode = String(addr.postcode || '').trim();
      if (requiredDraftSet.has('proposer.address.province') || Boolean(province)) {
        const provinceErr = validateProvinceForCountry(province, country);
        if (provinceErr) errors['quoteData.proposer.address.province'] = provinceErr;
        else delete errors['quoteData.proposer.address.province'];
      } else {
        delete errors['quoteData.proposer.address.province'];
      }
      if (requiredDraftSet.has('proposer.address.postcode') || Boolean(postCode)) {
        const normalizedPostCode = normalizePostCodeForCountry(postCode, country);
        const postCodeErr = validatePostCodeForCountry(normalizedPostCode, country);
        if (postCodeErr) errors['quoteData.proposer.address.postcode'] = postCodeErr;
        else delete errors['quoteData.proposer.address.postcode'];
      } else {
        delete errors['quoteData.proposer.address.postcode'];
      }
      break;
    }
    case 'quoteData.proposer.email':
      if (!value?.trim()) errors['quoteData.proposer.email'] = 'Email is required';
      else if (!EMAIL_REGEX.test(value || '')) errors['quoteData.proposer.email'] = 'Enter a valid email address';
      else delete errors['quoteData.proposer.email'];
      break;
    case 'quoteData.proposer.phone':
      if (!value?.trim()) errors['quoteData.proposer.phone'] = 'Phone number is required';
      else if (!isPossiblePhoneNumber(value || '')) errors['quoteData.proposer.phone'] = 'Enter a valid phone number';
      else delete errors['quoteData.proposer.phone'];
      break;
    case 'quoteData.proposer.nationality':
      if (!value?.trim()) errors['quoteData.proposer.nationality'] = 'Nationality is required';
      else delete errors['quoteData.proposer.nationality'];
      break;
    case 'quoteData.proposer.nif': {
      const v = String(value || '').trim();
      if (!v) {
        delete errors['quoteData.proposer.nif'];
        break;
      }
      const digits = v.replace(/\D/g, '');
      if (digits.length < 5) errors['quoteData.proposer.nif'] = 'Enter a valid NIF';
      else delete errors['quoteData.proposer.nif'];
      break;
    }
  }
  return errors;
}

export function validatePolicyHolderAllFields(portfolio: UnknownRecord): Record<string, string> {
  const qd = asRecord(portfolio?.quoteData);
  let errors: Record<string, string> = {};
  // Phase 6k: Policyholder save reads canonical proposer.* paths. Flat
  // `quoteData.firstName` etc. are no longer accepted.
  const requiredProposerPaths = ['proposer.firstName', 'proposer.lastName', 'proposer.email', 'proposer.phone'];
  for (const path of requiredProposerPaths) {
    errors = validatePolicyField(`quoteData.${path}`, String(getAtPath(qd, path) || ''), portfolio, errors);
  }
  const optionalProposerPaths = [
    'proposer.dateOfBirth',
    'proposer.address.line1',
    'proposer.address.city',
    'proposer.address.province',
    'proposer.address.postcode',
    'proposer.address.country',
    'proposer.nationality',
    'proposer.nif',
  ];
  for (const path of optionalProposerPaths) {
    const raw = String(getAtPath(qd, path) ?? '').trim();
    if (!raw) continue;
    errors = validatePolicyField(`quoteData.${path}`, raw, portfolio, errors);
  }
  return errors;
}

export function mapServerValidationDetails(details: unknown): Record<string, string> {
  const detailsRecord = asRecord(details);
  const fieldErrors = asRecord(detailsRecord.fieldErrors);
  const mapped: Record<string, string> = {};
  Object.entries(fieldErrors).forEach(([key, raw]) => {
    const first = Array.isArray(raw) ? raw.find((v) => String(v || '').trim().length > 0) : raw;
    const fieldKey = key.startsWith('quoteData.') ? key.replace(/^quoteData\./, '') : key;
    const message = fieldKey === 'licenseIssuedIn' && String(first || '').includes('expected string')
      ? 'Please select an option.'
      : normalizeSchemaMessageText(first, { fieldKey });
    if (!message) return;
    if (key.startsWith('quoteData.')) mapped[key] = message;
    else if (key === 'licenseIssuedIn') {
      mapped[`quoteData.${key}`] = message;
    } else if (ProductRegistry.list().some((manifest) => manifest.questionnaire.sections.some((section) => section.fields.some((field) => field.path === key)))) {
      mapped[`quoteData.${key}`] = message;
    } else {
      mapped[key] = message;
    }
  });
  return mapped;
}

import type {
  ProductDiscoverabilityAdapter,
  ProductDiscoverabilityInput,
  ProductDiscoverabilityProjection,
} from '../types.js';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function toNum(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function computeQuoteExpiryDate(statusRaw: string, inceptionDate: Date | null, nowSeed: Date): Date | null {
  const status = String(statusRaw || '').toUpperCase();
  const isQuoteFlowStatus = ['DRAFT', 'INTAKE', 'QUOTE', 'QUOTED', 'REFERRAL', 'INFO_REQUIRED', 'AWAITING_PAYMENT'].includes(status);
  if (!isQuoteFlowStatus) return null;

  if (inceptionDate) {
    const d = new Date(inceptionDate);
    d.setDate(d.getDate() + 7);
    return d;
  }

  const neverQuoted = ['DRAFT', 'INTAKE'].includes(status);
  if (neverQuoted) {
    const d = new Date(nowSeed);
    d.setDate(d.getDate() + 45);
    return d;
  }
  return null;
}

export const buildAutoInsuranceDiscoverability: ProductDiscoverabilityAdapter = (
  input: ProductDiscoverabilityInput,
): ProductDiscoverabilityProjection => {
  const quoteData = asRecord(input.quoteData);
  const quoteResponse = asRecord(input.quoteResponse);
  const vehicleInfo = asRecord(input.vehicleInfo);

  const holderName = String(input.policyHolder?.name || '').trim();
  const proposer = asRecord(quoteData.proposer);
  const firstName = String(proposer.firstName || '').trim();
  const lastName = String(proposer.lastName || '').trim();
  const insuredName = holderName || [firstName, lastName].filter(Boolean).join(' ').trim() || 'Unknown';
  const insuredDisplay = insuredName;

  const address =
    String(input.policyHolder?.address || '').trim() ||
    String(quoteData.address || '').trim() ||
    null;

  const holderContactRaw = asRecord(input.policyHolder);
  const contact = (() => {
    const raw = holderContactRaw.contact;
    if (typeof raw === 'string') {
      try {
        return asRecord(JSON.parse(raw));
      } catch {
        return {};
      }
    }
    return asRecord(raw);
  })();
  const policyholderEmail = String(contact.email || '').trim() || null;
  const policyholderPhone = String(contact.phone || '').trim() || null;
  const policyholderDisplay =
    String(input.policyHolder?.name || '').trim() ||
    [String(contact.firstName || '').trim(), String(contact.lastName || '').trim()].filter(Boolean).join(' ').trim() ||
    insuredDisplay;

  const vehicleYear = String(vehicleInfo.year ?? quoteData.year ?? '').trim();
  const vehicleMake = String(vehicleInfo.make ?? quoteData.make ?? '').trim();
  const vehicleModel = String(vehicleInfo.model ?? quoteData.model ?? '').trim();
  const vehicleSearch = [vehicleYear, vehicleMake].filter(Boolean).join(' ').trim() || null;
  const vehicleRegistration = String(vehicleInfo.registrationNumber ?? quoteData.registrationNumber ?? '').trim();
  const vehicleDisplay =
    [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(' ').trim() ||
    vehicleRegistration ||
    'Unknown vehicle';

  const pricing = asRecord(quoteResponse.pricing);
  const primaryOption = asRecord(quoteResponse.primaryOption);
  const totalPremium = toNum(
    pricing.total ||
      pricing.annualPremium ||
      primaryOption.annualPremium ||
      quoteResponse.premium ||
      0,
  );

  return {
    insuredName,
    insuredDisplay,
    vehicleDisplay,
    policyholderDisplay,
    policyholderEmail,
    policyholderPhone,
    coverageStart: input.inceptionDate,
    coverageEnd: input.expiryDate,
    vehicleSearch,
    address,
    segment: 'Auto Insurance',
    totalPremium,
    renewalDate: input.expiryDate ? new Date(input.expiryDate) : null,
    quoteExpiryDate: computeQuoteExpiryDate(input.status, input.inceptionDate, new Date()),
  };
};


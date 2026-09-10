import type { RentalCoverageCode } from '@facio/products';
import type { DocPackContext } from '../../shared/documents/genericDocPackGenerator.js';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown, fallback = '-'): string {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function formatDate(value: unknown): string {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

function money(value: unknown, currency = 'USD'): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

function parseContact(value: unknown): { email: string; phone: string } {
  const raw = String(value ?? '').trim();
  if (!raw) return { email: '-', phone: '-' };
  try {
    const parsed = asRecord(JSON.parse(raw));
    const primary = asRecord(parsed.primary);
    return {
      email: text(parsed.email || primary.email),
      phone: text(parsed.phone || primary.phone),
    };
  } catch {
    return raw.includes('@') ? { email: raw, phone: '-' } : { email: '-', phone: raw };
  }
}

const DOC_TYPE_BY_COVERAGE: Record<RentalCoverageCode, string> = {
  CDW: 'RENTAL_CDW_CERTIFICATE_PDF',
  RCLI: 'RENTAL_RCLI_CERTIFICATE_PDF',
  SLI: 'RENTAL_SLI_CERTIFICATE_PDF',
  PAI_PEI: 'RENTAL_PAI_PEI_CERTIFICATE_PDF',
};

export function selectedRentalCertificateTypes(ctx: DocPackContext): Set<string> {
  const selected = Array.isArray(ctx.quoteData.coverages)
    ? ctx.quoteData.coverages.map(String)
    : [];
  return new Set(
    selected.map((code) => DOC_TYPE_BY_COVERAGE[code as RentalCoverageCode]).filter(Boolean),
  );
}

export function buildRentalDocViewModel(ctx: DocPackContext): UnknownRecord {
  const risk = asRecord(ctx.quoteData.risk);
  const pickup = asRecord(risk.pickup);
  const residence = asRecord(risk.residence);
  const driver = asRecord(risk.driver);
  const vehicle = asRecord(risk.vehicle);
  const quoteResponse = asRecord(ctx.snapshot.quoteResponse);
  const programDefinition = asRecord(ctx.snapshot.programDefinition);
  const contact = parseContact(ctx.policy.policyHolder?.contact);
  const additionalDrivers = Array.isArray(driver.additionalDrivers)
    ? driver.additionalDrivers.map((value) => ({
        name: text(asRecord(value).fullName),
        licenceState: text(asRecord(value).licenceState),
      }))
    : [];

  return {
    specimen: true,
    issuedAt: formatDate(new Date()),
    policy: {
      number: text(ctx.policy.policyNumber || ctx.policy.certificateNumber || ctx.policy.id),
      transactionId: text(ctx.riskTransactionId),
      configurationVersion: text(quoteResponse.ruleVersion || programDefinition.version),
    },
    insured: {
      name: text(ctx.policy.policyHolder?.name),
      address: text(ctx.policy.policyHolder?.address),
      email: contact.email,
      phone: contact.phone,
    },
    rental: {
      start: formatDate(risk.rentalStart || ctx.policy.inceptionDate),
      end: formatDate(risk.rentalEnd || ctx.policy.expiryDate),
      pickup:
        [text(pickup.location, ''), text(pickup.state, ''), text(pickup.country, '')]
          .filter(Boolean)
          .join(', ') || '-',
      residence:
        [text(residence.state, ''), text(residence.country, '')].filter(Boolean).join(', ') || '-',
      use: text(risk.rentalUse),
    },
    driver: {
      age: text(driver.age),
      licenceValid: driver.licenceValid === true ? 'Yes' : 'No',
      additionalDrivers,
    },
    vehicle: {
      description: [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || '-',
      class: text(vehicle.class),
      declaredValue: money(vehicle.declaredValue),
    },
    quote: {
      totalPremium: money(quoteResponse.total, text(quoteResponse.currency, 'USD')),
      currency: text(quoteResponse.currency, 'USD'),
      coverages: Array.isArray(quoteResponse.coverages)
        ? quoteResponse.coverages
        : Array.isArray(quoteResponse.coveragePrices)
          ? quoteResponse.coveragePrices
          : [],
    },
  };
}

export function buildRentalCoverageViewModel(
  ctx: DocPackContext,
  coverageCode: RentalCoverageCode,
): UnknownRecord {
  const common = buildRentalDocViewModel(ctx);
  const quote = asRecord(common.quote);
  const coverages = Array.isArray(quote.coverages) ? quote.coverages.map(asRecord) : [];
  const coverage = coverages.find((item) => item.code === coverageCode);
  if (!coverage)
    throw new Error(`Rental certificate requires retained quote coverage ${coverageCode}.`);
  return {
    ...common,
    coverage: {
      code: coverageCode,
      label: text(coverage.label),
      limit: text(coverage.limit),
      deductible: text(coverage.deductible, 'None'),
      premium: money(coverage.tripPrice, text(quote.currency, 'USD')),
      description: text(coverage.description),
    },
  };
}

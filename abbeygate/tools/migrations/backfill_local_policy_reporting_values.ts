import { prisma } from '../../backend/platform/db/connection.js';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function normalizeCostDetails(costDetails: UnknownRecord): { next: UnknownRecord; changed: boolean } {
  const next: UnknownRecord = { ...costDetails };
  let changed = false;

  if ((next.mifSurcharge === undefined || next.mifSurcharge === null) && next.tax !== undefined) {
    next.mifSurcharge = next.tax;
    changed = true;
  }
  if ((next.mifSurcharge === undefined || next.mifSurcharge === null) && next.governmentTax !== undefined) {
    next.mifSurcharge = next.governmentTax;
    changed = true;
  }
  if (next.tax !== undefined) {
    delete next.tax;
    changed = true;
  }
  if (next.governmentTax !== undefined) {
    delete next.governmentTax;
    changed = true;
  }
  if ((next.stampDuty === undefined || next.stampDuty === null) && next.policyFee !== undefined) {
    next.stampDuty = next.policyFee;
    changed = true;
  }

  return { next, changed };
}

function normalizeQuoteResponse(quoteResponseRaw: unknown): { next: unknown; changed: boolean } {
  const quoteResponse = asRecord(quoteResponseRaw);
  const primaryOption = asRecord(quoteResponse.primaryOption);
  const costDetails = asRecord(primaryOption.costDetails);
  if (!Object.keys(costDetails).length) return { next: quoteResponseRaw, changed: false };

  const normalized = normalizeCostDetails(costDetails);
  if (!normalized.changed) return { next: quoteResponseRaw, changed: false };

  return {
    next: {
      ...quoteResponse,
      primaryOption: {
        ...primaryOption,
        costDetails: normalized.next,
      },
    },
    changed: true,
  };
}

function toNumericOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function withBackfilledPolicyTypedFields(policy: {
  vehicleRegistrationCountry: string | null;
  vehicleRegistrationNumber: string | null;
  vehicleTypeCode: string | null;
  coverTypeCode: string | null;
  excessAmount: unknown;
  sumInsuredAmount: unknown;
  originalCurrency: string | null;
  quoteData: unknown;
  quoteResponse: unknown;
  vehicleInfo: unknown;
}) {
  const quoteData = asRecord(policy.quoteData);
  const quoteResponse = asRecord(policy.quoteResponse);
  const vehicleInfo = asRecord(policy.vehicleInfo);
  const primary = asRecord(quoteResponse.primaryOption);
  const cost = asRecord(primary.costDetails);

  const next = {
    vehicleRegistrationCountry:
      policy.vehicleRegistrationCountry || String(quoteData.countryOfRegistration || vehicleInfo.countryOfRegistration || '').trim() || null,
    vehicleRegistrationNumber:
      policy.vehicleRegistrationNumber || String(quoteData.registrationNumber || vehicleInfo.registrationNumber || '').trim() || null,
    vehicleTypeCode:
      policy.vehicleTypeCode || String(quoteData.vehicleType || vehicleInfo.vehicleType || '').trim() || null,
    coverTypeCode:
      policy.coverTypeCode || String(quoteData.coverRequired || vehicleInfo.coverRequired || '').trim() || null,
    excessAmount:
      policy.excessAmount || toNumericOrNull(quoteData.requiredExcess || vehicleInfo.requiredExcess || primary.totalExcess),
    sumInsuredAmount:
      policy.sumInsuredAmount || toNumericOrNull(quoteData.vehicleValue || vehicleInfo.vehicleValue || cost.subtotalNetPremium),
    originalCurrency:
      policy.originalCurrency || String(quoteResponse.currency || '').trim().toUpperCase() || null,
  };

  const changed =
    next.vehicleRegistrationCountry !== policy.vehicleRegistrationCountry ||
    next.vehicleRegistrationNumber !== policy.vehicleRegistrationNumber ||
    next.vehicleTypeCode !== policy.vehicleTypeCode ||
    next.coverTypeCode !== policy.coverTypeCode ||
    String(next.excessAmount ?? '') !== String(policy.excessAmount ?? '') ||
    String(next.sumInsuredAmount ?? '') !== String(policy.sumInsuredAmount ?? '') ||
    next.originalCurrency !== policy.originalCurrency;

  return { next, changed };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const policies = await prisma.policy.findMany({
    select: {
      id: true,
      quoteResponse: true,
      vehicleRegistrationCountry: true,
      vehicleRegistrationNumber: true,
      vehicleTypeCode: true,
      coverTypeCode: true,
      excessAmount: true,
      sumInsuredAmount: true,
      originalCurrency: true,
      quoteData: true,
      vehicleInfo: true,
    },
    take: 50_000,
  });

  let quoteResponseUpdated = 0;
  let typedFieldsUpdated = 0;

  for (const policy of policies) {
    const normalizedQr = normalizeQuoteResponse(policy.quoteResponse);
    const typedBackfill = withBackfilledPolicyTypedFields({
      vehicleRegistrationCountry: policy.vehicleRegistrationCountry,
      vehicleRegistrationNumber: policy.vehicleRegistrationNumber,
      vehicleTypeCode: policy.vehicleTypeCode,
      coverTypeCode: policy.coverTypeCode,
      excessAmount: policy.excessAmount,
      sumInsuredAmount: policy.sumInsuredAmount,
      originalCurrency: policy.originalCurrency,
      quoteData: policy.quoteData,
      quoteResponse: normalizedQr.changed ? normalizedQr.next : policy.quoteResponse,
      vehicleInfo: policy.vehicleInfo,
    });

    if (!normalizedQr.changed && !typedBackfill.changed) continue;
    if (normalizedQr.changed) quoteResponseUpdated += 1;
    if (typedBackfill.changed) typedFieldsUpdated += 1;

    if (apply) {
      await prisma.policy.update({
        where: { id: policy.id },
        data: {
          ...(normalizedQr.changed ? { quoteResponse: normalizedQr.next as object } : {}),
          ...(typedBackfill.changed ? typedBackfill.next : {}),
        },
      });
    }
  }

  const states = await prisma.policyStateCurrent.findMany({
    select: { policyId: true, snapshot: true },
    take: 50_000,
  });
  let stateSnapshotUpdated = 0;
  for (const state of states) {
    const snapshot = asRecord(state.snapshot);
    const normalizedQr = normalizeQuoteResponse(snapshot.quoteResponse);
    if (!normalizedQr.changed) continue;
    stateSnapshotUpdated += 1;
    if (apply) {
      await prisma.policyStateCurrent.update({
        where: { policyId: state.policyId },
        data: {
          snapshot: {
            ...snapshot,
            quoteResponse: normalizedQr.next,
          },
        },
      });
    }
  }

  process.stdout.write(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        policyScanned: policies.length,
        policyQuoteResponseUpdates: quoteResponseUpdated,
        policyTypedFieldUpdates: typedFieldsUpdated,
        policyStateScanned: states.length,
        policyStateQuoteResponseUpdates: stateSnapshotUpdated,
      },
      null,
      2
    ) + '\n'
  );
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


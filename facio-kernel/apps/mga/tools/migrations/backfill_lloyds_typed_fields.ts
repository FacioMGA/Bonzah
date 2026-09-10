import { prisma } from '../../backend/platform/db/connection.js';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

async function backfillPolicies() {
  const policies = await prisma.policy.findMany({
    select: {
      id: true,
      vehicleRegistrationCountry: true,
      vehicleRegistrationNumber: true,
      vehicleTypeCode: true,
      coverTypeCode: true,
      excessAmount: true,
      sumInsuredAmount: true,
      originalCurrency: true,
      quoteData: true,
      quoteResponse: true,
      vehicleInfo: true,
    },
    take: 10_000,
  });

  let updated = 0;
  for (const policy of policies) {
    const quoteData = asRecord(policy.quoteData);
    const quoteResponse = asRecord(policy.quoteResponse);
    const vehicleInfo = asRecord(policy.vehicleInfo);
    const next = {
      vehicleRegistrationCountry: policy.vehicleRegistrationCountry || String(quoteData.countryOfRegistration || vehicleInfo.countryOfRegistration || '').trim() || null,
      vehicleRegistrationNumber: policy.vehicleRegistrationNumber || String(quoteData.registrationNumber || vehicleInfo.registrationNumber || '').trim() || null,
      vehicleTypeCode: policy.vehicleTypeCode || String(quoteData.vehicleType || vehicleInfo.vehicleType || '').trim() || null,
      coverTypeCode: policy.coverTypeCode || String(quoteData.coverRequired || vehicleInfo.coverRequired || '').trim() || null,
      excessAmount: policy.excessAmount || Number(quoteData.requiredExcess || vehicleInfo.requiredExcess || asRecord(quoteResponse.primaryOption).totalExcess || 0) || null,
      sumInsuredAmount: policy.sumInsuredAmount || Number(quoteData.vehicleValue || vehicleInfo.vehicleValue || 0) || null,
      originalCurrency: policy.originalCurrency || String(quoteResponse.currency || '').trim().toUpperCase() || null,
    };
    const hasAny = Object.values(next).some((value) => value !== null);
    if (!hasAny) continue;
    await prisma.policy.update({
      where: { id: policy.id },
      data: next,
    });
    updated += 1;
  }
  return updated;
}

async function backfillClaims() {
  const claims = await prisma.claim.findMany({
    select: {
      id: true,
      certificateReference: true,
      originalCurrency: true,
      lossCountry: true,
      causeOfLossCode: true,
      lossDescription: true,
      dateOfLossFrom: true,
      dateOfLossTo: true,
      data: true,
    },
    take: 10_000,
  });
  let updated = 0;
  for (const claim of claims) {
    const data = asRecord(claim.data);
    const next = {
      certificateReference: claim.certificateReference || String(data.cr0029_certificate_reference || '').trim() || null,
      originalCurrency: claim.originalCurrency || String(data.cr0109_original_currency || '').trim().toUpperCase() || null,
      lossCountry: claim.lossCountry || String(data.cr0116_loss_country || '').trim().toUpperCase() || null,
      causeOfLossCode: claim.causeOfLossCode || String(data.cr0117_cause_of_loss_code || '').trim() || null,
      lossDescription: claim.lossDescription || String(data.cr0118_loss_description || '').trim() || null,
      dateOfLossFrom: claim.dateOfLossFrom || toDateOrNull(data.cr0119_date_of_loss_from),
      dateOfLossTo: claim.dateOfLossTo || toDateOrNull(data.cr0120_date_of_loss_to),
    };
    const hasAny = Object.values(next).some((value) => value !== null);
    if (!hasAny) continue;
    await prisma.claim.update({
      where: { id: claim.id },
      data: next,
    });
    updated += 1;
  }
  return updated;
}

async function main() {
  const [policyUpdates, claimUpdates] = await Promise.all([
    backfillPolicies(),
    backfillClaims(),
  ]);
  process.stdout.write(`Backfill complete. policies=${policyUpdates} claims=${claimUpdates}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});


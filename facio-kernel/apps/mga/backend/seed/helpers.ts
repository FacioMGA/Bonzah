// Pure + tenant-scoped helpers used across the per-stage seed modules.
// Extracted from `../seed.ts` in PR 2.3b of the errors-and-warnings cleanup.

import { type Prisma } from '@prisma/client';
import { generatePolicyId, generateQuoteId } from '../platform/utils/platformIds.js';
import { calculateAutoInsuranceQuoteResponse as calculateMotorQuoteResponse } from '../products/motor/pricing/autoInsuranceCalculator.js';
import { loadAbbeygateAutoCyprus2022Matrix } from '../products/motor/pricing/data/loader.js';
import { evaluateConfiguredMotorUwAutomation } from '../products/motor/underwriting/motorUwAutomation.js';
import { MOTOR_UW_CONFIG_FIXTURE } from '../test/fixtures/motor/underwriting.js';
import type { QuoteData } from '../platform/types/autoInsurance.js';
import { tenantScopedPrisma } from '../platform/db/connection.js';
import { TENANT_IDS } from '../platform/tenant/tenantConfig.js';
import { logger } from '../platform/utils/logger.js';
import { SEED_OVERWRITE_BINDERS, statusForCanonicalPeriod } from './context.js';

// Keep the module re-export so per-stage files can pull `generatePolicyId`
// from `./helpers.js` without re-declaring the import.
export { generatePolicyId, generateQuoteId };
const seedMotorRatingModel = loadAbbeygateAutoCyprus2022Matrix();

/**
 * Demo data is deliberately generated from the checked-in seed dataset. Live
 * quote paths always provide the binder-mapped programme model instead.
 */
export function calculateAutoInsuranceQuoteResponse(
  ...args: Parameters<typeof calculateMotorQuoteResponse>
) {
  const [quoteData, overrideExcess, options, appliedEndorsements] = args;
  return calculateMotorQuoteResponse(
    quoteData,
    overrideExcess,
    options,
    appliedEndorsements,
    seedMotorRatingModel,
  );
}

/** Explicit development-seed input; never used by a production quote path. */
export function seedMotorQuoteOptions(quoteData: QuoteData, reference: string) {
  return {
    reference,
    currency: 'EUR',
    uwDecision: evaluateConfiguredMotorUwAutomation(quoteData, MOTOR_UW_CONFIG_FIXTURE),
  };
}

export function statusForPeriod(startDate: Date, endDate: Date): 'ACTIVE' | 'EXPIRED' | 'PENDING' {
  return statusForCanonicalPeriod(startDate, endDate);
}

export function statusUpdateForPeriod(startDate: Date, endDate: Date) {
  return { status: statusForPeriod(startDate, endDate) };
}

export function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export function buildVehicleInfoFromQuoteData(quoteData: Record<string, unknown> | QuoteData) {
  return {
    vehicleLocation: quoteData?.vehicleLocation,
    coverRequired: quoteData?.coverRequired,
    renewalDate: quoteData?.renewalDate,
    vehicleType: quoteData?.vehicleType,
    make: quoteData?.make,
    model: quoteData?.model,
    cabrio: quoteData?.cabrio,
    fuelType: quoteData?.fuelType,
    kmsPerYear: quoteData?.kmsPerYear,
    year: quoteData?.year,
    countryOfRegistration: quoteData?.countryOfRegistration,
    registrationNumber: quoteData?.registrationNumber,
    numberOfSeats: quoteData?.numberOfSeats,
    modified: quoteData?.modified,
    modificationsDetails: quoteData?.modificationsDetails,
    parking: quoteData?.parking,
    parkingOther: quoteData?.parkingOther,
    garageTotalValue: quoteData?.garageTotalValue,
    engineSize: quoteData?.engineSize,
    vehicleValue: quoteData?.vehicleValue,
    ncb: quoteData?.ncb,
    protectNCB: quoteData?.protectNCB,
    vehicleUse: quoteData?.vehicleUse,
    businessUseDetails: quoteData?.businessUseDetails,
    requiredExcess: quoteData?.requiredExcess,
  };
}

export function buildDriverInfoFromQuoteData(quoteData: Record<string, unknown> | QuoteData) {
  return {
    licenseYears: quoteData?.licenseYears,
    licenseType: quoteData?.licenseType,
    licenseIssuedIn: quoteData?.licenseIssuedIn,
    hasClaims: quoteData?.hasClaims,
    claimsDetails: quoteData?.claimsDetails,
    hasConvictions: quoteData?.hasConvictions,
    convictionsDetails: quoteData?.convictionsDetails,
    hasAdditionalDrivers: quoteData?.hasAdditionalDrivers,
    youngestDriverAge: quoteData?.youngestDriverAge,
    otherDriversClaims: quoteData?.otherDriversClaims,
    otherDriversClaimsDetails: quoteData?.otherDriversClaimsDetails,
    otherDriversConvictions: quoteData?.otherDriversConvictions,
    otherDriversConvictionsDetails: quoteData?.otherDriversConvictionsDetails,
  };
}

export function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function makeClaimNumber(seed: string): string {
  return `CLM-${seed}-${Date.now().toString().slice(-6)}`;
}

export async function reseedBinderParties(binderId: string, coverholderName: string, leadName: string) {
  const existingCount = await tenantScopedPrisma.binderParty.count({ where: { binderId } });
  if (existingCount > 0 && !SEED_OVERWRITE_BINDERS) {
    logger.info({ binderId, existingCount }, 'Binder parties already exist; skipping seed overwrite');
    return;
  }
  await tenantScopedPrisma.binderParty.deleteMany({ where: { binderId } });
  await tenantScopedPrisma.binderParty.createMany({
    data: [
      {
        binderId,
        role: 'appointed_coverholder',
        name: coverholderName,
      },
      {
        binderId,
        role: 'lead_capacity_provider',
        name: leadName,
      },
    ],
  });
}

export async function createSeedInceptionRiskTransaction(args: {
  policyId: string;
  programId: string;
  binderId: string;
  inceptionDate: Date;
  expiryDate: Date | null;
  snapshot: Record<string, unknown>;
}) {
  const { policyId, programId, binderId, inceptionDate, expiryDate, snapshot } = args;
  await tenantScopedPrisma.riskTransaction.create({
    data: {
      operatingTenantId: TENANT_IDS.CY,
      policyId,
      programId,
      binderId,
      transactionNumber: 1,
      transactionType: 'INCEPTION',
      status: 'BOUND',
      effectiveDate: inceptionDate,
      expiryDate,
      changeReason: 'SEED_BASELINE',
      createdBy: 'seed-script',
      snapshotFinal: toInputJson(snapshot),
    },
  });
}

export function makeBaseQuoteData(
  overrides: Record<string, unknown> & { proposer?: Record<string, unknown> } = {},
): QuoteData {
  const now = new Date();
  const renewal = new Date();
  renewal.setDate(renewal.getDate() + 7);

  const { proposer: proposerOverrides, ...rest } = overrides;

  const baseQuoteData: QuoteData = {
    // Step 1: Your Details (Phase 6k canonical proposer.* shape)
    proposer: {
      firstName: 'Seed',
      lastName: 'Customer',
      address: {
        line1: '1 Seafront Ave',
        city: 'Limassol',
        province: 'Limassol',
        postcode: '3042',
        country: 'Cyprus',
      },
      domicileCountry: 'Cyprus',
      phone: '+357 99 123456',
      dateOfBirth: '1989-01-01',
      email: 'seed.customer@example.com',
      nationality: 'Cyprus',
      nif: 'SEEDNIF123',
      occupation: 'Engineer',
      whereDidYouHear: 'Google',
      bestTimeToCall: 'Anytime',
      marketingConsent: false,
      privacyPolicyAccepted: true,
    },

    // Step 2: Driving & History
    licenseYears: 10,
    licenseType: 'Full',
    licenseIssuedIn: 'Cyprus',
    hasClaims: false,
    claimsDetails: '',
    claimsCountLast5Years: 0,
    claimsTotalCostLast5Years: 0,
    maxFaultClaimCostLast5Years: 0,
    hasConvictions: false,
    convictionsDetails: '',
    hasMajorConvictionLast5Years: false,
    convictionClass: '',
    majorConvictionWithinYears: '',
    hasAdditionalDrivers: false,
    youngestDriverAge: '',
    otherDriversClaims: false,
    otherDriversClaimsDetails: '',
    otherDriversConvictions: false,
    otherDriversConvictionsDetails: '',

    // Step 3: Vehicle & Cover
    vehicleLocation: 'Cyprus',
    coverRequired: 'Comprehensive',
    renewalDate: ymd(renewal),
    vehicleType: 'Car',
    motorcycleRidersNamed: true,
    classicIsGenuine: null,
    classicIsSecondaryVehicle: null,
    make: 'Toyota',
    model: 'Corolla',
    cabrio: 'No',
    fuelType: 'Petrol',
    kmsPerYear: '10,000',
    year: 2020,
    countryOfRegistration: 'Cyprus',
    registrationNumber: `CY-SEED-${String(now.getTime()).slice(-6)}`,
    vin: `VINSEED${String(now.getTime()).slice(-10)}`,
    numberOfSeats: 5,
    modified: false,
    modificationsDetails: '',
    parking: 'Drive',
    parkingOther: '',
    garageTotalValue: 0,
    engineSize: 1600,
    vehicleValue: 20000,
    ncb: '5+ Years',
    protectNCB: true,
    vehicleUse: 'Private',
    businessUseDetails: '',
    requiredExcess: 'Standard (€250)',
    homeInsuranceRenewalDate: '',
    infoTrueAndAccurate: true,
    fairProcessingAccepted: true,

    ...rest,
  };
  if (proposerOverrides) {
    const typedProposerOverrides: { address?: Record<string, unknown> } = proposerOverrides;
    const proposer: QuoteData['proposer'] = {
      ...(baseQuoteData.proposer ?? {}),
      ...proposerOverrides,
      address: {
        ...(baseQuoteData.proposer?.address ?? {}),
        ...(typedProposerOverrides.address ?? {}),
      },
    };
    baseQuoteData.proposer = {
      ...proposer,
    };
  }
  return baseQuoteData;
}

export async function createComputedAutoQuote(args: {
  binderId: string;
  programId: string;
  policyHolder: { id: string; name: string };
  quoteData: QuoteData;
}) {
  const { binderId, programId, policyHolder, quoteData } = args;

  const policyNumber = await generateQuoteId();
  const uwDecision = evaluateConfiguredMotorUwAutomation(quoteData, MOTOR_UW_CONFIG_FIXTURE);
  const quoteResponse = calculateAutoInsuranceQuoteResponse(quoteData, undefined, {
    reference: policyNumber,
    currency: 'EUR',
    uwDecision,
  });

  const normalizedQuoteResponse = {
    ...quoteResponse,
    status: uwDecision.outcome === 'decline' ? 'declined' : uwDecision.outcome === 'referral' ? 'referral' : 'quoted',
    referralMessage:
      uwDecision.outcome === 'referral'
        ? `Referred for underwriting review: ${uwDecision.reasons.join(' ')}`
        : quoteResponse.referralMessage,
    warnings: [
      ...(quoteResponse.warnings || []),
      ...(uwDecision.outcome !== 'accept' ? [`Underwriting ${uwDecision.lane.toUpperCase()} lane: ${uwDecision.reasons.join(' ')}`] : []),
    ],
  };

  const status = uwDecision.outcome === 'decline' ? 'DECLINED' : uwDecision.outcome === 'referral' ? 'REFERRAL' : 'QUOTED';
  const totalPremium =
    uwDecision.outcome === 'decline'
      ? 0
      : (normalizedQuoteResponse?.primaryOption?.costDetails?.totalPremium || normalizedQuoteResponse?.primaryOption?.annualPremium || 0);

  const inceptionDate = new Date(String(quoteData.renewalDate || new Date().toISOString()));
  const expiryDate = new Date(inceptionDate);
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);

  const vehicleInfo = buildVehicleInfoFromQuoteData(quoteData);
  const driverInfo = buildDriverInfoFromQuoteData(quoteData);

  const created = await tenantScopedPrisma.policy.create({
    data: {
      operatingTenantId: TENANT_IDS.CY,
      policyNumber,
      productType: 'MOTOR',
      status,
      inceptionDate,
      expiryDate,
      policyHolderId: policyHolder.id,
      binderId,
      programId,
      quoteData: toInputJson(quoteData),
      vehicleInfo: toInputJson(vehicleInfo),
      driverInfo: toInputJson(driverInfo),
      quoteResponse: toInputJson(normalizedQuoteResponse),
      stateCurrent: {
        create: {
          operatingTenantId: TENANT_IDS.CY,
          snapshot: toInputJson({
            quoteData,
            vehicleInfo,
            driverInfo,
            quoteResponse: normalizedQuoteResponse,
            uwDecision,
            step: 'your-quote',
            flow_context: { channel: 'customer_wizard', step: 'quote' },
          }),
        },
      },
      searchIndex: {
        create: {
          operatingTenantId: TENANT_IDS.CY,
          policyNumber,
          insuredName: policyHolder.name,
          status,
          totalPremium,
        },
      },
    },
  });

  return { created, uwDecision, totalPremium };
}

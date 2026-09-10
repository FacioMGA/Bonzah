// Renewal-in-progress example policy + the Green/Yellow/Red demo
// quote lanes (STP / referral / declined) that exercise the
// underwriting-automation surface end-to-end.

import type { PolicyHolder, Program } from '@prisma/client';
import { tenantScopedPrisma } from '../platform/db/connection.js';
import { TENANT_IDS } from '../platform/tenant/tenantConfig.js';
import { logger } from '../platform/utils/logger.js';
import type { SeededMotorBinder } from './binders.js';
import {
  buildDriverInfoFromQuoteData,
  buildVehicleInfoFromQuoteData,
  calculateAutoInsuranceQuoteResponse,
  createComputedAutoQuote,
  createSeedInceptionRiskTransaction,
  generatePolicyId,
  makeBaseQuoteData,
  toInputJson,
} from './helpers.js';

export async function seedRenewalAndDemoLanes(args: {
  ph: PolicyHolder;
  program: Program;
  motorPolicyBinder: SeededMotorBinder;
}): Promise<void> {
  const { ph, program, motorPolicyBinder } = args;

  const renewalStart = new Date();
  renewalStart.setFullYear(renewalStart.getFullYear() - 1);
  const renewalEnd = new Date();
  renewalEnd.setDate(renewalEnd.getDate() + 18); // expiring soon

  const renewalQuoteData = makeBaseQuoteData({
    proposer: {
      firstName: 'Renewal',
      lastName: 'Pending',
      email: 'renewal.pending@example.com',
      dateOfBirth: '1979-07-07',
    },
    licenseYears: 22,
    make: 'Skoda',
    model: 'Octavia',
    year: 2021,
    vehicleValue: 18000,
    registrationNumber: 'CY-RNW001',
    coverRequired: 'Comprehensive',
    vehicleType: 'Car',
  });
  const policyRenewalInProgressNumber = await generatePolicyId();
  const renewalQuoteResponse = calculateAutoInsuranceQuoteResponse(renewalQuoteData, undefined, { reference: policyRenewalInProgressNumber, currency: 'EUR' });
  const renewalTotalPremium = (renewalQuoteResponse?.primaryOption?.costDetails?.totalPremium || renewalQuoteResponse?.primaryOption?.annualPremium || 0);
  const policyRenewalInProgress = await tenantScopedPrisma.policy.create({
    data: {
      operatingTenantId: TENANT_IDS.CY,
      policyNumber: policyRenewalInProgressNumber,
      productType: 'MOTOR',
      status: 'ACTIVE',
      inceptionDate: renewalStart,
      expiryDate: renewalEnd,
      policyHolderId: ph.id,
      binderId: motorPolicyBinder.id,
      programId: program.id,
      quoteData: toInputJson(renewalQuoteData),
      vehicleInfo: toInputJson(buildVehicleInfoFromQuoteData(renewalQuoteData)),
      driverInfo: toInputJson(buildDriverInfoFromQuoteData(renewalQuoteData)),
      quoteResponse: toInputJson(renewalQuoteResponse),
      stateCurrent: {
        create: {
          operatingTenantId: TENANT_IDS.CY,
          snapshot: toInputJson({
            quoteData: renewalQuoteData,
            quoteResponse: renewalQuoteResponse,
            step: 'service',
            flow_context: { channel: 'backoffice', step: 'service' },
            premium: renewalTotalPremium,
            renewal: {
              status: 'IN_PROGRESS',
              renewalForExpiryDate: renewalEnd.toISOString().slice(0, 10),
              followUpDueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
              lastContactAt: new Date().toISOString(),
            },
          }),
        },
      },
      searchIndex: {
        create: {
          operatingTenantId: TENANT_IDS.CY,
          policyNumber: policyRenewalInProgressNumber,
          insuredName: ph.name,
          status: 'ACTIVE',
          totalPremium: renewalTotalPremium,
        },
      },
    },
  });
  await createSeedInceptionRiskTransaction({
    policyId: policyRenewalInProgress.id,
    programId: program.id,
    binderId: motorPolicyBinder.id,
    inceptionDate: new Date(policyRenewalInProgress.inceptionDate),
    expiryDate: policyRenewalInProgress.expiryDate ? new Date(policyRenewalInProgress.expiryDate) : null,
    snapshot: {
      quoteData: renewalQuoteData,
      quoteResponse: renewalQuoteResponse,
      step: 'service',
      flow_context: { channel: 'backoffice', step: 'service' },
      premium: renewalTotalPremium,
      renewal: {
        status: 'IN_PROGRESS',
        renewalForExpiryDate: renewalEnd.toISOString().slice(0, 10),
        followUpDueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        lastContactAt: new Date().toISOString(),
      },
    },
  });
  logger.info(`✅ Created Renewal In-Progress Policy: ${policyRenewalInProgress.policyNumber}`);

  // 4d/4e/4f. Create QUOTED (Green), REFERRAL (Yellow), DECLINED (Red) quotes from real QuoteData -> calculator + UW engine
  const phGreen = await tenantScopedPrisma.policyHolder.create({
    data: {
      operatingTenantId: TENANT_IDS.CY,
      name: 'Green Lane (Seed)',
      contact: JSON.stringify({ email: 'green.seed@example.com', phone: '+357 99 000001', firstName: 'Green', lastName: 'Seed' }),
      segment: 'Auto Insurance',
      address: 'Limassol, Cyprus',
    },
  });
  const greenQuoteData = makeBaseQuoteData({
    proposer: {
      firstName: 'Green',
      lastName: 'Seed',
      email: 'green.seed@example.com',
      dateOfBirth: '1986-04-04', // >30 for STP
    },
    licenseYears: 8, // >2 for STP
    hasClaims: false,
    hasConvictions: false,
    hasAdditionalDrivers: false,
    vehicleValue: 25000,
    vehicleType: 'Car',
    make: 'Toyota',
    model: 'Corolla',
    coverRequired: 'Comprehensive',
    vehicleUse: 'Private',
    registrationNumber: 'CY-GREEN001',
  });
  const green = await createComputedAutoQuote({
    binderId: motorPolicyBinder.id,
    programId: program.id,
    policyHolder: { id: phGreen.id, name: phGreen.name },
    quoteData: greenQuoteData
  });
  logger.info(`✅ Created Green (Quoted) Quote: ${green.created.policyNumber}`);

  const phYellow = await tenantScopedPrisma.policyHolder.create({
    data: {
      operatingTenantId: TENANT_IDS.CY,
      name: 'Yellow Lane (Seed)',
      contact: JSON.stringify({ email: 'yellow.seed@example.com', phone: '+357 99 000002', firstName: 'Yellow', lastName: 'Seed' }),
      segment: 'Auto Insurance',
      address: 'Limassol, Cyprus',
    },
  });
  const yellowQuoteData = makeBaseQuoteData({
    proposer: {
      firstName: 'Yellow',
      lastName: 'Seed',
      email: 'yellow.seed@example.com',
      dateOfBirth: '1990-05-05', // >30 for STP
    },
    licenseYears: 10,
    vehicleValue: 90000, // triggers YELLOW.VEHICLE_VALUE_OVER_80K
    vehicleType: 'Car',
    make: 'BMW',
    model: 'X5',
    coverRequired: 'Comprehensive',
    vehicleUse: 'Private',
    registrationNumber: 'CY-YELLOW001',
  });
  const yellow = await createComputedAutoQuote({
    binderId: motorPolicyBinder.id,
    programId: program.id,
    policyHolder: { id: phYellow.id, name: phYellow.name },
    quoteData: yellowQuoteData
  });
  logger.info(`✅ Created Yellow (Referral) Quote: ${yellow.created.policyNumber}`);

  const phRed = await tenantScopedPrisma.policyHolder.create({
    data: {
      operatingTenantId: TENANT_IDS.CY,
      name: 'Red Lane (Seed)',
      contact: JSON.stringify({ email: 'red.seed@example.com', phone: '+357 99 000003', firstName: 'Red', lastName: 'Seed' }),
      segment: 'Auto Insurance',
      address: 'Limassol, Cyprus',
    },
  });
  const redQuoteData = makeBaseQuoteData({
    proposer: {
      firstName: 'Red',
      lastName: 'Seed',
      email: 'red.seed@example.com',
      // Proposer under 25 on a motorcycle => RED
      dateOfBirth: '2005-01-01',
    },
    licenseYears: 3,
    licenseType: 'Full',
    vehicleType: 'Motorbike',
    engineSize: 600, // >200
    ncb: 'None', // no NCD
    motorcycleRidersNamed: true,
    coverRequired: 'Comprehensive',
    vehicleValue: 8000,
    registrationNumber: 'CY-RED001',
  });
  const red = await createComputedAutoQuote({
    binderId: motorPolicyBinder.id,
    programId: program.id,
    policyHolder: { id: phRed.id, name: phRed.name },
    quoteData: redQuoteData
  });
  logger.info(`✅ Created Red (Declined) Quote: ${red.created.policyNumber}`);
}

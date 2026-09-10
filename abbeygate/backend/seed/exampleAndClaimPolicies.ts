// Example MOTOR policies covering the Active, Issued, Cancellation-Pending,
// and Active-with-Open-Claim states. Each policy gets its inception
// risk transaction so downstream BDX exports see a real movement.

import type { PolicyHolder, Program } from '@prisma/client';
import { tenantScopedPrisma } from '../platform/db/connection.js';
import { TENANT_IDS } from '../platform/tenant/tenantConfig.js';
import { logger } from '../platform/utils/logger.js';
import type { SeededMotorBinder } from './binders.js';
import {
  buildDriverInfoFromQuoteData,
  buildVehicleInfoFromQuoteData,
  calculateAutoInsuranceQuoteResponse,
  createSeedInceptionRiskTransaction,
  generatePolicyId,
  makeBaseQuoteData,
  makeClaimNumber,
  toInputJson,
} from './helpers.js';

export async function seedExampleAndClaimPolicies(args: {
  ph: PolicyHolder;
  program: Program;
  motorPolicyBinder: SeededMotorBinder;
}): Promise<void> {
  const { ph, program, motorPolicyBinder } = args;

  const activeQuoteData = makeBaseQuoteData({
    proposer: {
      firstName: 'Active',
      lastName: 'Policy',
      email: 'active.policy@example.com',
      dateOfBirth: '1985-02-02', // >30 for STP
    },
    licenseYears: 12,
    make: 'Mercedes',
    model: 'C-Class',
    year: 2023,
    vehicleValue: 20000,
    registrationNumber: 'CY-ACT001',
    coverRequired: 'Comprehensive',
    vehicleType: 'Car',
  });
  const policyActiveNumber = await generatePolicyId();
  const activeQuoteResponse = calculateAutoInsuranceQuoteResponse(activeQuoteData, undefined, { reference: policyActiveNumber, currency: 'EUR' });
  const activeTotalPremium = (activeQuoteResponse?.primaryOption?.costDetails?.totalPremium || activeQuoteResponse?.primaryOption?.annualPremium || 0);
  const policyActive = await tenantScopedPrisma.policy.create({
    data: {
      operatingTenantId: TENANT_IDS.CY,
      policyNumber: policyActiveNumber,
      productType: 'MOTOR',
      status: 'ACTIVE',
      inceptionDate: new Date(),
      expiryDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
      policyHolderId: ph.id,
      binderId: motorPolicyBinder.id,
      programId: program.id,
      quoteData: toInputJson(activeQuoteData),
      vehicleInfo: toInputJson(buildVehicleInfoFromQuoteData(activeQuoteData)),
      driverInfo: toInputJson(buildDriverInfoFromQuoteData(activeQuoteData)),
      quoteResponse: toInputJson(activeQuoteResponse),
      stateCurrent: {
        create: {
          operatingTenantId: TENANT_IDS.CY,
          snapshot: toInputJson({
            quoteData: activeQuoteData,
            quoteResponse: activeQuoteResponse,
            step: 'issued',
            flow_context: { channel: 'backoffice', step: 'documents' },
            premium: activeTotalPremium,
          }),
        },
      },
      searchIndex: {
        create: {
          operatingTenantId: TENANT_IDS.CY,
          policyNumber: policyActiveNumber,
          insuredName: ph.name,
          status: 'ACTIVE',
          totalPremium: activeTotalPremium,
        },
      },
    },
  });
  await createSeedInceptionRiskTransaction({
    policyId: policyActive.id,
    programId: program.id,
    binderId: motorPolicyBinder.id,
    inceptionDate: new Date(policyActive.inceptionDate),
    expiryDate: policyActive.expiryDate ? new Date(policyActive.expiryDate) : null,
    snapshot: {
      quoteData: activeQuoteData,
      quoteResponse: activeQuoteResponse,
      step: 'issued',
      flow_context: { channel: 'backoffice', step: 'documents' },
      premium: activeTotalPremium,
    },
  });
  logger.info(`✅ Created Policy: ${policyActive.policyNumber}`);

  // 4. Create ISSUED policy (future start) so you can test the Issued icon/state
  const startFuture = new Date();
  startFuture.setDate(startFuture.getDate() + 14);
  const endFuture = new Date(startFuture);
  endFuture.setFullYear(endFuture.getFullYear() + 1);

  const issuedQuoteData = makeBaseQuoteData({
    proposer: {
      firstName: 'Issued',
      lastName: 'Policy',
      email: 'issued.policy@example.com',
      dateOfBirth: '1980-03-03', // >30 for STP
    },
    licenseYears: 20,
    make: 'BMW',
    model: 'X5',
    year: 2024,
    vehicleValue: 80000,
    registrationNumber: 'CY-ISS001',
    coverRequired: 'Comprehensive',
    vehicleType: '4x4 or MPV',
  });
  const policyIssuedNumber = await generatePolicyId();
  const issuedQuoteResponse = calculateAutoInsuranceQuoteResponse(issuedQuoteData, undefined, { reference: policyIssuedNumber, currency: 'EUR' });
  const issuedTotalPremium = (issuedQuoteResponse?.primaryOption?.costDetails?.totalPremium || issuedQuoteResponse?.primaryOption?.annualPremium || 0);
  const policyIssued = await tenantScopedPrisma.policy.create({
    data: {
      operatingTenantId: TENANT_IDS.CY,
      policyNumber: policyIssuedNumber,
      productType: 'MOTOR',
      status: 'ISSUED',
      inceptionDate: startFuture,
      expiryDate: endFuture,
      policyHolderId: ph.id,
      binderId: motorPolicyBinder.id,
      programId: program.id,
      quoteData: toInputJson(issuedQuoteData),
      vehicleInfo: toInputJson(buildVehicleInfoFromQuoteData(issuedQuoteData)),
      driverInfo: toInputJson(buildDriverInfoFromQuoteData(issuedQuoteData)),
      quoteResponse: toInputJson(issuedQuoteResponse),
      stateCurrent: {
        create: {
          operatingTenantId: TENANT_IDS.CY,
          snapshot: toInputJson({
            quoteData: issuedQuoteData,
            quoteResponse: issuedQuoteResponse,
            step: 'issued',
            flow_context: { channel: 'backoffice', step: 'documents' },
            premium: issuedTotalPremium,
          }),
        },
      },
      searchIndex: {
        create: {
          operatingTenantId: TENANT_IDS.CY,
          policyNumber: policyIssuedNumber,
          insuredName: ph.name,
          status: 'ISSUED',
          totalPremium: issuedTotalPremium,
        },
      },
    },
  });
  await createSeedInceptionRiskTransaction({
    policyId: policyIssued.id,
    programId: program.id,
    binderId: motorPolicyBinder.id,
    inceptionDate: new Date(policyIssued.inceptionDate),
    expiryDate: policyIssued.expiryDate ? new Date(policyIssued.expiryDate) : null,
    snapshot: {
      quoteData: issuedQuoteData,
      quoteResponse: issuedQuoteResponse,
      step: 'issued',
      flow_context: { channel: 'backoffice', step: 'documents' },
      premium: issuedTotalPremium,
    },
  });
  logger.info(`✅ Created Policy: ${policyIssued.policyNumber}`);

  // 4a. Create CANCELLATION_REQUESTED policy for cancellation-pending filter testing
  const cancellationStart = new Date();
  cancellationStart.setMonth(cancellationStart.getMonth() - 2);
  const cancellationEnd = new Date(cancellationStart);
  cancellationEnd.setFullYear(cancellationEnd.getFullYear() + 1);
  const cancellationRequestedAt = new Date();

  const cancellationQuoteData = makeBaseQuoteData({
    proposer: {
      firstName: 'Cancelation',
      lastName: 'Pending',
      email: 'cancelation.pending@example.com',
      dateOfBirth: '1987-06-06',
    },
    licenseYears: 9,
    make: 'Audi',
    model: 'A4',
    year: 2021,
    vehicleValue: 26000,
    registrationNumber: 'CY-CXL001',
    coverRequired: 'Comprehensive',
    vehicleType: 'Car',
  });
  const policyCancellationPendingNumber = await generatePolicyId();
  const cancellationQuoteResponse = calculateAutoInsuranceQuoteResponse(cancellationQuoteData, undefined, { reference: policyCancellationPendingNumber, currency: 'EUR' });
  const cancellationTotalPremium = (cancellationQuoteResponse?.primaryOption?.costDetails?.totalPremium || cancellationQuoteResponse?.primaryOption?.annualPremium || 0);
  const policyCancellationPending = await tenantScopedPrisma.policy.create({
    data: {
      operatingTenantId: TENANT_IDS.CY,
      policyNumber: policyCancellationPendingNumber,
      productType: 'MOTOR',
      status: 'CANCELLATION_REQUESTED',
      inceptionDate: cancellationStart,
      expiryDate: cancellationEnd,
      policyHolderId: ph.id,
      binderId: motorPolicyBinder.id,
      programId: program.id,
      quoteData: toInputJson(cancellationQuoteData),
      vehicleInfo: toInputJson(buildVehicleInfoFromQuoteData(cancellationQuoteData)),
      driverInfo: toInputJson(buildDriverInfoFromQuoteData(cancellationQuoteData)),
      quoteResponse: toInputJson(cancellationQuoteResponse),
      stateCurrent: {
        create: {
          operatingTenantId: TENANT_IDS.CY,
          snapshot: toInputJson({
            quoteData: cancellationQuoteData,
            quoteResponse: cancellationQuoteResponse,
            step: 'service',
            flow_context: { channel: 'backoffice', step: 'service' },
            premium: cancellationTotalPremium,
            cancellationRequest: {
              requestedAt: cancellationRequestedAt.toISOString(),
              requestedBy: 'seed-script',
              reason: 'Customer requested cancellation',
              requestedEffectiveDate: cancellationRequestedAt.toISOString().slice(0, 10),
            },
          }),
        },
      },
      searchIndex: {
        create: {
          operatingTenantId: TENANT_IDS.CY,
          policyNumber: policyCancellationPendingNumber,
          insuredName: ph.name,
          status: 'CANCELLATION_REQUESTED',
          totalPremium: cancellationTotalPremium,
        },
      },
    },
  });
  await createSeedInceptionRiskTransaction({
    policyId: policyCancellationPending.id,
    programId: program.id,
    binderId: motorPolicyBinder.id,
    inceptionDate: new Date(policyCancellationPending.inceptionDate),
    expiryDate: policyCancellationPending.expiryDate ? new Date(policyCancellationPending.expiryDate) : null,
    snapshot: {
      quoteData: cancellationQuoteData,
      quoteResponse: cancellationQuoteResponse,
      step: 'service',
      flow_context: { channel: 'backoffice', step: 'service' },
      premium: cancellationTotalPremium,
      cancellationRequest: {
        requestedAt: cancellationRequestedAt.toISOString(),
        requestedBy: 'seed-script',
        reason: 'Customer requested cancellation',
        requestedEffectiveDate: cancellationRequestedAt.toISOString().slice(0, 10),
      },
    },
  });
  logger.info(`✅ Created Cancellation Pending Policy: ${policyCancellationPending.policyNumber}`);

  // 4b. Create policy with OPEN claim for Claims Desk/FNOL lifecycle testing
  const claimStart = new Date();
  claimStart.setMonth(claimStart.getMonth() - 4);
  const claimEnd = new Date(claimStart);
  claimEnd.setFullYear(claimEnd.getFullYear() + 1);
  const claimIncidentAt = new Date();
  claimIncidentAt.setDate(claimIncidentAt.getDate() - 9);

  const claimQuoteData = makeBaseQuoteData({
    proposer: {
      firstName: 'Claim',
      lastName: 'Open',
      email: 'claim.open@example.com',
      dateOfBirth: '1984-09-09',
    },
    licenseYears: 14,
    make: 'Volkswagen',
    model: 'Golf',
    year: 2022,
    vehicleValue: 22000,
    registrationNumber: 'CY-CLM001',
    coverRequired: 'Comprehensive',
    vehicleType: 'Car',
  });
  const policyWithClaimNumber = await generatePolicyId();
  const claimQuoteResponse = calculateAutoInsuranceQuoteResponse(claimQuoteData, undefined, { reference: policyWithClaimNumber, currency: 'EUR' });
  const claimTotalPremium = (claimQuoteResponse?.primaryOption?.costDetails?.totalPremium || claimQuoteResponse?.primaryOption?.annualPremium || 0);
  const policyWithOpenClaim = await tenantScopedPrisma.policy.create({
    data: {
      operatingTenantId: TENANT_IDS.CY,
      policyNumber: policyWithClaimNumber,
      productType: 'MOTOR',
      status: 'ACTIVE',
      inceptionDate: claimStart,
      expiryDate: claimEnd,
      policyHolderId: ph.id,
      binderId: motorPolicyBinder.id,
      programId: program.id,
      quoteData: toInputJson(claimQuoteData),
      vehicleInfo: toInputJson(buildVehicleInfoFromQuoteData(claimQuoteData)),
      driverInfo: toInputJson(buildDriverInfoFromQuoteData(claimQuoteData)),
      quoteResponse: toInputJson(claimQuoteResponse),
      stateCurrent: {
        create: {
          operatingTenantId: TENANT_IDS.CY,
          snapshot: toInputJson({
            quoteData: claimQuoteData,
            quoteResponse: claimQuoteResponse,
            step: 'service',
            flow_context: { channel: 'backoffice', step: 'service' },
            premium: claimTotalPremium,
            claims: {
              latestStatus: 'OPEN',
              latestIncidentDate: claimIncidentAt.toISOString().slice(0, 10),
            },
          }),
        },
      },
      searchIndex: {
        create: {
          operatingTenantId: TENANT_IDS.CY,
          policyNumber: policyWithClaimNumber,
          insuredName: ph.name,
          status: 'ACTIVE',
          totalPremium: claimTotalPremium,
        },
      },
    },
  });
  await createSeedInceptionRiskTransaction({
    policyId: policyWithOpenClaim.id,
    programId: program.id,
    binderId: motorPolicyBinder.id,
    inceptionDate: new Date(policyWithOpenClaim.inceptionDate),
    expiryDate: policyWithOpenClaim.expiryDate ? new Date(policyWithOpenClaim.expiryDate) : null,
    snapshot: {
      quoteData: claimQuoteData,
      quoteResponse: claimQuoteResponse,
      step: 'service',
      flow_context: { channel: 'backoffice', step: 'service' },
      premium: claimTotalPremium,
      claims: {
        latestStatus: 'OPEN',
        latestIncidentDate: claimIncidentAt.toISOString().slice(0, 10),
      },
    },
  });
  await tenantScopedPrisma.claim.create({
    data: {
      operatingTenantId: TENANT_IDS.CY,
      policyId: policyWithOpenClaim.id,
      claimNumber: makeClaimNumber('OPEN'),
      incidentDate: claimIncidentAt,
      status: 'OPEN',
      claimType: 'MOTOR',
      description: 'Seed open claim for FNOL and Claims Desk lifecycle testing.',
      data: toInputJson({
        fnol: {
          submittedAt: new Date().toISOString(),
          incidentType: 'accident',
          thirdPartyInvolved: true,
        },
        claimFormPackage: {
          status: 'OPEN',
        },
      }),
      amountReserved: 1500,
      amountPaid: 0,
      documents: toInputJson([]),
    },
  });
  logger.info(`✅ Created Active Policy with Open Claim: ${policyWithOpenClaim.policyNumber}`);
}

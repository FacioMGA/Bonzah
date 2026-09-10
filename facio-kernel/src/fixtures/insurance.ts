import type { Scope } from '../contracts/configuration.js';
import { runtimePolicySchema, type ScopedRuntimePolicy } from '../contracts/insurance.js';
import { hash } from '../domain/canonical.js';

// Synthetic capability exercise. This is neither an approved product nor a signed release.
export const runtimeDemoScope: Scope = {
  workspaceId: 'local',
  tenantId: 'runtime-demo',
  environment: 'development',
  operatingEntityId: 'synthetic-entity',
};
const policy = runtimePolicySchema.parse({
  id: 'manual-placement',
  version: '1.0.0',
  name: 'Synthetic manual placement',
  currency: 'GBP',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2030-12-31',
  maximumPremiumMinor: '100000000',
  maximumParticipants: 10,
  commission: {
    rateBps: 1000,
    base: 'gross_premium',
    recipientId: 'synthetic-broker',
    settlementPartyId: 'synthetic-settlement',
    cashCustody: 'external',
  },
  requirements: {
    payment: 'not_required',
    approval: 'not_required',
    providerVerification: 'not_required',
  },
});

export const runtimeDemoPolicies: ScopedRuntimePolicy[] = [
  { scope: runtimeDemoScope, policy, policyHash: hash(policy) },
];

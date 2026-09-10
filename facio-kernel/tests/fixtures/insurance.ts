import { randomUUID } from 'node:crypto';
import type { Context } from '../../src/contracts/configuration.js';
import type { ScopedRuntimePolicy, ExternalQuote } from '../../src/contracts/insurance.js';
import { hash } from '../../src/domain/canonical.js';
import { referenceScope } from '../../src/fixtures/reference.js';

export const insuranceContext: Context = {
  ...referenceScope,
  actorId: 'operator',
  permissions: ['insurance:read', 'insurance:quote', 'insurance:bind', 'insurance:service'],
  correlationId: randomUUID(),
};
export const runtimePolicy: ScopedRuntimePolicy['policy'] = {
  id: 'manual-placement',
  version: '1.0.0',
  name: 'Synthetic manual placement',
  currency: 'GBP',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2027-12-31',
  maximumPremiumMinor: '999999999999999999',
  maximumParticipants: 10,
  commission: {
    rateBps: 1000,
    base: 'gross_premium',
    recipientId: 'broker',
    settlementPartyId: 'settlement',
    cashCustody: 'external',
  },
  requirements: {
    payment: 'not_required',
    approval: 'not_required',
    providerVerification: 'not_required',
  },
};
export const scopedRuntimePolicy: ScopedRuntimePolicy = {
  scope: referenceScope,
  policy: runtimePolicy,
  policyHash: hash(runtimePolicy),
};
export const externalQuote: ExternalQuote = {
  sourceQuote: {
    reference: 'external-test-quote',
    version: '1',
    evidenceRefs: ['evidence://synthetic/quote-1'],
  },
  risk: { summary: 'Synthetic risk for local lifecycle verification', externalRiskReference: null },
  term: { startDate: '2026-09-01', endDate: '2026-09-30' },
  expiresAt: '2026-09-15T12:00:00.000Z',
  eligibility: 'quote_ready',
  premiumMinor: '10001',
  participants: [
    { id: 'lead-market', role: 'lead', shareBps: 6000 },
    { id: 'follow-market', role: 'follow', shareBps: 4000 },
  ],
};
export const testNow = () => new Date('2026-09-10T12:00:00.000Z');

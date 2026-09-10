import { describe, it, expect } from 'vitest';
import {
    mapPolicyToVM,
    mapBootstrapToVM,
    mapDocumentsToVM,
    mapFeedEventsToVM,
} from './dashboardMapper';
import type { PolicyDTO, DocumentDTO, FeedEventDTO, DashboardBootstrapDTO } from '../../types/dashboard.contract';

describe('dashboardMapper', () => {
    // ─── mapPolicyToVM ───

    describe('mapPolicyToVM', () => {
        it('maps a minimal PolicyDTO with safe defaults', () => {
            const dto: PolicyDTO = { id: 'pol-1', status: 'ISSUED' };
            const vm = mapPolicyToVM(dto);

            expect(vm.key).toBe('pol-1');
            expect(vm.vehicleTitle).toBe('Insurance Policy');
            expect(vm.registration).toBe('Registration unavailable');
            expect(vm.currency).toBe('EUR');
            expect(vm.drivers).toHaveLength(1);
            expect(vm.drivers[0].isPrimary).toBe(true);
            expect(vm.excess.total).toBe(0);
            expect(vm.premium).toBe(0);
            expect(vm.mileage).toBe('—');
            expect(vm.parking).toBe('Not declared');
            expect(vm.country).toBe('Cyprus');
            expect(vm.outstandingBalance).toBe(0);
            expect(vm.paymentStatus).toBe('');
            expect(vm.paymentMethodLabel).toBe('');
        });

        it('extracts vehicle title from quoteData', () => {
            const dto: PolicyDTO = {
                id: 'pol-2',
                status: 'ISSUED',
                quoteData: { make: 'Toyota', model: 'Corolla', year: '2023' },
            };
            const vm = mapPolicyToVM(dto);
            expect(vm.vehicleTitle).toBe('2023 Toyota Corolla');
        });

        it('prefers policyId over id for key', () => {
            const dto: PolicyDTO = { id: 'id-fallback', policyId: 'pid-primary', status: 'ISSUED' };
            expect(mapPolicyToVM(dto).key).toBe('pid-primary');
        });

        it('normalizes currency to EUR for unknown codes', () => {
            const dto: PolicyDTO = { id: 'pol-3', currency: 'JPY' };
            expect(mapPolicyToVM(dto).currency).toBe('EUR');
        });

        it('normalizes known currencies correctly', () => {
            expect(mapPolicyToVM({ id: 'a', currency: 'USD' }).currency).toBe('USD');
            expect(mapPolicyToVM({ id: 'b', currency: 'GBP' }).currency).toBe('GBP');
            expect(mapPolicyToVM({ id: 'c', currency: 'eur' }).currency).toBe('EUR');
        });

        it('detects expired policies by status', () => {
            const dto: PolicyDTO = { id: 'exp', status: 'EXPIRED' };
            expect(mapPolicyToVM(dto).isPast).toBe(true);
        });

        it('detects cancelled policies by status', () => {
            const dto: PolicyDTO = { id: 'can', status: 'CANCELLED' };
            const vm = mapPolicyToVM(dto);
            expect(vm.isPast).toBe(true);
            expect(vm.statusMeta.tone).toBe('canceled');
        });

        it('prefers issued inception date over quote start date for policy period', () => {
            const vm = mapPolicyToVM({
                id: 'date-mismatch',
                status: 'ACTIVE',
                startDate: '2026-05-08',
                inceptionDate: '2026-05-09T00:01:00.000Z',
                expiryDate: '2027-05-09T12:00:00.000Z',
            });

            expect(vm.startDate).toBe('2026-05-09T00:01:00.000Z');
        });

        it('builds payment method label from quoteData', () => {
            const dto: PolicyDTO = {
                id: 'pay',
                quoteData: { cardLast4: '4242', cardBrand: 'Visa' },
            };
            expect(mapPolicyToVM(dto).paymentMethodLabel).toBe('Visa •••• 4242');
        });

        it('uses canonical policy payment data instead of quote answers', () => {
            const vm = mapPolicyToVM({
                id: 'payment-state',
                paymentStatus: 'pending',
                outstandingBalance: 161.25,
                quoteData: { outstandingBalance: 0 },
            });

            expect(vm.paymentStatus).toBe('PENDING');
            expect(vm.outstandingBalance).toBe(161.25);
        });

        it('extracts drivers from quoteData', () => {
            const dto: PolicyDTO = {
                id: 'drv',
                quoteData: {
                    proposer: {
                        firstName: 'John',
                        lastName: 'Doe',
                    },
                    licenseYears: '5',
                    additionalDrivers: [
                        { firstName: 'Jane', lastName: 'Doe', licenseYears: '3' },
                    ],
                },
            };
            const vm = mapPolicyToVM(dto);
            expect(vm.drivers).toHaveLength(2);
            expect(vm.drivers[0].fullName).toBe('John Doe');
            expect(vm.drivers[0].isPrimary).toBe(true);
            expect(vm.drivers[1].fullName).toBe('Jane Doe');
            expect(vm.drivers[1].isPrimary).toBe(false);
        });

        it('maps parking label from quoteData', () => {
            expect(mapPolicyToVM({ id: 'a', quoteData: { parking: 'locked_garage' } }).parking).toBe('Locked garage');
            expect(mapPolicyToVM({ id: 'b', quoteData: { parking: 'STREET' } }).parking).toBe('Street');
            expect(mapPolicyToVM({ id: 'c', quoteData: { parking: 'DRIVEWAY' } }).parking).toBe('Driveway');
        });

        it('falls back to policy-level premium when quote cost premium is zero', () => {
            const dto: PolicyDTO = {
                id: 'pol-premium-fallback',
                status: 'ISSUED',
                totalPremium: 729.41,
                quoteResponse: {
                    primaryOption: {
                        costDetails: { totalPremium: 0 },
                        annualPremium: 0,
                    },
                },
            };
            expect(mapPolicyToVM(dto).premium).toBe(729.41);
        });

        it('falls back to risk transaction pricingFinal premium when top-level premium is missing', () => {
            const dto: PolicyDTO & { riskTransactions: unknown[] } = {
                id: 'pol-premium-risktx',
                status: 'ISSUED',
                quoteResponse: { primaryOption: { costDetails: { totalPremium: 0 }, annualPremium: 0 } },
                riskTransactions: [
                    { status: 'BOUND', pricingFinal: '{"premium":518.73}', premiumTransactions: [] },
                ],
            };
            expect(mapPolicyToVM(dto).premium).toBe(518.73);
        });

        it('uses latest positive premium from transaction history when newest tx is zero', () => {
            const dto: PolicyDTO & { riskTransactions: unknown[] } = {
                id: 'pol-premium-risktx-history',
                status: 'ACTIVE',
                quoteResponse: { primaryOption: { costDetails: { totalPremium: 0 }, annualPremium: 0 } },
                riskTransactions: [
                    {
                        status: 'BOUND',
                        transactionType: 'ENDORSEMENT',
                        createdAt: '2026-03-15T13:38:37.427Z',
                        pricingFinal: '{"premium":0}',
                        premiumTransactions: [{ grossPremium: '0' }],
                    },
                    {
                        status: 'BOUND',
                        transactionType: 'ENDORSEMENT',
                        createdAt: '2026-03-15T13:27:18.346Z',
                        pricingFinal: '{"premium":523.37}',
                        premiumTransactions: [{ grossPremium: '523.37' }],
                    },
                ],
            };
            expect(mapPolicyToVM(dto).premium).toBe(523.37);
        });

        it('maps vehicle use label from quoteData', () => {
            expect(mapPolicyToVM({ id: 'a', quoteData: { vehicleUse: 'SDP' } }).vehicleUse).toBe('Social, Domestic & Pleasure');
            expect(mapPolicyToVM({ id: 'b', quoteData: { vehicleUse: 'social_domestic' } }).vehicleUse).toBe('Social, Domestic & Pleasure');
        });
    });

    // ─── mapBootstrapToVM ───

    describe('mapBootstrapToVM', () => {
        it('filters out pre-bind policies', () => {
            const dto: DashboardBootstrapDTO = {
                policies: [
                    { id: 'a', status: 'ISSUED' },
                    { id: 'b', status: 'DRAFT' },
                    { id: 'c', status: 'QUOTED' },
                    { id: 'd', status: 'ACTIVE' },
                ],
                claims: [],
            };
            const vm = mapBootstrapToVM(dto);
            const keys = vm.policies.map((p) => p.key);
            expect(keys).toContain('a');
            expect(keys).toContain('d');
            expect(keys).not.toContain('b');
            expect(keys).not.toContain('c');
        });

        it('maps claims with hasClaimForm flag', () => {
            const dto: DashboardBootstrapDTO = {
                policies: [],
                claims: [
                    { id: 'clm-1', status: 'OPEN', claimNumber: 'CLM-001', policyId: 'pol-1' },
                ],
            };
            const vm = mapBootstrapToVM(dto);
            expect(vm.claims).toHaveLength(1);
            expect(vm.claims[0].id).toBe('clm-1');
            expect(vm.claims[0].claimNumber).toBe('CLM-001');
        });
    });

    // ─── mapDocumentsToVM ───

    describe('mapDocumentsToVM', () => {
        it('maps documents with type labels', () => {
            const docs: DocumentDTO[] = [
                { id: 'd1', type: 'CERTIFICATE_OF_INSURANCE', publicUrl: 'https://example.com/cert.pdf' },
                { id: 'd2', type: 'POLICY_SCHEDULE', publicUrl: 'https://example.com/schedule.pdf' },
                { id: 'd3', type: 'IPID_KEY_FACTS', publicUrl: 'https://example.com/ipid.pdf' },
                { id: 'd4', type: 'HOME_POLICY_WORDING_PDF', publicUrl: 'https://example.com/wording.pdf' },
            ];
            const vms = mapDocumentsToVM(docs, null);
            expect(vms[0].typeLabel).toBe('Certificate');
            expect(vms[1].typeLabel).toBe('Policy Schedule');
            expect(vms[2].typeLabel).toBe('IPID (Key Facts)');
            expect(vms[3].typeLabel).toBe('Policy Wording');
        });

        it('uses publicUrl as href when no auth token is available', () => {
            const docs: DocumentDTO[] = [
                { id: 'd1', publicUrl: 'https://public.url/doc.pdf', storageUri: '/api/documents/123' },
            ];
            expect(mapDocumentsToVM(docs, null)[0].href).toBe('https://public.url/doc.pdf');
        });

        it('prefers secure storageUri over publicUrl when the client session is authenticated', () => {
            const docs: DocumentDTO[] = [
                {
                    id: 'd1',
                    publicUrl: '/api/public/documents/doc-1',
                    storageUri: '/api/documents/schedule.pdf',
                },
            ];
            expect(mapDocumentsToVM(docs, 'session-jwt')[0].href).toBe('/api/documents/schedule.pdf');
        });

        it('does not append query-string tokens to storage URIs', () => {
            const docs: DocumentDTO[] = [
                { id: 'd1', storageUri: '/api/documents/123' },
            ];
            const vms = mapDocumentsToVM(docs, 'my-token');
            expect(vms[0].href).toBe('/api/documents/123');
            expect(vms[0].href).not.toContain('token=');
        });

        it('does NOT append token to external URIs', () => {
            const docs: DocumentDTO[] = [
                { id: 'd1', storageUri: 'https://cdn.example.com/doc.pdf' },
            ];
            const vms = mapDocumentsToVM(docs, 'my-token');
            expect(vms[0].href).toBe('https://cdn.example.com/doc.pdf');
        });

        it('handles missing auth token for storage URIs', () => {
            const docs: DocumentDTO[] = [
                { id: 'd1', storageUri: '/api/documents/456' },
            ];
            const vms = mapDocumentsToVM(docs, null);
            expect(vms[0].href).toBe('/api/documents/456');
        });
    });

    // ─── mapFeedEventsToVM ───

    describe('mapFeedEventsToVM', () => {
        it('maps known action names into activity items', () => {
            const events: FeedEventDTO[] = [
                { id: 'e1', actionName: 'POLICY.ISSUED', occurredAt: '2025-01-01' },
                { id: 'e2', actionName: 'ENDORSEMENT.CREATED', occurredAt: '2025-01-02', diff: { reason: 'Address change' } },
                { id: 'e3', actionName: 'CANCELLATION.REQUESTED', occurredAt: '2025-01-03' },
                { id: 'e4', actionName: 'CLAIM.SUBMITTED', occurredAt: '2025-01-04' },
            ];
            const vms = mapFeedEventsToVM(events);
            expect(vms).toHaveLength(4);
            expect(vms[0].title).toBe('Policy issued');
            expect(vms[1].title).toBe('Endorsement created');
            expect(vms[1].detail).toBe('Reason: Address change');
            expect(vms[2].title).toBe('Cancellation requested');
            expect(vms[3].title).toBe('First notice of loss submitted');
        });

        it('filters out unknown action names', () => {
            const events: FeedEventDTO[] = [
                { id: 'e1', actionName: 'UNKNOWN.ACTION' },
                { id: 'e2', actionName: 'POLICY.ISSUED' },
            ];
            const vms = mapFeedEventsToVM(events);
            expect(vms).toHaveLength(1);
            expect(vms[0].title).toBe('Policy issued');
        });

        it('generates fallback id from action + occurredAt', () => {
            const events: FeedEventDTO[] = [
                { actionName: 'POLICY.ISSUED', occurredAt: '2025-06-01' },
            ];
            const vms = mapFeedEventsToVM(events);
            expect(vms[0].id).toBe('POLICY.ISSUED-2025-06-01');
        });
    });
});

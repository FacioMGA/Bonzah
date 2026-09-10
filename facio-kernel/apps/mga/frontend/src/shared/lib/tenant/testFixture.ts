import type { SelectedTenant } from './runtimeProfile';
/** Source-free frontend presentation fixture. It does not grant server access. */
export function presentationTenant(id = 'tenant-alpha', name = 'Training Alpha'): SelectedTenant {
  return {
    id,
    tenantSlug: id,
    displayName: name,
    role: 'ADMIN',
    accountScopeId: 'account-' + id,
    profile: {
      countryCode: 'CY',
      country: 'Cyprus',
      currency: 'EUR',
      legalPack: 'synthetic-home-cy',
      publicBaseUrl: 'https://training.invalid',
      fromEmail: 'sender@training.invalid',
      brandLogo: { white: '', blue: '' },
      runtimeSettings: {
        schemaVersion: 'tenant-runtime-v1',
        contact: { email: id + '@training.invalid', phone: '+357 20000000' },
        routing: {
          underwritingReferralTo: ['review@training.invalid'],
          underwritingReferralCc: [],
          onlinePolicyConfirmationCopies: [],
        },
        branding: {
          displayName: name,
          legalName: name + ' Limited',
          addressLines: ['Training office'],
          legalLines: ['Synthetic training'],
          regulatorLine: null,
          websiteUrl: null,
          websiteLabel: null,
          primaryColor: '#236789',
        },
      },
    },
  };
}

import { BONZAH_DEMO_RULES } from './pricing/demoConfig.js';

/** Synthetic records used by the in-memory demo boundary (ADR-0094). */
export const bonzahDemoFixtures = {
  tenant: { id: 'tenant-bonzah-us-demo', name: 'Bonzah US — DEMO BUILD', country: 'US', synthetic: true },
  program: { id: 'BONZAH-US-DEMO-2026', productType: 'RENTAL', name: 'Rental Protection — DEMO BUILD', effectiveDate: BONZAH_DEMO_RULES.effectiveDate },
  binderAuthority: { id: 'binder-bonzah-demo', programId: 'BONZAH-US-DEMO-2026', currency: 'USD', maxVehicleValue: 60_000, highValueOutcome: 'REFER' },
  partner: { id: 'summit-rentals-demo', name: 'Summit Rentals — fictional partner', channel: 'EMBEDDED_API' },
  rules: BONZAH_DEMO_RULES,
} as const;

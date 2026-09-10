/**
 * Scenario pack fixtures for the Classic Car demo (Phase 2). Each
 * scenario is a quoteData payload + the expected outcome (referral,
 * decline, accept). `runDemoScenarioPack` iterates these and dispatches
 * through the canonical motor adapter so the demo proves the published
 * draft would behave correctly end-to-end.
 *
 * NOTE: fields here MUST live in the canonical motor manifest
 * (packages/products/src/motor/manifest.ts). No new questionnaire
 * fields are introduced — V1 cannot add them.
 */

export interface DemoScenario {
    name: string;
    description: string;
    quoteData: Record<string, unknown>;
    expectedOutcome: 'accept' | 'referral' | 'decline';
}

const baseQuoteData: Record<string, unknown> = {
    productType: 'MOTOR',
    proposer: { dateOfBirth: '1970-01-01' },
    licenseType: 'Full',
    licenseYears: 30,
    youngestDriverAge: 50,
    countryOfRegistration: 'Cyprus',
    vehicleLocation: 'Cyprus',
    vehicleType: 'Classic',
    classicIsGenuine: true,
    classicIsSecondaryVehicle: true,
    fuelType: 'Petrol',
    engineSize: 1800,
    vehicleValue: 35000,
    hasClaims: false,
    claimsCountLast5Years: 0,
    maxFaultClaimCostLast5Years: 0,
    garageTotalValue: 50000,
    hasMajorConvictionLast5Years: false,
};

export const classicCarScenarioPack: DemoScenario[] = [
    {
        name: 'clean-classic',
        description: '1970s classic, declared €35,000, experienced owner, no claims — should accept.',
        quoteData: { ...baseQuoteData },
        expectedOutcome: 'accept',
    },
    {
        name: 'high-value-classic',
        description: 'Declared value €120,000 — should decline (Classic Car cap is €100,000).',
        quoteData: { ...baseQuoteData, vehicleValue: 120000 },
        expectedOutcome: 'decline',
    },
    {
        name: 'young-driver',
        description: 'Added driver aged 22 — should refer.',
        quoteData: { ...baseQuoteData, youngestDriverAge: 22 },
        expectedOutcome: 'referral',
    },
    {
        name: 'prior-claims',
        description: '3 claims in last 5 years — should decline (count over canonical hard-stop).',
        quoteData: {
            ...baseQuoteData,
            hasClaims: true,
            claimsCountLast5Years: 3,
            maxFaultClaimCostLast5Years: 2500,
        },
        expectedOutcome: 'decline',
    },
    {
        name: 'missing-required-country',
        description: 'No registration country — should refer (validation auto-refer rule).',
        quoteData: { ...baseQuoteData, countryOfRegistration: '', vehicleLocation: '' },
        expectedOutcome: 'decline',
    },
];

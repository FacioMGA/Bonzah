import type { ProductLaunchTemplate } from '../../domain/templateDefinition.js';

/**
 * Classic Car template — V1 demo target. Leverages existing motor
 * scaffolding (rate dataset at
 * `backend/products/motor/pricing/data/classic-car-rates.json`, factor
 * lookups in `classicPricing.ts`) and only diverges via
 * `Program.metadata` overrides plus a tightened `BinderProductAuthority`
 * scope on publish. No new product line is created — the canonical
 * adapter is the existing `MotorProductAdapter`.
 *
 * The demo prompt:
 *   "Create a Classic Car variant of motor. Owners aged 30+ only, refer
 *    drivers under 25, decline classic cars valued over €100,000, decline
 *    if more than one fault claim in the last 3 years. Only allow
 *    occasional/weekend use. Require certificate and schedule on bind,
 *    green card on request. Payment must be received before bind.
 *    Commission is 12.5%. Cancellations are pro-rata; admin fee
 *    non-refundable."
 *
 * The seedDelta below is the empty starting point — the agent
 * accumulates the actual overrides via the write tools (referral rules,
 * documents, billing). We deliberately do NOT pre-bake the demo answers
 * into the template, so the demo flow shows the tool calls happening
 * live in the BO Product Architect view.
 */
export const classicCarTemplate: ProductLaunchTemplate = {
    templateId: 'classic-car',
    name: 'Classic Car (Motor variant)',
    vertical: 'Personal motor — classic / collectible',
    description:
        'Classic Car variant of the motor product. Uses the existing motor adapter and the canonical ' +
        'classic-car rate dataset (backend/products/motor/pricing/data/classic-car-rates.json). ' +
        'Differences from base motor are expressed entirely as Program.metadata overrides plus a ' +
        'tightened BinderProductAuthority on publish — no new product line, no manifest changes, ' +
        'no new pricing leaf.',
    productCode: 'MOTOR',
    supportedCapabilities: [
        'questionnaire-overlay',
        'underwriting-thresholds',
        'mbe-coverage-selection',
        'document-overlay',
        'commercial-terms',
        'binder-authority-caps',
    ],
    seedDelta: {
        // Marker so the publish step can tag the published Program with
        // its provenance template id without re-reading the draft.
        // The actual seed is intentionally empty — agent tools will
        // accumulate the demo prompt's referral rules + documents +
        // billing live, making the tool call sequence visible.
    },
    defaultBinder: {
        agreementNumber: 'CLASSIC-CAR-SANDBOX-2026',
        umr: 'B6081 CLASSIC-CAR-SANDBOX-2026',
        coverholderName: 'Abbeygate UW Ltd. (Classic Car Sandbox)',
        coverholderPin: 'CLASSIC0001',
        classOfBusiness: 'MOTOR',
        riskCode: 'MC',
        authorityClasses: ['TPBI', 'TPPD', 'OD'],
        territorialScope: ['CY'],
    },
    nextRecommendedSteps: [
        'Add referral rules for high-value vehicles, young drivers, and prior fault claims.',
        'Restrict allowed vehicle uses to occasional/weekend.',
        'Configure documents: certificate + schedule on bind, green card on request.',
        'Set commission, payment terms, and cancellation refund basis.',
        'Validate, run the Classic Car scenario pack, then publish to sandbox.',
    ],
};

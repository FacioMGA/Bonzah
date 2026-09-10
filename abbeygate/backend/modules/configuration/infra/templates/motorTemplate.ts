import type { ProductLaunchTemplate } from '../../domain/templateDefinition.js';

/**
 * Base motor template. Clones produce a draft mirroring the canonical
 * motor program defaults — no overrides at clone time. Used as the
 * comparison base when the agent (or BO) reasons about diff size.
 */
export const motorTemplate: ProductLaunchTemplate = {
    templateId: 'motor-base',
    name: 'Motor — Base',
    vertical: 'Personal motor',
    description:
        'Standard private motor template (Abbeygate Cyprus baseline). Uses the canonical Abbeygate motor binder, ' +
        'default underwriting thresholds, and the standard quote/bind/endorsement workflow set.',
    productCode: 'MOTOR',
    supportedCapabilities: [
        'questionnaire-overlay',
        'underwriting-thresholds',
        'mbe-coverage-selection',
        'document-overlay',
        'commercial-terms',
        'binder-authority-caps',
    ],
    seedDelta: {},
    nextRecommendedSteps: [
        'Review default referral thresholds and tighten for your target risk profile.',
        'Choose MBE coverage options that are on by default vs offered as upgrades.',
        'Confirm commission and admin fee for the binder.',
    ],
};

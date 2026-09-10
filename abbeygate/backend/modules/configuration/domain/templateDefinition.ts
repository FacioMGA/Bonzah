import type { DraftDelta } from './draftDelta.js';

/**
 * A template is a starting point for a Config MCP draft. Cloning a
 * template creates a new draft pre-populated with the template's
 * `seedDelta`. Templates are code-defined (motor today; classic-car
 * variant for the V1 demo) — adding a new template is currently a
 * code change.
 */
export interface ProductLaunchTemplate {
    templateId: string;
    name: string;
    vertical: string;
    description: string;
    productCode: string;
    /** Capabilities the template supports out-of-the-box. */
    supportedCapabilities: string[];
    /** Default delta applied when the template is cloned. */
    seedDelta: DraftDelta;
    /**
     * Concrete BinderProductAuthority shape the publish step will use
     * when staging the binder authority row. Empty for templates that
     * inherit from the base motor binder unchanged.
     */
    defaultBinder?: {
        agreementNumber: string;
        umr: string;
        coverholderName: string;
        coverholderPin: string;
        classOfBusiness: string;
        riskCode: string;
        authorityClasses: string[];
        territorialScope: string[];
    };
    /** Human-readable next-step prompts surfaced after clone. */
    nextRecommendedSteps: string[];
}

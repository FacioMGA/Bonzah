
import { EndorsementTemplate, ValidationRequest, ValidationResult, PrerequisiteRule, EndorsementEffect } from './types.js';
import type { EndorsementCatalog } from './registry.js';

import { logger } from '../../../platform/utils/logger.js';
type UnknownRecord = Record<string, unknown>;
const asRecord = (v: unknown): UnknownRecord =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as UnknownRecord) : {};

export class MagicBRulesEngine {

    /**
     * Validate a candidate endorsement against a policy context.
     *
     * The `catalog` is the product-scoped `EndorsementCatalog` the policy lives
     * in; it is used to look up existing endorsement templates by code for the
     * reverse-exclusion check (`existing.disallowed_with.includes(candidate)`).
     * Supplying the wrong catalog would mix product rules — callers must pass
     * the catalog that was used to resolve `template`.
     */
    static validate(
        template: EndorsementTemplate,
        req: ValidationRequest,
        existingEndorsements: string[],
        catalog: EndorsementCatalog,
    ): ValidationResult {
        const messages: string[] = [];
        let valid = true;

        // 1. Check prerequisites
        for (const pre of template.rules.prerequisites) {
            if (!this.evaluatePrerequisite(pre, req)) {
                valid = false;
                messages.push(pre.message);
            }
        }

        // 2. Check exclusions
        for (const existingCode of existingEndorsements) {
            // Check if THIS template forbids EXISTING
            if (template.disallowed_with.includes(existingCode)) {
                valid = false;
                messages.push(`Conflict: ${template.code} is not allowed with ${existingCode}`);
            }
            // Check if EXISTING template forbids THIS
            const existingTemplate = catalog.get(existingCode);
            if (existingTemplate && existingTemplate.disallowed_with.includes(template.code)) {
                valid = false;
                messages.push(`Conflict: ${existingCode} is not allowed with ${template.code}`);
            }
        }

        return { valid, messages, blocking: !valid };
    }

    private static evaluatePrerequisite(rule: PrerequisiteRule, req: ValidationRequest): boolean {
        const { policySnapshot, targetId } = req;
        const existingEndorsements: string[] = Array.isArray(req?.existingEndorsements) ? req.existingEndorsements : [];
        const snapshot = asRecord(policySnapshot);

        switch (rule.type) {
            case 'vehicle_property': {
                const vehicle = this.findVehicle(snapshot, targetId);
                if (!vehicle) return false;

                const val = vehicle[rule.key!]; // e.g. body_type
                if (rule.in) {
                    return rule.in.includes(val);
                }
                if (rule.value !== undefined) {
                    return val === rule.value;
                }
                return true;
            }

            case 'policy_has_territory': {
                // Assuming policySnapshot has 'territories' array or we check logic
                // If quoteData doesn't explicitly have territories, we might default to 'EU' or check 'territory_scope'
                const territories = Array.isArray(snapshot.territories) ? snapshot.territories : ['CY', 'EU'];
                if (Array.isArray(rule.value)) {
                    return rule.value.some((t: string) => territories.includes(t));
                }
                return territories.includes(rule.value);
            }

            case 'policy_flag': {
                const flags = asRecord(snapshot.flags);
                const actual = snapshot[rule.key!] ?? flags[rule.key!];
                return actual === rule.value;
            }

            case 'vehicle_level':
            case 'risk_object_level':
                // Requires targetId to be present (Vehicle Scope)
                return !!targetId;

            case 'endorsement_present': {
                const wanted = String(rule?.value || '').trim();
                if (!wanted) return true;
                return existingEndorsements.includes(wanted);
            }

            default:
                logger.warn(`[MBE] Unknown rule type: ${rule.type}`);
                return true;
        }
    }

    private static findVehicle(snapshot: UnknownRecord, targetId?: string): UnknownRecord | null {
        // If snapshot is quoteData, it might have 'vehicles' array or single vehicle fields at root?
        // Abbeygate Motor is often single vehicle in the simple quote flow, but data model supports multi?
        // Let's support both.

        if (targetId && Array.isArray(snapshot.vehicles)) {
            const match = snapshot.vehicles.find((v) => asRecord(v).id === targetId);
            return match ? asRecord(match) : null;
        }

        // Fallback: treat root as vehicle data if single vehicle policy
        // Check if root has vehicle-like props
        if (snapshot.vehicleValue || snapshot.make || snapshot.year) {
            return snapshot;
        }

        return null;
    }

    /**
     * Compute the net effects of a list of applied endorsements.
     * Useful for Pricing Engine.
     */
    static computeCombinedEffects(
      instances: { template: EndorsementTemplate; params: UnknownRecord }[],
      policySnapshot: UnknownRecord
    ): EndorsementEffect[] {
        const effects: EndorsementEffect[] = [];

        for (const inst of instances) {
            const context = { ...policySnapshot, ...inst.params }; // Merge params into context for conditionals

            for (const effect of inst.template.rules.effects) {
                if (effect.type === 'CONDITIONAL_EFFECT') {
                    // Evaluate condition
                    if (this.evaluateCondition(effect.condition, context)) {
                        effects.push(effect.effect);
                    }
                } else {
                    effects.push(effect);
                }
            }
        }

        return effects;
    }

    private static evaluateCondition(condition: unknown, context: UnknownRecord): boolean {
        const conditionRecord = asRecord(condition);
        if (conditionRecord.type === 'in_territory') {
            // Check context territory
            const currentTerritory = String(context.territory_scope || 'CY');
            return currentTerritory === String(conditionRecord.territory || '');
        }
        return true;
    }
}

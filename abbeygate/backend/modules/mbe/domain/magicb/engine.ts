import { Registry } from './registry.js';
import { executeRule } from './rules/index.js';
import { MagicBContext, ComplianceMatrix, ValidationResult, type RuleOp } from './types.js';
import { conditionsMatch, type ContextFilter } from './context-matcher.js';

type UnknownRecord = Record<string, unknown>;
type RuleCandidate = {
  id: string;
  slug: string;
  ruleBody: RuleOp;
  contextFilter?: unknown;
  severity: string;
};

export class MagicBEngine {

    /**
     * The Main Brain.
     * Validates a dataset against all applicable rules for the given context.
     * @param rulesOverride Optional list of rules to use instead of Registry (for Versioning/Testing)
     */
    validate(context: MagicBContext, data: UnknownRecord, rulesOverride?: RuleCandidate[]): ComplianceMatrix {
        const results: ValidationResult[] = [];
        const missingSlugs: string[] = [];

        // 1. Get all rules
        const allRules = rulesOverride || Registry.getCandidateRules(context);

        // 2. Filter applicable rules based on Context
        const applicableRules = allRules.filter(r => this.isRuleApplicable(r.contextFilter, context));

        // 3. Execute
        for (const rule of applicableRules) {
            const value = this.getValueForSlug(data, rule.slug); // Simplify: Assume flat k/v for MVP or deep obj

            // If value is missing and rule is REQUIRED, flag it
            if (value === undefined || value === null || value === '') {
                if (rule.ruleBody.op === 'required') {
                    // Check conditional requirement
                    const passed = executeRule(value, rule.ruleBody, context);
                    if (!passed) {
                        results.push({
                            slug: rule.slug,
                            status: 'FAIL',
                            message: `Missing required field: ${rule.slug}`,
                            ruleId: rule.id
                        });
                        missingSlugs.push(rule.slug);
                    }
                }
                continue; // Skip other checks if missing
            }

            // Start Logic Check
            const passed = executeRule(value, rule.ruleBody, context);

            if (!passed) {
                results.push({
                    slug: rule.slug,
                    status: rule.severity === 'BLOCK' ? 'FAIL' : 'WARN',
                    message: `Validation failed for ${rule.slug}: Rule ${rule.ruleBody.op}`,
                    ruleId: rule.id
                });
            } else {
                results.push({ slug: rule.slug, status: 'PASS' });
            }
        }

        const blockingErrors = results.filter(r => r.status === 'FAIL');
        const warnings = results.filter(r => r.status === 'WARN');

        return {
            valid: blockingErrors.length === 0,
            blockingErrors,
            warnings,
            missingSlugs
        };
    }

    /**
     * Simple JSON Matcher for Context filtering.
     * E.g. { "country": "US" } matches context.region = "US"
     */
    /**
     * Delegate to the robust Matcher
     */
    private isRuleApplicable(filter: unknown, context: MagicBContext): boolean {
        return conditionsMatch(filter as ContextFilter | null | undefined, context);
    }

    private getValueForSlug(data: UnknownRecord, slug: string): unknown {
        const def = Registry.getSlug(slug);

        // 1. If explicit binding exists
        if (def && def.binding) {
            if (def.binding.type === 'column') {
                return data[def.binding.value];
            }
            if (def.binding.type === 'json_path') {
                // Simple dot notation support for MVP (pre-parsed where possible)
                const path = def.bindingPathParts || def.binding.value.split('.');
                let current: unknown = data;
                for (const part of path) {
                    if (current === undefined || current === null) return undefined;
                    // Prevent prototype-chain access even if binding was not pre-parsed.
                    if (part === '__proto__' || part === 'prototype' || part === 'constructor') return undefined;
                    if (typeof current !== 'object') return undefined;
                    current = (current as Record<string, unknown>)[part];
                }
                return current;
            }
        }

        // 2. Fallback: Flat lookup by slug name
        return data[slug];
    }
}

export const MagicB = new MagicBEngine();

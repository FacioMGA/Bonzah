/**
 * ValidationIssue shape returned by validateDraft and surfaced to the
 * agent + the launch readiness UI. Mirrors the spec §9.7 envelope.
 */

export type ValidationIssueSeverity = 'info' | 'warning' | 'error';

export interface ValidationIssue {
    code: string;
    severity: ValidationIssueSeverity;
    message: string;
    path?: string;
    suggestedFix?: string;
}

export interface ValidationResult {
    status: 'passed' | 'failed';
    issues: ValidationIssue[];
}

export function summarizeValidation(result: ValidationResult): string {
    const errors = result.issues.filter((i) => i.severity === 'error').length;
    const warnings = result.issues.filter((i) => i.severity === 'warning').length;
    if (result.status === 'passed') {
        return warnings > 0 ? `Validation passed with ${warnings} warning(s).` : 'Validation passed.';
    }
    return `Validation failed: ${errors} error(s), ${warnings} warning(s).`;
}

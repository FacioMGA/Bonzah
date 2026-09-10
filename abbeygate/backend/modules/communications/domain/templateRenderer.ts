/**
 * Template Renderer — CHAMPS Domain Layer
 *
 * Pure function: renders a template string by substituting {{variable}} placeholders.
 * No Prisma, no Express, no side effects.
 */

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export interface TemplateRenderResult {
    rendered: string;
    missingVariables: string[];
    usedVariables: string[];
}

/**
 * Render a template string by substituting {{variable}} placeholders with values.
 *
 * Supports nested access: {{contact.firstName}} → variables.contact.firstName
 * Missing variables are left as-is and reported in the result.
 */
export function renderTemplate(
    template: string,
    variables: Record<string, unknown>,
): TemplateRenderResult {
    const missing: string[] = [];
    const used: string[] = [];

    const rendered = template.replace(VARIABLE_PATTERN, (_match, path: string) => {
        const value = resolvePath(variables, path);
        if (value === undefined || value === null) {
            missing.push(path);
            return `{{${path}}}`;
        }
        used.push(path);
        return String(value);
    });

    return { rendered, missingVariables: missing, usedVariables: used };
}

/**
 * Extract all variable names from a template string.
 */
export function extractVariables(template: string): string[] {
    const vars: string[] = [];
    let match: RegExpExecArray | null;
    const pattern = new RegExp(VARIABLE_PATTERN.source, 'g');
    while ((match = pattern.exec(template)) !== null) {
        if (!vars.includes(match[1])) {
            vars.push(match[1]);
        }
    }
    return vars;
}

/**
 * Validate that all required variables (from variablesSchema) are present in the input.
 */
export function validateVariables(
    variablesSchema: Record<string, unknown>,
    variables: Record<string, unknown>,
): { valid: boolean; missing: string[] } {
    const required = Object.keys(variablesSchema).filter(
        (key) => variablesSchema[key] === 'required',
    );
    const missing = required.filter((key) => {
        const value = resolvePath(variables, key);
        return value === undefined || value === null || value === '';
    });
    return { valid: missing.length === 0, missing };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
    if (Object.prototype.hasOwnProperty.call(obj, path)) {
        return obj[path];
    }
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
        if (current === null || current === undefined || typeof current !== 'object') {
            return undefined;
        }
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

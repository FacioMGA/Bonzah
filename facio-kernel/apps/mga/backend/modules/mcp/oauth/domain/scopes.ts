/**
 * OAuth scope vocabulary (ADR-0040 §5).
 *
 * Scopes are LITERALLY the existing permission keys we already enforce
 * via `requiredPermission` on every tool descriptor — no new vocabulary,
 * no translation layer. When an OAuth access token is validated, its
 * `scope` claim becomes `req.resolvedPermissions` and every existing
 * `authorizeToolCall` check just works.
 *
 * Two families: operator MCP (V1 + V2) and config MCP (V1). The wire
 * metadata endpoints (`/.well-known/oauth-protected-resource/...`)
 * publish the appropriate per-mount narrowed subset.
 */
import {
    CONFIG_AGENT_BASELINE,
    CONFIG_AGENT_OPTIONAL,
    OPERATOR_AGENT_BASELINE,
    OPERATOR_AGENT_OPTIONAL,
} from '../../../accessControl/domain/permissionTaxonomy.js';

export type McpScopeFamily = 'operator' | 'config';

export const OPERATOR_SCOPES: readonly string[] = [
    ...OPERATOR_AGENT_BASELINE,
    ...OPERATOR_AGENT_OPTIONAL,
];

export const CONFIG_SCOPES: readonly string[] = [
    ...CONFIG_AGENT_BASELINE,
    ...CONFIG_AGENT_OPTIONAL,
    'programs.view',
    'programs.edit',
    'programs.publish',
    'binders.view',
    'binders.edit',
    'binders.publish',
];

export const ALL_MCP_SCOPES: readonly string[] = [
    ...OPERATOR_SCOPES,
    ...CONFIG_SCOPES,
];

export function scopesForFamily(family: McpScopeFamily): readonly string[] {
    return family === 'operator' ? OPERATOR_SCOPES : CONFIG_SCOPES;
}

/**
 * Family of a scope as inferred from its dotted prefix. Used by the
 * consent screen to group + by `assertCanGrantScopes` to apply the
 * role-based gate (ADR-0040 §6).
 */
export function familyOfScope(scope: string): McpScopeFamily | 'unknown' {
    if (scope.startsWith('operator.') || scope.startsWith('policies.') || scope.startsWith('documents.')) return 'operator';
    if (
        scope.startsWith('configuration.') ||
        scope.startsWith('programs.') ||
        scope.startsWith('binders.')
    ) return 'config';
    return 'unknown';
}

/**
 * Parse an OAuth `scope` string (space-separated per RFC 6749 §3.3)
 * into the deduplicated list of recognised scope strings. Anything
 * not in `ALL_MCP_SCOPES` is silently dropped — invalid scopes never
 * reach the permission check.
 */
export function parseScopeString(raw: string | null | undefined): string[] {
    const tokens = String(raw || '')
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of tokens) {
        if (!ALL_MCP_SCOPES.includes(t)) continue;
        if (seen.has(t)) continue;
        seen.add(t);
        out.push(t);
    }
    return out;
}

export function serialiseScopes(scopes: readonly string[]): string {
    return scopes.join(' ');
}

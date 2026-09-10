/**
 * MCP resource identifiers (ADR-0040 §8 — RFC 8707 resource binding).
 *
 * The OAuth flow binds every issued token to exactly one MCP mount
 * URL: the `resource` parameter on `/oauth/authorize` and
 * `/oauth/token` MUST match one of these strings, and presenting the
 * token at the OTHER mount is rejected as `cross_resource_use`.
 *
 * Per-tenant: the host portion is the tenant host
 * (e.g. `https://abbeygate-cy.facio.io`), the path portion is fixed.
 */
import { getTenantConfig } from '../../../../platform/tenant/tenantConfig.js';

export type McpMount = 'operator' | 'config';

export interface McpResourceDescriptor {
    mount: McpMount;
    path: string;
    /** Fully-qualified canonical resource URL for the current tenant. */
    url: string;
}

function tenantBaseUrl(): string {
    const tenant = getTenantConfig();
    const base = String(tenant.publicBaseUrl || '').replace(/\/$/, '');
    if (!base) {
        throw new Error(
            '[oauth.resource] Tenant publicBaseUrl is empty — cannot construct resource URL.',
        );
    }
    return base;
}

export function operatorResource(): McpResourceDescriptor {
    return {
        mount: 'operator',
        path: '/api/v1/mcp/operator',
        url: `${tenantBaseUrl()}/api/v1/mcp/operator`,
    };
}

export function configResource(): McpResourceDescriptor {
    return {
        mount: 'config',
        path: '/api/v1/mcp/config',
        url: `${tenantBaseUrl()}/api/v1/mcp/config`,
    };
}

export function allResources(): McpResourceDescriptor[] {
    return [operatorResource(), configResource()];
}

/**
 * Validate a `resource` parameter against the known MCP mounts for
 * THIS tenant. Returns the matched descriptor or null. Rejects:
 *   - empty / missing values
 *   - values pointing at a different tenant's host
 *   - values pointing at a non-MCP path under our host
 *   - trailing slash mismatches (we use the no-slash canonical form)
 */
export function resolveResourceParameter(raw: string | null | undefined): McpResourceDescriptor | null {
    const value = String(raw || '').trim();
    if (!value) return null;
    const normalised = value.replace(/\/+$/, '');
    for (const candidate of allResources()) {
        if (candidate.url === normalised) return candidate;
    }
    return null;
}

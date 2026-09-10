/**
 * RFC 8414 (Authorization Server Metadata) + RFC 9728 (Protected
 * Resource Metadata) builders for the MCP OAuth surface (ADR-0040 §2).
 *
 * Per-tenant: the `issuer` is the tenant host
 * (e.g. `https://abbeygate-cy.facio.io`); every endpoint URL is built
 * off the same base. Cross-tenant isolation is implicit because the
 * tenant ALS context is set by `resolveOperatingTenant` upstream.
 */
import { getTenantConfig } from '../../../../platform/tenant/tenantConfig.js';
import {
    allResources,
    configResource,
    operatorResource,
    type McpMount,
} from '../domain/resource.js';
import {
    ALL_MCP_SCOPES,
    CONFIG_SCOPES,
    OPERATOR_SCOPES,
} from '../domain/scopes.js';

function tenantIssuer(): string {
    const tenant = getTenantConfig();
    const base = String(tenant.publicBaseUrl || '').replace(/\/$/, '');
    if (!base) {
        throw new Error('[oauth.metadata] Tenant publicBaseUrl is empty.');
    }
    return base;
}

export interface AuthorizationServerMetadata {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint: string;
    revocation_endpoint: string;
    scopes_supported: string[];
    response_types_supported: string[];
    grant_types_supported: string[];
    code_challenge_methods_supported: string[];
    token_endpoint_auth_methods_supported: string[];
    // RFC 8707 — we require resource binding on every authorize + token call.
    resource_parameter_supported: true;
    // OpenAI / MCP — we accept opaque tokens. JWT support is V3.
    bearer_methods_supported: string[];
    service_documentation: string;
}

export function buildAuthorizationServerMetadata(): AuthorizationServerMetadata {
    const issuer = tenantIssuer();
    return {
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        registration_endpoint: `${issuer}/oauth/register`,
        revocation_endpoint: `${issuer}/oauth/revoke`,
        scopes_supported: [...ALL_MCP_SCOPES],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        resource_parameter_supported: true,
        bearer_methods_supported: ['header'],
        service_documentation: `${issuer}/docs/mcp-oauth`,
    };
}

export interface ProtectedResourceMetadata {
    resource: string;
    authorization_servers: string[];
    scopes_supported: string[];
    bearer_methods_supported: string[];
    resource_documentation: string;
}

/**
 * Build the per-mount Protected Resource Metadata (RFC 9728).
 * When `mount` is omitted, returns the root-mount variant covering
 * the union of operator + config scopes.
 */
export function buildProtectedResourceMetadata(mount?: McpMount): ProtectedResourceMetadata {
    const issuer = tenantIssuer();
    if (mount === 'operator') {
        return {
            resource: operatorResource().url,
            authorization_servers: [issuer],
            scopes_supported: [...OPERATOR_SCOPES],
            bearer_methods_supported: ['header'],
            resource_documentation: `${issuer}/docs/mcp-oauth`,
        };
    }
    if (mount === 'config') {
        return {
            resource: configResource().url,
            authorization_servers: [issuer],
            scopes_supported: [...CONFIG_SCOPES],
            bearer_methods_supported: ['header'],
            resource_documentation: `${issuer}/docs/mcp-oauth`,
        };
    }
    // Root variant — RFC 9728 §3.2 requires `resource` to be the
    // canonical URL of the protected resource. We have TWO mounts
    // (operator + config); the root variant defaults to the operator
    // mount because that's the primary V2/V2.1 customer surface
    // (ChatGPT Apps connectors are operator-flow-driven). Returning
    // the issuer host as `resource` (which we did until 2026-05-29
    // 09:11 UTC) caused ChatGPT to use the issuer as the OAuth
    // `resource` parameter, and /oauth/authorize rejected it with
    // `invalid_target`. Clients that want the config mount should
    // follow the WWW-Authenticate `resource_metadata` pointer on a
    // 401 from `/api/v1/mcp/config` — that header points at the
    // per-mount metadata URL which returns the right `resource`.
    return {
        resource: operatorResource().url,
        authorization_servers: [issuer],
        scopes_supported: [...ALL_MCP_SCOPES],
        bearer_methods_supported: ['header'],
        resource_documentation: `${issuer}/docs/mcp-oauth`,
    };
}

/**
 * Resource-metadata URL the WWW-Authenticate header points at.
 * Per the MCP spec, this is the discovery anchor for unauthenticated
 * clients.
 */
export function protectedResourceMetadataUrl(mount?: McpMount): string {
    const issuer = tenantIssuer();
    if (mount === 'operator') return `${issuer}/.well-known/oauth-protected-resource/api/v1/mcp/operator`;
    if (mount === 'config') return `${issuer}/.well-known/oauth-protected-resource/api/v1/mcp/config`;
    return `${issuer}/.well-known/oauth-protected-resource`;
}

/** All known mounts — handy for tests / static analysis. */
export function knownMounts(): McpMount[] {
    return allResources().map((r) => r.mount);
}

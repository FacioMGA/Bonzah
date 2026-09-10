/**
 * Pins the RFC 8414 (Authorization Server Metadata) + RFC 9728
 * (Protected Resource Metadata) shapes (ADR-0040 §2 — Phase A).
 *
 * MCP clients reject metadata documents that violate the spec —
 * silently in some cases (ChatGPT). If these tests fail, the next
 * remote-client discovery attempt fails too.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../../platform/tenant/tenantConfig.js', () => ({
    getTenantConfig: () => ({
        id: 'tenant-cy',
        tenantSlug: 'abbeygate-cy',
        countryCode: 'CY',
        publicBaseUrl: 'https://abbeygate-cy.facio.io',
    }),
}));

import {
    buildAuthorizationServerMetadata,
    buildProtectedResourceMetadata,
    protectedResourceMetadataUrl,
} from '../app/buildMetadata.js';
import {
    operatorResource,
    configResource,
    resolveResourceParameter,
} from '../domain/resource.js';
import {
    OPERATOR_SCOPES,
    CONFIG_SCOPES,
    ALL_MCP_SCOPES,
    familyOfScope,
    parseScopeString,
} from '../domain/scopes.js';

describe('Authorization Server Metadata (RFC 8414)', () => {
    let m: ReturnType<typeof buildAuthorizationServerMetadata>;
    beforeEach(() => {
        m = buildAuthorizationServerMetadata();
    });

    it('issuer is the tenant host (no trailing slash)', () => {
        expect(m.issuer).toBe('https://abbeygate-cy.facio.io');
    });

    it('publishes the canonical endpoint URLs', () => {
        expect(m.authorization_endpoint).toBe('https://abbeygate-cy.facio.io/oauth/authorize');
        expect(m.token_endpoint).toBe('https://abbeygate-cy.facio.io/oauth/token');
        expect(m.registration_endpoint).toBe('https://abbeygate-cy.facio.io/oauth/register');
        expect(m.revocation_endpoint).toBe('https://abbeygate-cy.facio.io/oauth/revoke');
    });

    it('mandates PKCE S256 (ADR-0040 §4)', () => {
        expect(m.code_challenge_methods_supported).toEqual(['S256']);
        expect(m.code_challenge_methods_supported).not.toContain('plain');
    });

    it('supports `none` for public clients (ChatGPT) and `client_secret_post` for confidential', () => {
        expect(m.token_endpoint_auth_methods_supported).toEqual(['none', 'client_secret_post']);
        expect(m.token_endpoint_auth_methods_supported).not.toContain('client_secret_basic');
    });

    it('locks response_types to authorization-code only (no implicit grant)', () => {
        expect(m.response_types_supported).toEqual(['code']);
    });

    it('grants are authorization_code + refresh_token only (no password / client_credentials in V2.1)', () => {
        expect(m.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    });

    it('advertises RFC 8707 resource binding', () => {
        expect(m.resource_parameter_supported).toBe(true);
    });

    it('scopes_supported is the union of operator + configuration permission keys', () => {
        const sorted = [...m.scopes_supported].sort();
        const expected = [...ALL_MCP_SCOPES].sort();
        expect(sorted).toEqual(expected);
    });
});

describe('Protected Resource Metadata (RFC 9728)', () => {
    it('root variant defaults `resource` to the operator mount (avoids invalid_target on /oauth/authorize)', () => {
        // Regression: 2026-05-29 09:11 UTC. Returning the issuer host
        // as `resource` for the root variant caused ChatGPT to use the
        // issuer as the OAuth `resource` parameter, which
        // /oauth/authorize rejected with invalid_target. The root
        // variant now points at the operator mount (primary V2.1 use
        // case); clients wanting config follow the WWW-Authenticate
        // pointer on a 401 from /api/v1/mcp/config.
        const m = buildProtectedResourceMetadata();
        expect(m.resource).toBe('https://abbeygate-cy.facio.io/api/v1/mcp/operator');
        expect(m.authorization_servers).toEqual(['https://abbeygate-cy.facio.io']);
        expect([...m.scopes_supported].sort()).toEqual([...ALL_MCP_SCOPES].sort());
    });

    it('per-mount operator variant narrows to operator scopes only', () => {
        const m = buildProtectedResourceMetadata('operator');
        expect(m.resource).toBe('https://abbeygate-cy.facio.io/api/v1/mcp/operator');
        expect([...m.scopes_supported].sort()).toEqual([...OPERATOR_SCOPES].sort());
        expect(m.scopes_supported).toContain('policies.bind');
        expect(m.scopes_supported).toContain('documents.view');
    });

    it('per-mount config variant narrows to governed configuration scopes only', () => {
        const m = buildProtectedResourceMetadata('config');
        expect(m.resource).toBe('https://abbeygate-cy.facio.io/api/v1/mcp/config');
        expect([...m.scopes_supported].sort()).toEqual([...CONFIG_SCOPES].sort());
        expect(m.scopes_supported).toContain('configuration.read');
        expect(m.scopes_supported).toContain('programs.publish');
        expect(m.scopes_supported).toContain('binders.edit');
    });

    it('Bearer is the only supported token presentation method (no query, no body)', () => {
        const m = buildProtectedResourceMetadata();
        expect(m.bearer_methods_supported).toEqual(['header']);
    });
});

describe('protectedResourceMetadataUrl', () => {
    it('root variant', () => {
        expect(protectedResourceMetadataUrl()).toBe(
            'https://abbeygate-cy.facio.io/.well-known/oauth-protected-resource',
        );
    });

    it('per-mount operator variant', () => {
        expect(protectedResourceMetadataUrl('operator')).toBe(
            'https://abbeygate-cy.facio.io/.well-known/oauth-protected-resource/api/v1/mcp/operator',
        );
    });

    it('per-mount config variant', () => {
        expect(protectedResourceMetadataUrl('config')).toBe(
            'https://abbeygate-cy.facio.io/.well-known/oauth-protected-resource/api/v1/mcp/config',
        );
    });
});

describe('resolveResourceParameter (RFC 8707 enforcement)', () => {
    it('accepts the exact canonical operator URL', () => {
        const r = resolveResourceParameter('https://abbeygate-cy.facio.io/api/v1/mcp/operator');
        expect(r?.mount).toBe('operator');
    });

    it('accepts a trailing-slash variant (normalised)', () => {
        const r = resolveResourceParameter('https://abbeygate-cy.facio.io/api/v1/mcp/operator/');
        expect(r?.mount).toBe('operator');
    });

    it('rejects a cross-tenant URL', () => {
        const r = resolveResourceParameter('https://abbeygate-pt.facio.io/api/v1/mcp/operator');
        expect(r).toBeNull();
    });

    it('rejects a non-MCP path under our host', () => {
        const r = resolveResourceParameter('https://abbeygate-cy.facio.io/api/v1/policies');
        expect(r).toBeNull();
    });

    it('rejects empty / missing', () => {
        expect(resolveResourceParameter('')).toBeNull();
        expect(resolveResourceParameter(null)).toBeNull();
        expect(resolveResourceParameter(undefined)).toBeNull();
    });
});

describe('Scope helpers', () => {
    it('parseScopeString preserves valid scopes, drops invalid ones, dedupes', () => {
        const parsed = parseScopeString('operator.read operator.read operator.bogus configuration.draft');
        expect(parsed).toEqual(['operator.read', 'configuration.draft']);
    });

    it('familyOfScope returns operator/config/unknown', () => {
        expect(familyOfScope('operator.mutate')).toBe('operator');
        expect(familyOfScope('policies.bind')).toBe('operator');
        expect(familyOfScope('documents.view')).toBe('operator');
        expect(familyOfScope('configuration.publish_sandbox')).toBe('config');
        expect(familyOfScope('programs.publish')).toBe('config');
        expect(familyOfScope('binders.edit')).toBe('config');
        expect(familyOfScope('weird.thing')).toBe('unknown');
    });
});

describe('Resource descriptors', () => {
    it('operatorResource + configResource use the tenant publicBaseUrl', () => {
        expect(operatorResource().url).toBe('https://abbeygate-cy.facio.io/api/v1/mcp/operator');
        expect(configResource().url).toBe('https://abbeygate-cy.facio.io/api/v1/mcp/config');
    });
});

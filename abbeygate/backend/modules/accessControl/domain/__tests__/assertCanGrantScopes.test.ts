/**
 * Pins the OAuth consent role gate (ADR-0040 §6 — MCP V2.1).
 *
 * ADMIN: any scope. Non-admin: operator.* only; operator.mutate
 * defense-in-depth requires the user to hold the permission themselves.
 */
import { describe, expect, it } from 'vitest';
import { assertCanGrantScopes } from '../permissionTaxonomy.js';

describe('assertCanGrantScopes (ADR-0040 §6)', () => {
    it('ADMIN may grant any scope (operator + configuration)', () => {
        const r = assertCanGrantScopes({
            role: 'ADMIN',
            userPermissions: ['operator.mutate'],
            requestedScopes: [
                'operator.read', 'operator.mutate',
                'configuration.draft', 'configuration.publish_sandbox',
            ],
        });
        expect(r.grantable).toEqual([
            'operator.read', 'operator.mutate',
            'configuration.draft', 'configuration.publish_sandbox',
        ]);
        expect(r.rejected).toEqual([]);
    });

    it('UNDERWRITER may grant operator.* only', () => {
        const r = assertCanGrantScopes({
            role: 'UNDERWRITER',
            userPermissions: ['operator.read', 'operator.comm', 'operator.analytics', 'operator.mutate'],
            requestedScopes: ['operator.read', 'operator.mutate', 'configuration.draft'],
        });
        expect(r.grantable).toEqual(['operator.read', 'operator.mutate']);
        expect(r.rejected).toEqual([
            { scope: 'configuration.draft', reason: 'requires_admin' },
        ]);
    });

    it('UNDERWRITER without operator.mutate cannot grant operator.mutate (defense-in-depth)', () => {
        const r = assertCanGrantScopes({
            role: 'UNDERWRITER',
            userPermissions: ['operator.read', 'operator.comm'],
            requestedScopes: ['operator.read', 'operator.mutate'],
        });
        expect(r.grantable).toEqual(['operator.read']);
        expect(r.rejected).toEqual([
            { scope: 'operator.mutate', reason: 'requires_explicit_operator_mutate' },
        ]);
    });

    it('MANAGER (non-admin) follows the same operator-only rule as UNDERWRITER', () => {
        const r = assertCanGrantScopes({
            role: 'MANAGER',
            userPermissions: ['operator.read'],
            requestedScopes: ['operator.read', 'configuration.publish_sandbox'],
        });
        expect(r.grantable).toEqual(['operator.read']);
        expect(r.rejected.map((x) => x.scope)).toEqual(['configuration.publish_sandbox']);
    });

    it('unknown role is treated as non-admin', () => {
        const r = assertCanGrantScopes({
            role: 'WHATEVER',
            userPermissions: [],
            requestedScopes: ['operator.read', 'configuration.read'],
        });
        expect(r.grantable).toEqual(['operator.read']);
        expect(r.rejected.map((x) => x.scope)).toEqual(['configuration.read']);
    });

    it('null/empty role is treated as non-admin', () => {
        const r = assertCanGrantScopes({
            role: null,
            userPermissions: [],
            requestedScopes: ['configuration.draft'],
        });
        expect(r.grantable).toEqual([]);
        expect(r.rejected).toHaveLength(1);
    });

    it('unknown scopes are silently dropped (never granted, never rejected)', () => {
        const r = assertCanGrantScopes({
            role: 'ADMIN',
            userPermissions: [],
            requestedScopes: ['operator.read', 'totally.bogus'],
        });
        expect(r.grantable).toEqual(['operator.read']);
        expect(r.rejected).toEqual([]);
    });

    it('ADMIN with operator.mutate request: granted directly without DiD check', () => {
        const r = assertCanGrantScopes({
            role: 'ADMIN',
            userPermissions: [], // admin doesn't need explicit operator.mutate
            requestedScopes: ['operator.mutate'],
        });
        expect(r.grantable).toEqual(['operator.mutate']);
        expect(r.rejected).toEqual([]);
    });
});

/**
 * Tenant-scoped repository for `oauth_clients` + `oauth_refresh_tokens`
 * (ADR-0040 §7).
 *
 * Single owner: this file is the only Prisma writer for OAuth tables.
 * Enforced by `tools/quality/check-mcp-auth-single-funnel.mjs`.
 */
import type { Prisma } from '@prisma/client';
import crypto from 'node:crypto';
import { tenantScopedPrisma } from '../../../../platform/db/connection.js';

export type RegistrationKind = 'dcr' | 'predefined';

export interface OAuthClientRow {
    id: string;
    clientId: string;
    operatingTenantId: string;
    clientSecretHash: string | null;
    clientName: string;
    clientUri: string | null;
    redirectUris: string[];
    scopes: string[];
    registrationKind: RegistrationKind;
    createdAt: Date;
    revokedAt: Date | null;
}

function newClientId(): string {
    return `oauthc_${crypto.randomBytes(16).toString('hex')}`;
}

function newClientSecret(): string {
    return `oauths_${crypto.randomBytes(32).toString('hex')}`;
}

function hashSecret(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
}

export interface CreateOAuthClientInput {
    operatingTenantId: string;
    clientName: string;
    clientUri?: string | null;
    redirectUris: string[];
    scopes: string[];
    registrationKind?: RegistrationKind;
    /** Public client (PKCE-only) gets no secret. */
    public: boolean;
}

export interface CreateOAuthClientResult {
    client: OAuthClientRow;
    /** ONLY returned for confidential clients — never recoverable. */
    rawSecret: string | null;
}

export async function createOAuthClient(input: CreateOAuthClientInput): Promise<CreateOAuthClientResult> {
    const clientId = newClientId();
    let rawSecret: string | null = null;
    let secretHash: string | null = null;
    if (!input.public) {
        rawSecret = newClientSecret();
        secretHash = hashSecret(rawSecret);
    }
    const data: Prisma.OAuthClientUncheckedCreateInput = {
        operatingTenantId: input.operatingTenantId,
        clientId,
        clientSecretHash: secretHash,
        clientName: input.clientName,
        clientUri: input.clientUri ?? null,
        redirectUris: input.redirectUris,
        scopes: input.scopes,
        registrationKind: input.registrationKind ?? 'dcr',
    };
    const row = await tenantScopedPrisma.oAuthClient.create({ data });
    return {
        client: rowToClient(row),
        rawSecret,
    };
}

export async function findOAuthClientByClientId(clientId: string): Promise<OAuthClientRow | null> {
    const row = await tenantScopedPrisma.oAuthClient.findUnique({ where: { clientId } });
    if (!row) return null;
    if (row.revokedAt) return null;
    return rowToClient(row);
}

export interface VerifyClientSecretResult {
    ok: boolean;
    client: OAuthClientRow | null;
}

export async function verifyClientCredentials(
    clientId: string,
    clientSecret: string | null,
): Promise<VerifyClientSecretResult> {
    const client = await findOAuthClientByClientId(clientId);
    if (!client) return { ok: false, client: null };
    if (!client.clientSecretHash) {
        // Public client — `none` auth method. Caller MUST verify PKCE.
        return { ok: true, client };
    }
    if (!clientSecret) return { ok: false, client };
    const supplied = hashSecret(clientSecret);
    // Timing-safe comparison.
    const a = Buffer.from(supplied, 'hex');
    const b = Buffer.from(client.clientSecretHash, 'hex');
    if (a.length !== b.length) return { ok: false, client };
    if (!crypto.timingSafeEqual(a, b)) return { ok: false, client };
    return { ok: true, client };
}

export async function listOAuthClients(): Promise<OAuthClientRow[]> {
    const rows = await tenantScopedPrisma.oAuthClient.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
    });
    return rows.map(rowToClient);
}

export async function revokeOAuthClient(clientId: string): Promise<void> {
    await tenantScopedPrisma.oAuthClient.update({
        where: { clientId },
        data: { revokedAt: new Date() },
    });
}

function rowToClient(r: {
    id: string;
    clientId: string;
    operatingTenantId: string;
    clientSecretHash: string | null;
    clientName: string;
    clientUri: string | null;
    redirectUris: string[];
    scopes: string[];
    registrationKind: string;
    createdAt: Date;
    revokedAt: Date | null;
}): OAuthClientRow {
    return {
        id: r.id,
        clientId: r.clientId,
        operatingTenantId: r.operatingTenantId,
        clientSecretHash: r.clientSecretHash,
        clientName: r.clientName,
        clientUri: r.clientUri,
        redirectUris: r.redirectUris,
        scopes: r.scopes,
        registrationKind: r.registrationKind as RegistrationKind,
        createdAt: r.createdAt,
        revokedAt: r.revokedAt,
    };
}

// ---- Refresh tokens ------------------------------------------------------

export interface RefreshTokenRow {
    id: string;
    tokenHash: string;
    clientId: string;
    userId: string;
    operatingTenantId: string;
    scopes: string[];
    resource: string;
    issuedAt: Date;
    expiresAt: Date;
    rotatedAt: Date | null;
    revokedAt: Date | null;
}

const REFRESH_TOKEN_TTL_DAYS = 30;

export function newRefreshToken(): string {
    return `rt_${crypto.randomBytes(32).toString('hex')}`;
}

export function hashRefreshToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function createRefreshToken(input: {
    operatingTenantId: string;
    clientId: string;
    userId: string;
    scopes: string[];
    resource: string;
}): Promise<{ rawToken: string; row: RefreshTokenRow }> {
    const rawToken = newRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    const data: Prisma.OAuthRefreshTokenUncheckedCreateInput = {
        operatingTenantId: input.operatingTenantId,
        tokenHash: hashRefreshToken(rawToken),
        clientId: input.clientId,
        userId: input.userId,
        scopes: input.scopes,
        resource: input.resource,
        expiresAt,
    };
    const row = await tenantScopedPrisma.oAuthRefreshToken.create({ data });
    return { rawToken, row: rowToRefreshToken(row) };
}

export async function findActiveRefreshToken(rawToken: string): Promise<RefreshTokenRow | null> {
    if (!rawToken.startsWith('rt_')) return null;
    const hash = hashRefreshToken(rawToken);
    const row = await tenantScopedPrisma.oAuthRefreshToken.findUnique({ where: { tokenHash: hash } });
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.rotatedAt) return null; // already rotated — single-use chain
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return rowToRefreshToken(row);
}

export async function markRefreshTokenRotated(tokenId: string): Promise<void> {
    await tenantScopedPrisma.oAuthRefreshToken.update({
        where: { id: tokenId },
        data: { rotatedAt: new Date() },
    });
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
    if (!rawToken.startsWith('rt_')) return;
    const hash = hashRefreshToken(rawToken);
    await tenantScopedPrisma.oAuthRefreshToken.updateMany({
        where: { tokenHash: hash },
        data: { revokedAt: new Date() },
    });
}

function rowToRefreshToken(r: {
    id: string;
    tokenHash: string;
    clientId: string;
    userId: string;
    operatingTenantId: string;
    scopes: string[];
    resource: string;
    issuedAt: Date;
    expiresAt: Date;
    rotatedAt: Date | null;
    revokedAt: Date | null;
}): RefreshTokenRow {
    return r;
}

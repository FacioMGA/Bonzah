import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { digest, secret } from '../storage/auth-store.js';
import type { Principal } from '../contracts/control-plane.js';
import { KernelError } from '../domain/canonical.js';

export const actorIdFor = (issuer: string, subject: string) =>
  `usr_${digest(issuer + '\n' + subject).slice(0, 56)}`;
export type LoginFlow = {
  provider: string;
  nonce: string;
  verifier: string;
  continuation?: string;
};
export interface IdentityProvider {
  id: 'google' | 'microsoft';
  label: string;
  authorize(flow: LoginFlow, state: string): string;
  callback(code: string, flow: LoginFlow): Promise<Principal>;
}
type OidcOptions = {
  id: 'google' | 'microsoft';
  clientId: string;
  clientSecret: string;
  publicUrl: string;
  tenantId?: string;
  workspaceDomain: string;
};
export function oidcProvider(options: OidcOptions): IdentityProvider {
  const microsoft = options.id === 'microsoft';
  if (microsoft && !z.string().uuid().safeParse(options.tenantId).success)
    throw new Error('A specific Entra tenant is required');
  const issuer = microsoft
    ? `https://login.microsoftonline.com/${options.tenantId}/v2.0`
    : 'https://accounts.google.com';
  const authorizeUrl = microsoft
    ? `https://login.microsoftonline.com/${options.tenantId}/oauth2/v2.0/authorize`
    : 'https://accounts.google.com/o/oauth2/v2/auth';
  const tokenUrl = microsoft
    ? `https://login.microsoftonline.com/${options.tenantId}/oauth2/v2.0/token`
    : 'https://oauth2.googleapis.com/token';
  const jwks = createRemoteJWKSet(
    new URL(
      microsoft
        ? `https://login.microsoftonline.com/${options.tenantId}/discovery/v2.0/keys`
        : 'https://www.googleapis.com/oauth2/v3/certs',
    ),
    { timeoutDuration: 10_000 },
  );
  const redirectUri = new URL('/auth/callback', options.publicUrl).href;
  return {
    id: options.id,
    label: microsoft ? 'Microsoft organization account' : 'Google Workspace',
    authorize(flow, state) {
      const url = new URL(authorizeUrl);
      url.search = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        nonce: flow.nonce,
        code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
        code_challenge_method: 'S256',
        prompt: 'select_account',
        ...(microsoft ? {} : { hd: options.workspaceDomain }),
      }).toString();
      return url.href;
    },
    async callback(code, flow) {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code_verifier: flow.verifier,
        }),
      });
      if (!response.ok)
        throw new KernelError('SIGN_IN_FAILED', 'Organization sign-in could not be completed', 401);
      const tokens = z.object({ id_token: z.string() }).parse(await response.json());
      const { payload } = await jwtVerify(tokens.id_token, jwks, {
        issuer: microsoft ? issuer : [issuer, 'accounts.google.com'],
        audience: options.clientId,
        algorithms: ['RS256'],
        clockTolerance: 30,
        requiredClaims: ['exp', 'iat', 'sub', 'nonce'],
      });
      if (payload.nonce !== flow.nonce)
        throw new KernelError('SIGN_IN_FAILED', 'Organization sign-in could not be verified', 401);
      if (microsoft && (payload.tid !== options.tenantId || typeof payload.oid !== 'string'))
        throw new KernelError('SIGN_IN_FAILED', 'The organization identity is invalid', 401);
      if (!microsoft && (payload.hd !== options.workspaceDomain || payload.email_verified !== true))
        throw new KernelError(
          'SIGN_IN_FAILED',
          'A verified Facio Google Workspace identity is required',
          401,
        );
      const subject = microsoft ? (payload.oid as string) : payload.sub!;
      // Entra email/preferred_username is display data, never an invitation binding claim.
      const email =
        typeof payload.email === 'string'
          ? payload.email
          : microsoft && typeof payload.preferred_username === 'string'
            ? payload.preferred_username
            : undefined;
      return {
        issuer,
        subject,
        actorId: actorIdFor(issuer, subject),
        correlationId: randomUUID(),
        ...(email ? { email: email.toLowerCase() } : {}),
      };
    },
  };
}
export function newLoginFlow(provider: string, continuation?: string): LoginFlow {
  return {
    provider,
    nonce: secret(),
    verifier: secret(),
    ...(continuation ? { continuation } : {}),
  };
}

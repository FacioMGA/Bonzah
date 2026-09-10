import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Response } from 'express';
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidGrantError,
  InvalidTokenError,
  InvalidTargetError,
  InvalidScopeError,
  InvalidClientMetadataError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import type { Principal } from '../contracts/control-plane.js';
import { KernelError } from '../domain/canonical.js';
import { AuthStore, secret } from '../storage/auth-store.js';
import { newLoginFlow, type IdentityProvider, type LoginFlow } from './oidc.js';

const MINUTE = 60_000;
const SESSION_TTL = 8 * 60 * MINUTE;
const GRANT_TTL = 7 * 24 * 60 * MINUTE;
export const SESSION_COOKIE = '__Host-kernel_session';
const FLOW_COOKIE = '__Host-kernel_login';
type Session = { principal: Principal; csrfToken: string };
type Authorization = {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state?: string;
  resource: string;
  scopes: string[];
};
type Code = Authorization & { principal: Principal };
type Token = {
  principal: Principal;
  clientId: string;
  resource: string;
  scopes: string[];
  grantId: string;
};
export const cookieValue = (header: string | undefined, name: string) => {
  const values = (header ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(name + '='));
  return values.length === 1 ? values[0]!.slice(name.length + 1) : undefined;
};
export const sessionCookie = (value: string, maxAge = SESSION_TTL / 1000) =>
  `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const loginCookie = (value: string, maxAge = 600) =>
  `${FLOW_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export class HostedAuth implements OAuthServerProvider {
  readonly resource: string;
  readonly clientsStore;
  constructor(
    readonly store: AuthStore,
    readonly options: {
      publicUrl: string;
      providers: IdentityProvider[];
      authorizePrincipal: (principal: Principal) => void;
      acceptVerifiedGoogleInvitation?: (principal: Principal) => void;
    },
  ) {
    const url = new URL(options.publicUrl);
    if (
      url.protocol !== 'https:' ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error('Hosted public URL must be an HTTPS origin');
    this.resource = new URL('/mcp', url).href;
    this.clientsStore = {
      getClient: (id: string) => store.read<OAuthClientInformationFull>('client', id),
      registerClient: async (
        input: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
      ): Promise<OAuthClientInformationFull> => {
        if (
          input.redirect_uris.length > 8 ||
          input.redirect_uris.some((uri) => {
            const u = new URL(uri);
            return u.protocol !== 'https:' || !!u.hash || !!u.username || !!u.password;
          })
        )
          throw new InvalidClientMetadataError('Register exact HTTPS redirect URLs');
        const client = {
          ...input,
          client_id: randomUUID(),
          client_id_issued_at: Math.floor(Date.now() / 1000),
        };
        store.put('client', client.client_id, client, 365 * 24 * 60 * MINUTE);
        return client;
      },
    };
  }
  router() {
    return mcpAuthRouter({
      provider: this,
      issuerUrl: new URL(this.options.publicUrl),
      resourceServerUrl: new URL(this.resource),
      resourceName: 'Facio Kernel sandbox',
      scopesSupported: ['kernel:access'],
    });
  }
  providers() {
    return this.options.providers.map(({ id, label }) => ({ id, label }));
  }
  private fresh(principal: Principal) {
    const value = { ...principal, correlationId: randomUUID() };
    this.options.authorizePrincipal(value);
    return value;
  }
  session(header: string | undefined): Session | undefined {
    const token = cookieValue(header, SESSION_COOKIE);
    const session = token ? this.store.read<Session>('session', token) : undefined;
    return session ? { ...session, principal: this.fresh(session.principal) } : undefined;
  }
  createSession(principal: Principal) {
    this.fresh(principal);
    const token = secret();
    const session = { principal, csrfToken: secret() };
    this.store.put('session', token, session, SESSION_TTL);
    return { token, ...session };
  }
  authenticate(authorization: string | undefined): Principal {
    if (!authorization?.startsWith('Bearer '))
      throw new KernelError('UNAUTHENTICATED', 'Connect your organization account', 401);
    const token = this.store.read<Token>('access', authorization.slice(7));
    if (!token || !this.store.validGrant(token.grantId) || token.resource !== this.resource)
      throw new KernelError('UNAUTHENTICATED', 'The access token is expired or revoked', 401);
    return this.fresh(token.principal);
  }
  verifyCsrf(session: Session | undefined, supplied: unknown) {
    if (!session || typeof supplied !== 'string' || supplied !== session.csrfToken)
      throw new KernelError('INVALID_CSRF', 'Reload the page and try again', 403);
  }
  logout(header: string | undefined) {
    const key = cookieValue(header, SESSION_COOKIE);
    if (key) this.store.consume('session', key);
  }
  startLogin(providerId: string, continuation?: string) {
    const provider = this.options.providers.find((p) => p.id === providerId);
    if (!provider)
      throw new KernelError(
        'IDENTITY_PROVIDER_UNAVAILABLE',
        'This organization sign-in is not configured',
        503,
      );
    if (continuation && !this.authorization(continuation))
      throw new KernelError('SIGN_IN_EXPIRED', 'Start the connection again', 400);
    const state = secret(),
      flow = newLoginFlow(provider.id, continuation);
    this.store.put('login', state, flow, 10 * MINUTE);
    return { location: provider.authorize(flow, state), cookie: loginCookie(state) };
  }
  async finishLogin(raw: unknown, cookie: string | undefined) {
    const query = z
      .object({ code: z.string().min(1).max(10000), state: z.string().min(32).max(200) })
      .safeParse(raw);
    if (!query.success || cookieValue(cookie, FLOW_COOKIE) !== query.data.state)
      throw new KernelError('SIGN_IN_FAILED', 'The sign-in state is invalid', 401);
    const { state, code } = query.data;
    const flow = this.store.read<LoginFlow>('login', state);
    if (!flow || !this.store.consume('login', state))
      throw new KernelError('SIGN_IN_EXPIRED', 'Start sign-in again', 401);
    const provider = this.options.providers.find((p) => p.id === flow.provider)!;
    const principal = await provider.callback(code, flow);
    if (provider.id === 'google') this.options.acceptVerifiedGoogleInvitation?.(principal);
    const session = this.createSession(principal);
    return {
      location: flow.continuation
        ? '/auth/consent?request=' + encodeURIComponent(flow.continuation)
        : '/',
      cookies: [sessionCookie(session.token), loginCookie('', 0)],
    };
  }
  authorization(key: string) {
    return this.store.read<Authorization>('authorization', key);
  }
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    if (params.resource?.href !== this.resource)
      throw new InvalidTargetError('The resource must be this Kernel MCP endpoint');
    const scopes = params.scopes?.length ? params.scopes : ['kernel:access'];
    if (scopes.some((s) => s !== 'kernel:access'))
      throw new InvalidScopeError('Only kernel:access is supported');
    const key = secret();
    this.store.put(
      'authorization',
      key,
      {
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        challenge: params.codeChallenge,
        state: params.state,
        resource: this.resource,
        scopes,
      },
      10 * MINUTE,
    );
    res.redirect('/auth/consent?request=' + encodeURIComponent(key));
  }
  consent(key: string, principal: Principal, allow: boolean) {
    this.fresh(principal);
    return this.store.transaction(() => {
      const pending = this.authorization(key);
      if (!pending || !this.store.consume('authorization', key))
        throw new KernelError('AUTHORIZATION_EXPIRED', 'Start the connection again', 400);
      const redirect = new URL(pending.redirectUri);
      if (pending.state) redirect.searchParams.set('state', pending.state);
      redirect.searchParams.set('iss', new URL(this.options.publicUrl).href);
      if (allow) {
        const code = secret();
        this.store.put('code', code, { ...pending, principal }, MINUTE);
        redirect.searchParams.set('code', code);
      } else redirect.searchParams.set('error', 'access_denied');
      return redirect.href;
    });
  }
  private code(client: OAuthClientInformationFull, key: string) {
    const code = this.store.read<Code>('code', key);
    if (!code || code.clientId !== client.client_id)
      throw new InvalidGrantError('The authorization code is invalid or expired');
    return code;
  }
  async challengeForAuthorizationCode(client: OAuthClientInformationFull, key: string) {
    return this.code(client, key).challenge;
  }
  private issue(payload: Token): OAuthTokens {
    const access = secret(),
      refresh = secret();
    this.store.put('access', access, payload, 15 * MINUTE);
    this.store.put('refresh', refresh, payload, GRANT_TTL);
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: 900,
      refresh_token: refresh,
      scope: payload.scopes.join(' '),
    };
  }
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    key: string,
    _verifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    return this.store.transaction(() => {
      const code = this.code(client, key);
      if (code.redirectUri !== redirectUri || resource?.href !== code.resource)
        throw new InvalidGrantError('The redirect URI or resource does not match');
      this.fresh(code.principal);
      if (!this.store.consume('code', key))
        throw new InvalidGrantError('The authorization code was already used');
      return this.issue({
        principal: code.principal,
        clientId: client.client_id,
        resource: code.resource,
        scopes: code.scopes,
        grantId: this.store.grant(code.principal.actorId, client.client_id, GRANT_TTL),
      });
    });
  }
  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    key: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    // Reuse revocation must commit even when the exchange is rejected.
    const existing = this.store.read<Token>('refresh', key, true);
    if (existing?.clientId === client.client_id && !this.store.read('refresh', key))
      this.store.revokeGrant(existing.grantId);
    return this.store.transaction(() => {
      const token = this.store.read<Token>('refresh', key);
      if (!token || token.clientId !== client.client_id || !this.store.validGrant(token.grantId))
        throw new InvalidGrantError('The refresh token is invalid or revoked');
      if (resource?.href !== token.resource)
        throw new InvalidTargetError('The resource does not match');
      if (scopes?.some((s) => !token.scopes.includes(s)))
        throw new InvalidScopeError('Scope escalation is forbidden');
      this.fresh(token.principal);
      if (!this.store.consume('refresh', key))
        throw new InvalidGrantError('The refresh token was already used');
      return this.issue({ ...token, scopes: scopes ?? token.scopes });
    });
  }
  async verifyAccessToken(value: string): Promise<AuthInfo> {
    try {
      this.authenticate('Bearer ' + value);
      const token = this.store.read<Token>('access', value)!;
      return {
        token: value,
        clientId: token.clientId,
        scopes: token.scopes,
        resource: new URL(token.resource),
      };
    } catch {
      throw new InvalidTokenError('The access token is invalid');
    }
  }
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    const token =
      this.store.read<Token>('refresh', request.token, true) ??
      this.store.read<Token>('access', request.token, true);
    if (token?.clientId === client.client_id) this.store.revokeGrant(token.grantId);
  }
}

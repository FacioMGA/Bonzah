import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
const keys = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock('jose', async (original) => ({
  ...await original<typeof import('jose')>(),
  createRemoteJWKSet: () => keys.value,
}));
import { newLoginFlow, oidcProvider } from '../domain/oidc.js';

afterEach(() => vi.unstubAllGlobals());
describe('organization OIDC cryptographic verification', () => {
  it('verifies RS256 issuer/audience/nonce/expiry and verified Google Workspace claims', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey); keys.value = createLocalJWKSet({ keys: [{ ...jwk, kid: 'local-test', alg: 'RS256' }] });
    const options = { id: 'google' as const, clientId: 'local-client', clientSecret: 'not-a-real-secret', publicUrl: 'https://platform.example.invalid', workspaceDomain: 'facio.io' };
    const provider = oidcProvider(options), flow = newLoginFlow('google');
    const authorize = new URL(provider.authorize(flow, 'test-state'));
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('redirect_uri')).toBe('https://platform.example.invalid/auth/callback');
    const sign = (overrides: Record<string, unknown> = {}) => new SignJWT({ sub: 'stable-subject', nonce: flow.nonce, email: 'MEMBER@facio.io', email_verified: true, hd: 'facio.io', iss: 'https://accounts.google.com', aud: 'local-client', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 120, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'local-test' }).sign(privateKey);
    let token = await sign();
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const params = init.body as URLSearchParams;
      expect(params.get('code_verifier')).toBe(flow.verifier);
      expect(params.get('redirect_uri')).toBe('https://platform.example.invalid/auth/callback');
      return new Response(JSON.stringify({ id_token: token }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);
    expect(await provider.callback('authorization-code', flow)).toMatchObject({ issuer: 'https://accounts.google.com', subject: 'stable-subject', email: 'member@facio.io' });
    for (const mutation of [{ nonce: 'other' }, { hd: 'other.example' }, { email_verified: false }, { iss: 'https://evil.example' }, { aud: 'other-client' }, { exp: Math.floor(Date.now() / 1000) - 120 }]) {
      token = await sign(mutation); await expect(provider.callback('authorization-code', flow)).rejects.toThrow();
    }
    const parts = (await sign()).split('.'); parts[1] = Buffer.from(JSON.stringify({ sub: 'forged' })).toString('base64url'); token = parts.join('.');
    await expect(provider.callback('authorization-code', flow)).rejects.toThrow();
  });
  it('verifies the specific Entra issuer, tenant and immutable directory oid', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey); keys.value = createLocalJWKSet({ keys: [{ ...jwk, kid: 'entra-test', alg: 'RS256' }] });
    const tenantId = '10000000-0000-4000-8000-000000000001', oid = '20000000-0000-4000-8000-000000000001';
    const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
    const provider = oidcProvider({ id: 'microsoft', clientId: 'entra-client', clientSecret: 'test-secret', publicUrl: 'https://platform.example.invalid', tenantId, workspaceDomain: 'facio.io' });
    const flow = newLoginFlow('microsoft');
    const sign = (changes: Record<string, unknown> = {}) => new SignJWT({ iss: issuer, aud: 'entra-client', sub: 'pairwise-sub', oid, tid: tenantId, nonce: flow.nonce, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+120, ...changes }).setProtectedHeader({alg:'RS256',kid:'entra-test'}).sign(privateKey);
    let token = await sign(); vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({id_token:token}), {status:200})));
    expect(await provider.callback('code',flow)).toMatchObject({issuer,subject:oid});
    for (const changes of [{tid:oid},{oid:'invalid'},{iss:'https://attacker.invalid'},{nonce:'another'}]) { token=await sign(changes); await expect(provider.callback('code',flow)).rejects.toThrow(); }
  });

});

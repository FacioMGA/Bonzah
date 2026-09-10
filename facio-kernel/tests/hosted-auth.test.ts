import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore, secret } from '../src/storage/auth-store.js';
import { Store } from '../src/storage/store.js';
import { Kernel } from '../src/application/kernel.js';
import { HostedAuth, sessionCookie } from '../src/server/hosted-auth.js';
import { actorIdFor } from '../src/server/oidc.js';
import { buildApp } from '../src/server/app.js';
import { KernelError } from '../src/domain/canonical.js';

const issuer = 'https://accounts.google.com';
const principal = {
  issuer,
  subject: 'verified-subject-a',
  actorId: actorIdFor(issuer, 'verified-subject-a'),
  email: 'intern@example.test',
  correlationId: randomUUID(),
};
const publicUrl = 'https://kernel.example.test';
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'kernel-auth-'));
  const store = new Store(join(dir, 'kernel.sqlite'));
  const kernel = new Kernel(store, [], [], undefined, {
    region: 'westeurope',
    buildSha: 'a'.repeat(40),
  });
  kernel.control.bootstrapAccount({
    accountId: 'test',
    workspaceId: 'test',
    displayName: 'Test',
    members: [{ ...principal, role: 'builder' }],
  });
  let now = Date.now();
  const authStore = new AuthStore(join(dir, 'auth.sqlite'), () => now);
  const auth = new HostedAuth(authStore, {
    publicUrl,
    providers: [
      {
        id: 'google',
        label: 'Mock organization identity',
        authorize: (_flow, state) => 'https://identity.example.test/authorize?state=' + state,
        callback: async () => principal,
      },
    ],
    authorizePrincipal: (p) => {
      if (!kernel.control.session(p).accounts.length)
        throw new KernelError('FORBIDDEN', 'Access revoked', 403);
    },
  });
  const app = buildApp({
    kernel,
    hosted: { auth, publicUrl, buildSha: 'a'.repeat(40), region: 'westeurope' },
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  // Exercise real HTTP: Express changes native response prototypes used by Fastify's injection shim.
  const send = (input: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    payload?: unknown;
  }) =>
    new Promise<{
      statusCode: number;
      headers: http.IncomingHttpHeaders;
      body: string;
      json: () => any;
    }>((resolve, reject) => {
      const payload =
        typeof input.payload === 'string'
          ? input.payload
          : input.payload === undefined
            ? undefined
            : JSON.stringify(input.payload);
      const request = http.request(
        address + input.url,
        {
          method: input.method ?? 'GET',
          headers: {
            ...(payload
              ? {
                  'content-type': 'application/json',
                  'content-length': Buffer.byteLength(payload).toString(),
                }
              : {}),
            ...input.headers,
          },
        },
        (response) => {
          let body = '';
          response.on('data', (chunk) => (body += chunk));
          response.on('end', () =>
            resolve({
              statusCode: response.statusCode!,
              headers: response.headers,
              body,
              json: () => JSON.parse(body),
            }),
          );
        },
      );
      request.on('error', reject);
      request.setTimeout(10000, () => request.destroy(new Error('HTTP test timed out')));
      request.end(payload);
    });
  return {
    dir,
    store,
    kernel,
    authStore,
    auth,
    app,
    send,
    advance: (ms: number) => {
      now += ms;
    },
    close: async () => {
      await app.close();
      authStore.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test('hosted login is state and cookie bound; sessions persist and CSRF protects tenant creation', async () => {
  const f = await fixture();
  try {
    const config = await f.send({
      url: '/api/auth/config',
      headers: { host: 'kernel.example.test' },
    });
    assert.equal(config.statusCode, 200);
    assert.equal(config.json().mode, 'hosted-sandbox');
    const denied = await f.send({
      url: '/mcp',
      method: 'POST',
      headers: { host: 'kernel.example.test' },
      payload: {},
    });
    assert.equal(denied.statusCode, 401);
    assert.match(String(denied.headers['www-authenticate']), /oauth-protected-resource\/mcp/);
    assert.equal(
      (await f.send({ url: '/health', headers: { host: 'evil.test' } })).statusCode,
      403,
    );
    const login = await f.send({
      url: '/auth/login?provider=google',
      headers: { host: 'kernel.example.test' },
    });
    assert.equal(login.statusCode, 302);
    const state = new URL(String(login.headers.location)).searchParams.get('state')!;
    const callback = '/auth/callback?state=' + state + '&code=sample';
    assert.equal(
      (await f.send({ url: callback, headers: { host: 'kernel.example.test' } })).statusCode,
      401,
    );
    const done = await f.send({
      url: callback,
      headers: {
        host: 'kernel.example.test',
        cookie: String(login.headers['set-cookie']).split(';')[0]!,
      },
    });
    assert.equal(done.statusCode, 302);
    const cookies = done.headers['set-cookie'] as string[];
    const cookie = cookies.find((c) => c.startsWith('__Host-kernel_session='))!.split(';')[0]!;
    const session = await f.send({
      url: '/api/session',
      headers: { host: 'kernel.example.test', cookie },
    });
    assert.equal(session.statusCode, 200);
    assert.equal(session.json().accounts.length, 1);
    const headers = { host: 'kernel.example.test', cookie };
    const payload = {
      accountId: 'test',
      displayName: 'Intern A',
      region: 'westeurope',
      environment: 'sandbox',
      idempotencyKey: randomUUID(),
    };
    assert.equal(
      (await f.send({ method: 'POST', url: '/api/control/tenants', headers, payload })).statusCode,
      403,
    );
    const created = await f.send({
      method: 'POST',
      url: '/api/control/tenants',
      headers: { ...headers, 'x-csrf-token': session.json().csrfToken },
      payload,
    });
    assert.equal(created.statusCode, 200, created.body);
    const reconnected = new AuthStore(join(f.dir, 'auth.sqlite'));
    const copy = new HostedAuth(reconnected, {
      publicUrl,
      providers: [],
      authorizePrincipal: () => {},
    });
    assert.equal(copy.session(cookie)?.principal.actorId, principal.actorId);
    reconnected.close();
    assert.equal(
      (
        await f.send({
          url: callback,
          headers: {
            host: 'kernel.example.test',
            cookie: String(login.headers['set-cookie']).split(';')[0]!,
          },
        })
      ).statusCode,
      401,
    );
    f.store.control.revoke('test', principal.actorId);
    assert.equal(
      (
        await f.send({
          url: '/api/context',
          headers: { ...headers, 'x-kernel-tenant-id': created.json().tenant.id },
        })
      ).statusCode,
      403,
    );
  } finally {
    await f.close();
  }
});

test('OAuth discovery, SDK PKCE, resource binding, rotation reuse and revocation protect MCP', async () => {
  const f = await fixture();
  try {
    const headers = { host: 'kernel.example.test' };
    const metadata = await f.send({ url: '/.well-known/oauth-authorization-server', headers });
    assert.equal(metadata.statusCode, 200, metadata.body);
    assert.deepEqual(metadata.json().code_challenge_methods_supported, ['S256']);
    const resource = await f.send({ url: '/.well-known/oauth-protected-resource/mcp', headers });
    assert.equal(resource.json().resource, publicUrl + '/mcp');
    const registration = await f.send({
      method: 'POST',
      url: '/register',
      headers,
      payload: {
        client_name: 'ChatGPT test client',
        redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
    });
    assert.equal(registration.statusCode, 201, registration.body);
    const client = registration.json();
    const verifier = secret();
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authParams = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
      response_type: 'code',
      code_challenge_method: 'S256',
      code_challenge: challenge,
      resource: publicUrl + '/mcp',
      scope: 'kernel:access',
      state: 'client-state',
    });
    const authorization = await f.send({ url: '/authorize?' + authParams, headers });
    assert.equal(authorization.statusCode, 302, authorization.body);
    const request = new URL(String(authorization.headers.location), publicUrl).searchParams.get(
      'request',
    )!;
    const session = f.auth.createSession(principal);
    const cookie = sessionCookie(session.token).split(';')[0]!;
    const consent = await f.send({
      url: '/auth/consent?request=' + request,
      headers: { ...headers, cookie },
    });
    assert.equal(consent.statusCode, 200);
    assert.match(consent.body, /ChatGPT test client/);
    assert.match(
      String(consent.headers['content-security-policy']),
      /form-action 'self' https:\/\/chatgpt.com/,
    );
    assert.equal(consent.headers['referrer-policy'], 'same-origin');
    const granted = await f.send({
      method: 'POST',
      url: '/auth/consent',
      headers: { ...headers, cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        request,
        csrf: session.csrfToken,
        decision: 'allow',
      }).toString(),
    });
    assert.equal(granted.statusCode, 302, granted.body);
    const redirect = new URL(String(granted.headers.location));
    assert.equal(redirect.searchParams.get('state'), 'client-state');
    const tokenBody = {
      client_id: client.client_id,
      grant_type: 'authorization_code',
      code: redirect.searchParams.get('code')!,
      redirect_uri: client.redirect_uris[0],
      code_verifier: verifier,
      resource: publicUrl + '/mcp',
    };
    const exchange = (body: Record<string, string>) =>
      f.send({
        method: 'POST',
        url: '/token',
        headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams(body).toString(),
      });
    assert.equal((await exchange({ ...tokenBody, code_verifier: secret() })).statusCode, 400);
    assert.equal(
      (await exchange({ ...tokenBody, resource: 'https://other.example.test/mcp' })).statusCode,
      400,
    );
    const tokens = await exchange(tokenBody);
    assert.equal(tokens.statusCode, 200, tokens.body);
    assert.equal((await exchange(tokenBody)).statusCode, 400);
    const access = tokens.json().access_token;
    assert.equal(f.auth.authenticate('Bearer ' + access).actorId, principal.actorId);
    const mcp = await f.send({
      method: 'POST',
      url: '/mcp',
      headers: {
        ...headers,
        authorization: 'Bearer ' + access,
        accept: 'application/json, text/event-stream',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    assert.equal(mcp.statusCode, 200, mcp.body);
    assert.ok(
      mcp.json().result.tools.some((t: { name: string }) => t.name === 'control_create_tenant'),
    );
    assert.equal(
      mcp.json().result.tools.some((t: { name: string }) => t.name === 'control_revoke_membership'),
      false,
    );
    const forbiddenAuthority = await f.send({
      method: 'POST',
      url: '/mcp',
      headers: {
        ...headers,
        authorization: 'Bearer ' + access,
        accept: 'application/json, text/event-stream',
      },
      payload: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'control_revoke_membership',
          arguments: {
            accountId: 'test',
            actorId: principal.actorId,
            idempotencyKey: randomUUID(),
          },
        },
      },
    });
    assert.equal(forbiddenAuthority.statusCode, 200);
    assert.equal(forbiddenAuthority.json().result.isError, true);
    assert.equal(
      JSON.parse(forbiddenAuthority.json().result.content[0].text).error.code,
      'TRANSPORT_NOT_ALLOWED',
    );
    for (const path of ['/api/control/tenants', '/api/insurance/quotes', '/api/insurance/bind']) {
      const denied = await f.send({
        method: 'POST',
        url: path,
        headers: { ...headers, authorization: 'Bearer ' + access },
        payload: {},
      });
      assert.equal(denied.statusCode, 401, `MCP resource token must not authorize ${path}`);
    }
    assert.equal(
      (
        await f.send({
          url: '/api/control/tenants',
          headers: { ...headers, authorization: 'Bearer ' + access },
        })
      ).statusCode,
      401,
    );
    const refresh = {
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: tokens.json().refresh_token,
      resource: publicUrl + '/mcp',
    };
    const rotated = await exchange(refresh);
    assert.equal(rotated.statusCode, 200, rotated.body);
    assert.equal((await exchange(refresh)).statusCode, 400);
    assert.throws(
      () => f.auth.authenticate('Bearer ' + rotated.json().access_token),
      /expired or revoked/,
    );
    assert.throws(() => f.auth.authenticate('Bearer ' + access), /expired or revoked/);
  } finally {
    await f.close();
  }
});

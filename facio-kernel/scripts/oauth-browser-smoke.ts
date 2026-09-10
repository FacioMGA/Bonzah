import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/storage/store.js';
import { AuthStore, secret } from '../src/storage/auth-store.js';
import { Kernel } from '../src/application/kernel.js';
import { HostedAuth } from '../src/server/hosted-auth.js';
import { buildApp } from '../src/server/app.js';

// Disposable organization-session fixture. This exercises consent CSP/navigation, not a live IdP.
const dir = await mkdtemp(join(tmpdir(), 'kernel-oauth-browser-'));
const publicUrl = 'https://kernel.example.test';
const store = new Store(join(dir, 'kernel.sqlite'));
const authStore = new AuthStore(join(dir, 'auth.sqlite'));
const kernel = new Kernel(store, [], [], undefined, {
  region: 'westeurope',
  buildSha: 'a'.repeat(40),
});
const principal = {
  issuer: 'https://identity.example.test',
  subject: 'synthetic-subject',
  actorId: 'synthetic-user',
  correlationId: randomUUID(),
  email: 'synthetic@example.test',
};
kernel.control.bootstrapAccount({
  accountId: 'synthetic-account',
  workspaceId: 'synthetic-workspace',
  displayName: 'Synthetic browser fixture',
  members: [{ ...principal, role: 'builder' }],
});
const auth = new HostedAuth(authStore, {
  publicUrl,
  providers: [],
  authorizePrincipal: (p) => {
    assert.ok(kernel.control.session(p).accounts.length);
  },
});
const app = buildApp({
  kernel,
  hosted: { auth, publicUrl, buildSha: 'a'.repeat(40), region: 'westeurope' },
});
const localAddress = await app.listen({ host: '127.0.0.1', port: 0 });
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    join(dir, 'key.pem'),
    '-out',
    join(dir, 'cert.pem'),
    '-subj',
    '/CN=localhost',
    '-days',
    '1',
  ],
  { stdio: 'ignore' },
);
const callbackServer = https.createServer(
  { key: await readFile(join(dir, 'key.pem')), cert: await readFile(join(dir, 'cert.pem')) },
  (request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<p>Registered callback reached</p>');
  },
);
await new Promise<void>((resolve) => callbackServer.listen(0, '127.0.0.1', resolve));
const callbackAddress = callbackServer.address();
assert.ok(callbackAddress && typeof callbackAddress === 'object');
const callback = `https://127.0.0.1:${callbackAddress.port}/callback`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const session = auth.createSession(principal);
  await context.addCookies([
    {
      name: '__Host-kernel_session',
      value: session.token,
      url: publicUrl,
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await context.route(publicUrl + '/**', async (route) => {
    const requested = route.request();
    const url = new URL(requested.url());
    const incomingHeaders = await requested.allHeaders();
    const response = await new Promise<{
      status: number;
      headers: Record<string, string>;
      body: Buffer;
    }>((resolve, reject) => {
      const proxy = http.request(
        localAddress + url.pathname + url.search,
        {
          method: requested.method(),
          headers: { ...incomingHeaders, host: new URL(publicUrl).host },
        },
        (reply) => {
          const parts: Buffer[] = [];
          reply.on('data', (part) => parts.push(Buffer.from(part)));
          reply.on('end', () =>
            resolve({
              status: reply.statusCode!,
              headers: Object.fromEntries(
                Object.entries(reply.headers)
                  .filter(([, value]) => value !== undefined)
                  .map(([key, value]) => [
                    key,
                    Array.isArray(value) ? value.join(',') : String(value),
                  ]),
              ),
              body: Buffer.concat(parts),
            }),
          );
        },
      );
      proxy.on('error', reject);
      proxy.end(requested.postDataBuffer());
    });
    await route.fulfill(response);
  });
  const client = await auth.clientsStore.registerClient({
    redirect_uris: [callback],
    client_name: 'Synthetic browser callback',
    token_endpoint_auth_method: 'none',
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  for (const decision of ['allow', 'deny'] as const) {
    let location = '';
    await auth.authorize(
      client,
      {
        redirectUri: callback,
        codeChallenge: secret(),
        scopes: ['kernel:access'],
        resource: new URL(publicUrl + '/mcp'),
        state: 'synthetic-client-state',
      },
      {
        redirect: (value: string) => {
          location = value;
        },
      } as never,
    );
    assert.ok(location.startsWith('/auth/consent?request='));
    const response = await page.goto(publicUrl + location);
    assert.ok(
      response?.headers()['content-security-policy']?.includes(new URL(callback).origin),
      JSON.stringify({
        status: response?.status(),
        error: response && response.status() >= 400 ? await response.text() : null,
        csp: response?.headers()['content-security-policy'],
      }),
    );
    await page
      .getByRole('button', {
        name: decision === 'allow' ? 'Allow connection' : 'Deny',
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(new RegExp('^' + callback.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await expect(page.getByText('Registered callback reached')).toBeVisible();
    const result = new URL(page.url());
    assert.equal(result.searchParams.get('state'), 'synthetic-client-state');
    if (decision === 'allow') assert.ok(result.searchParams.get('code'));
    else assert.equal(result.searchParams.get('error'), 'access_denied');
  }
  assert.deepEqual(errors, []);
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/oauth-browser-verification.json',
    JSON.stringify(
      {
        status: 'passed',
        checks: [
          'Exact registered callback origin permitted by consent CSP',
          'Browser allow reaches registered HTTPS callback with code and state',
          'Browser deny reaches registered HTTPS callback with error and state',
        ],
        boundary:
          'Synthetic organization session and disposable local HTTPS callback; live IdP and ChatGPT acceptance require separate verification',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'OAuth consent browser checks passed: allow and deny redirects reach the registered callback without CSP violations.',
  );
} finally {
  await browser.close();
  await app.close();
  await new Promise<void>((resolve, reject) =>
    callbackServer.close((error) => (error ? reject(error) : resolve())),
  );
  authStore.close();
  store.close();
  await rm(dir, { recursive: true, force: true });
}

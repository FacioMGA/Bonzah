import { chromium, expect, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer as httpsServer, request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel } from '../src/application/kernel.js';
import type { Configuration } from '../src/contracts/configuration.js';
import type { Principal, TenantSetup } from '../src/contracts/control-plane.js';
import { buildApp } from '../src/server/app.js';
import { HostedAuth, SESSION_COOKIE } from '../src/server/hosted-auth.js';
import { AuthStore } from '../src/storage/auth-store.js';
import { Store } from '../src/storage/store.js';
import { syntheticScopedRequirements } from '../tests/fixtures/requirements.js';

// Actual HTTPS browser -> loopback TLS proxy -> actual Fastify TCP -> canonical services.
// Fixture sessions exercise the hosted session boundary, not a live external identity provider.
const directory = await mkdtemp(join(tmpdir(), 'facio-intern-browser-'));
const database = join(directory, 'kernel.sqlite');
const keyFile = join(directory, 'tls.key');
const certFile = join(directory, 'tls.crt');
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    keyFile,
    '-out',
    certFile,
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
  ],
  { stdio: 'ignore' },
);
const tls = httpsServer({ key: await readFile(keyFile), cert: await readFile(certFile) });
await new Promise<void>((resolve) => tls.listen(0, '127.0.0.1', resolve));
const origin = `https://localhost:${(tls.address() as AddressInfo).port}`;
const store = new Store(database);
const authStore = new AuthStore(join(directory, 'auth.sqlite'));
const buildSha = 'c'.repeat(40);
const kernel = new Kernel(store, [], [], () => new Date('2026-09-06T12:00:00.000Z'), {
  region: 'synthetic-test-region',
  buildSha,
});
const actors: Principal[] = ['intern-one', 'intern-two', 'account-admin', 'account-viewer'].map(
  (actorId) => ({
    issuer: 'https://identity.example.test',
    subject: actorId,
    actorId,
    email: `${actorId}@example.test`,
    correlationId: randomUUID(),
  }),
);
kernel.control.bootstrapAccount({
  accountId: 'synthetic-account',
  workspaceId: 'implementation',
  displayName: 'Synthetic implementation account',
  members: actors.map((actor, index) => ({
    issuer: actor.issuer,
    subject: actor.subject,
    actorId: actor.actorId,
    role: index === 2 ? 'admin' : index === 3 ? 'viewer' : 'builder',
  })),
});
const auth = new HostedAuth(authStore, {
  publicUrl: origin,
  providers: [],
  authorizePrincipal: (principal) => {
    kernel.control.session(principal);
  },
});
const sessions = actors.map((principal) => auth.createSession(principal));
const app = buildApp({
  kernel,
  hosted: { auth, publicUrl: origin, buildSha, region: 'synthetic-test-region' },
  maxRequestsPerMinute: 5000,
});
const backend = new URL(await app.listen({ host: '127.0.0.1', port: 0 }));
tls.on('request', (request, response) => {
  const upstream = httpRequest(
    {
      hostname: '127.0.0.1',
      port: backend.port,
      path: request.url,
      method: request.method,
      headers: request.headers,
    },
    (reply) => {
      response.writeHead(reply.statusCode || 502, reply.headers);
      reply.pipe(response);
    },
  );
  upstream.on('error', () => {
    response.writeHead(502);
    response.end('Local test upstream unavailable');
  });
  request.pipe(upstream);
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const contexts = await Promise.all(
  actors.map(() =>
    browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1050 } }),
  ),
);
for (let index = 0; index < contexts.length; index += 1)
  await contexts[index]!.addCookies([
    {
      name: SESSION_COOKIE,
      value: sessions[index]!.token,
      url: origin,
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
const pages = await Promise.all(contexts.map((context) => context.newPage()));
const errors: string[] = [];
pages.forEach((page) => page.on('pageerror', (error) => errors.push(error.message)));
const checks: string[] = [];
await mkdir('test-results', { recursive: true });

async function request(
  index: number,
  path: string,
  method = 'GET',
  body?: unknown,
  tenantId?: string,
  csrf = true,
) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = httpsRequest(
      new URL(path, origin),
      {
        rejectUnauthorized: false,
        family: 4,
        method,
        headers: {
          cookie: `${SESSION_COOKIE}=${sessions[index]!.token}`,
          ...(tenantId ? { 'X-Kernel-Tenant-Id': tenantId } : {}),
          ...(method !== 'GET' && csrf ? { 'X-CSRF-Token': sessions[index]!.csrfToken } : {}),
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          try {
            resolve({
              status: response.statusCode || 500,
              body: JSON.parse(Buffer.concat(chunks).toString()),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
async function setup(index: number, tenantId: string): Promise<TenantSetup> {
  const result = await request(index, '/api/control/setup', 'GET', undefined, tenantId);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
async function openSetup(page: Page) {
  await page.locator('#primary-nav [data-page="setup"]').click();
  await expect(
    page.getByRole('heading', { name: '1. Attach source requirements', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#refresh-button')).toBeEnabled();
}
async function provisionAndActivate(index: number, name: string, commissionPercent: string) {
  const page = pages[index]!;
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Your customer workspaces' })).toBeVisible();
  await page.getByRole('button', { name: 'Create sandbox tenant', exact: true }).click();
  await page.getByLabel('Sandbox display name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create tenant', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '1. Attach source requirements', exact: true }),
  ).toBeVisible();
  const tenantId = new URL(page.url()).searchParams.get('tenant')!;
  assert.equal(new URL(page.url()).pathname, '/studio');
  await expect(page.locator('#workspace-label')).toHaveText('Studio');
  assert.match(tenantId, /^[a-f0-9-]{36}$/);
  const initial = await setup(index, tenantId);
  assert.equal(initial.tenant.setupStatus, 'awaiting_requirements');
  assert.equal(initial.activeRelease, null);
  await expect(page.getByRole('button', { name: 'Review activation', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Import package', exact: true }).click();
  const profile = {
    ...structuredClone(syntheticScopedRequirements.profile),
    title: `${name} source requirements`,
  };
  await page
    .getByLabel('Requirements package JSON', { exact: true })
    .fill(JSON.stringify(profile, null, 2));
  await page.getByRole('button', { name: 'Attach package', exact: true }).click();
  await expect(page.locator('#workspace-content')).toContainText(
    'Source document claims: unverified',
  );
  const attached = await setup(index, tenantId);
  assert.equal(attached.requirements?.profile.title, profile.title);
  assert.equal(attached.tenant.provisioningState, 'Ready');
  assert.equal(attached.activeRelease, null);
  await page.getByRole('button', { name: 'Configure insurance products', exact: true }).click();
  await page.getByRole('button', { name: 'Definition JSON', exact: true }).click();
  const configuration: Configuration = {
    tenant: {
      displayName: name,
      locale: 'en-GB',
      currency: 'GBP',
      timeZone: 'UTC',
      residency: 'uk',
    },
    operatingEntities: [
      {
        id: initial.tenant.scope.operatingEntityId,
        name: 'Synthetic operating entity',
        territories: ['GB'],
      },
    ],
    products: [
      {
        id: 'manual-cover',
        version: '1.0.0',
        name: `${name} manual cover`,
        operatingEntityId: initial.tenant.scope.operatingEntityId,
        processId: 'manual-process',
        fields: [
          { id: 'risk-description', label: 'Risk description', type: 'text', required: true },
        ],
        requiredCapabilities: ['manual_external_quote', 'exact_money'],
      },
    ],
    processes: [
      {
        id: 'manual-process',
        version: '1.0.0',
        name: 'Synthetic manual process definition',
        initialStage: 'ready',
        stages: [{ id: 'ready', label: 'Ready', terminal: true }],
        transitions: [],
      },
    ],
    integrations: [],
  };
  await page.locator('#configuration-json').fill(JSON.stringify(configuration, null, 2));
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('#notification')).toContainText('Updated');
  await openSetup(page);
  await page.getByRole('button', { name: 'Add executable policy', exact: true }).click();
  await page.getByLabel('Policy display name', { exact: true }).fill(`${name} executable policy`);
  await page.getByLabel('Policy currency', { exact: true }).selectOption('GBP');
  await page.getByLabel('Maximum premium amount', { exact: true }).fill('500,000.00');
  await page.getByLabel('Policy effective from', { exact: true }).fill('2026-01-01');
  await page.getByLabel('Policy effective through', { exact: true }).fill('2030-12-31');
  await page.getByLabel('Maximum participant count', { exact: true }).fill('10');
  await page.getByLabel('Commission rate (%)', { exact: true }).fill(commissionPercent);
  await page
    .getByLabel('Commission recipient identifier', { exact: true })
    .fill('synthetic-broker');
  await page
    .getByLabel('Settlement party identifier', { exact: true })
    .fill('synthetic-settlement');
  for (const label of [
    'Payment prerequisite',
    'Approval prerequisite',
    'Provider Verification prerequisite',
  ])
    await page.getByLabel(label, { exact: true }).selectOption('not_required');
  await page.getByRole('button', { name: 'Save executable policy draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review activation', exact: true })).toBeEnabled();
  const candidate = await setup(index, tenantId);
  assert.equal(candidate.activeRelease, null);
  assert.equal(candidate.runtimeDraft.policies[0]!.maximumPremiumMinor, '50000000');
  await page.getByRole('button', { name: 'Review activation', exact: true }).click();
  await expect(page.locator('.activation-review')).toContainText(candidate.candidate.draftHash);
  await page.getByRole('button', { name: 'Activate sandbox release', exact: true }).click();
  await expect(page.locator('#notification')).toContainText('Sandbox release activated');
  const activated = await setup(index, tenantId);
  assert(activated.activeRelease);
  assert.equal(activated.activeRelease.buildSha, buildSha);
  assert.equal(activated.activeRelease.acceptanceStatus, 'not_recorded');
  await expect(page.locator('.sandbox-readiness')).toContainText('Activated · unverified');
  return { tenantId, release: activated.activeRelease, configuration };
}
async function quote(index: number, label: string) {
  const page = pages[index]!;
  await page.getByRole('button', { name: 'Open Insurance workspace', exact: true }).click();
  assert.equal(new URL(page.url()).pathname, '/studio');
  assert.equal(new URL(page.url()).searchParams.get('view'), 'insurance');
  await expect(page.getByRole('heading', { name: 'No insurance records yet' })).toBeVisible();
  await page.getByRole('button', { name: 'New quote', exact: true }).click();
  await page.getByLabel('Risk description', { exact: true }).fill(label);
  await page.getByLabel('External quote reference', { exact: true }).fill('synthetic-external-001');
  await page.getByLabel('External quote version', { exact: true }).fill('v1');
  await page.getByLabel('Term start', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Term end', { exact: true }).fill('2027-08-31');
  await page.getByLabel('Quote expires at (UTC)', { exact: true }).fill('2026-09-30T12:00');
  await page.getByLabel('Quoted premium (GBP)', { exact: true }).fill('1000.00');
  await page
    .getByLabel('Source evidence references', { exact: true })
    .fill('fixture://synthetic-quote-001');
  await page.getByLabel('Participant 1 identifier', { exact: true }).fill('synthetic-lead');
  await page.getByLabel('Participant 1 share (%)', { exact: true }).fill('100.00');
  await page.getByRole('button', { name: 'Create quote', exact: true }).click();
  await expect(page.locator('.insurance-record-detail')).toContainText('current revision 1');
}

let first: Awaited<ReturnType<typeof provisionAndActivate>> | undefined;
let second: Awaited<ReturnType<typeof provisionAndActivate>> | undefined;
try {
  const anonymous = await browser.newContext({ ignoreHTTPSErrors: true });
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto(origin);
  await expect(
    anonymousPage.getByRole('link', { name: 'Sign in with Facio', exact: true }),
  ).toBeVisible();
  await expect(anonymousPage.locator('#login-form')).toBeHidden();
  await expect(anonymousPage).toHaveTitle('Facio Platform');
  await anonymous.close();
  first = await provisionAndActivate(0, 'Synthetic tenant Alpha', '7.00');
  second = await provisionAndActivate(1, 'Synthetic tenant Beta', '11.00');
  assert.notEqual(first.tenantId, second.tenantId);
  assert.notEqual(first.release.hash, second.release.hash);
  assert.equal(first.release.runtimeDraft.policies[0]!.commission.rateBps, 700);
  assert.equal(second.release.runtimeDraft.policies[0]!.commission.rateBps, 1100);
  checks.push(
    'Individual hosted fixture sessions provisioned two separate durable tenants on one HTTPS build; organization sign-in shown for anonymous access; external IdP sign-in is not claimed',
  );
  checks.push(
    'Both interns imported typed requirements without rebuilding, saved configuration through the existing editor, authored exact decimal policy configuration and activated exact immutable candidates',
  );

  await quote(0, 'Synthetic Alpha risk');
  await quote(1, 'Synthetic Beta risk');
  await expect(pages[0]!.locator('.insurance-money-summary')).toContainText('GBP 70.00');
  await expect(pages[1]!.locator('.insurance-money-summary')).toContainText('GBP 110.00');
  await expect(pages[0]!.locator('.insurance-record-detail')).toContainText(first.release.id);
  await expect(pages[1]!.locator('.insurance-record-detail')).toContainText(second.release.id);
  const firstRecords = await request(0, '/api/insurance/records', 'GET', undefined, first.tenantId);
  const record = firstRecords.body.records[0];
  assert.equal(record.runtimeReleaseId, first.release.id);
  assert.equal(
    (await request(0, '/api/insurance/records', 'GET', undefined, second.tenantId)).status,
    403,
  );
  assert.equal(
    (await request(1, '/api/control/setup', 'GET', undefined, first.tenantId)).status,
    403,
  );
  const noCsrf = await request(
    0,
    '/api/control/runtime-draft',
    'PUT',
    {
      expectedVersion: 2,
      policies: first.release.runtimeDraft.policies,
      idempotencyKey: randomUUID(),
    },
    first.tenantId,
    false,
  );
  assert.equal(noCsrf.status, 403);
  checks.push(
    'Same Insurance workspace executed different activated policies and retained per-record release IDs; cross-tenant reads and a mutation without CSRF were rejected by actual HTTPS endpoints',
  );

  const page = pages[0]!;
  await openSetup(page);
  await page.getByRole('button', { name: 'Review activation', exact: true }).click();
  const oldCandidate = await setup(0, first.tenantId);
  const concurrent = await request(
    0,
    '/api/control/runtime-draft',
    'PUT',
    {
      expectedVersion: oldCandidate.runtimeDraft.version,
      policies: oldCandidate.runtimeDraft.policies.map((policy) => ({
        ...policy,
        commission: { ...policy.commission, rateBps: 900 },
      })),
      idempotencyKey: randomUUID(),
    },
    first.tenantId,
  );
  assert.equal(concurrent.status, 200);
  await page.getByRole('button', { name: 'Activate sandbox release', exact: true }).click();
  await expect(page.locator('#notification')).toContainText('candidate or revision changed');
  assert.equal((await setup(0, first.tenantId)).activeRelease!.id, first.release.id);
  await page.locator('#refresh-button').click();
  await expect(page.getByRole('button', { name: 'Review activation', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Review activation', exact: true }).click();
  await page.getByRole('button', { name: 'Activate sandbox release', exact: true }).click();
  await expect(page.locator('#notification')).toContainText('Sandbox release activated');
  const nextRelease = (await setup(0, first.tenantId)).activeRelease!;
  assert.notEqual(nextRelease.id, first.release.id);
  await page.getByRole('button', { name: 'Open Insurance workspace', exact: true }).click();
  await page.locator(`[data-insurance-record="${record.id}"]`).click();
  await page.getByRole('button', { name: 'Bind selected quote', exact: true }).click();
  await expect(page.locator('.insurance-record-detail')).toContainText('current revision 2');
  await expect(page.locator('.insurance-record-detail')).toContainText(first.release.id);
  await expect(page.locator('.insurance-money-summary')).toContainText('GBP 70.00');
  checks.push(
    'A concurrent policy draft change rejected stale activation; a fresh release activated without changing the original quote, which bound against its retained original release and commission',
  );

  await openSetup(page);
  await page.getByText('Activation recovery and MCP connections', { exact: true }).click();
  await page.getByLabel('Retained release ID to restore', { exact: true }).fill(first.release.id);
  await page.getByRole('button', { name: 'Restore retained sandbox release', exact: true }).click();
  await expect(page.locator(`#deployment-context code[title="${first.release.id}"]`)).toBeVisible();
  assert.equal((await setup(0, first.tenantId)).runtimeDraft.policies[0]!.commission.rateBps, 900);
  const retained = (
    await request(
      0,
      `/api/insurance/record?recordId=${record.id}`,
      'GET',
      undefined,
      first.tenantId,
    )
  ).body.record;
  assert.equal(retained.version, 2);
  assert.equal(retained.runtimeReleaseId, first.release.id);
  checks.push(
    'Rollback selected the retained release by exact active-release precondition without reverting policy drafts or insurance transactions',
  );

  const grantId = authStore.grant(actors[0]!.actorId, 'synthetic-mcp-client', 60000);
  await page.getByText('Activation recovery and MCP connections', { exact: true }).click();
  await page.getByRole('button', { name: 'Inspect MCP connections', exact: true }).click();
  await expect(page.locator('#detail-dialog')).toContainText('synthetic-mcp-client');
  await page.getByRole('button', { name: 'Disconnect all MCP connections', exact: true }).click();
  await expect(page.locator('#detail-dialog')).toContainText('MCP connections revoked');
  assert.equal(authStore.validGrant(grantId), false);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  checks.push(
    'Own MCP connection inspection and revocation operated through CSRF-protected hosted HTTP; no actual ChatGPT authorization is claimed',
  );

  await page.locator('#refresh-button').click();
  await expect(page.locator('#refresh-button')).toBeEnabled();
  await page.screenshot({
    path: 'test-results/intern-sandbox-setup.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  assert(width.scroll <= width.client + 1, 'Hosted setup overflows on mobile');
  await page.screenshot({
    path: 'test-results/intern-sandbox-setup-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  checks.push(
    'Hosted setup, three readiness dimensions, runtime draft and activation evidence render on desktop and mobile without horizontal overflow',
  );

  let releaseRead: (() => void) | undefined;
  let markRead: (() => void) | undefined;
  const readStarted = new Promise<void>((resolve) => {
    markRead = resolve;
  });
  const delayed = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  await page.route('**/api/control/setup', async (route) => {
    const response = await route.fetch();
    markRead!();
    await delayed;
    await route.fulfill({ response });
  });
  await page.locator('#refresh-button').click();
  await readStarted;
  await expect(page.locator('#switch-sandbox')).toBeDisabled();
  const selectedBefore = page.url();
  await page.locator('#primary-nav [data-page="sandboxes"]').click();
  assert.equal(page.url(), selectedBefore);
  releaseRead!();
  await expect(page.locator('#refresh-button')).toBeEnabled();
  await page.unroute('**/api/control/setup');
  await page.locator('#switch-sandbox').click();
  await expect(page.getByRole('heading', { name: 'Your customer workspaces' })).toBeVisible();
  assert.equal(new URL(page.url()).pathname, '/');
  const studioLink = page.getByRole('link', { name: 'Open Studio', exact: true });
  await expect(studioLink).toHaveAttribute('href', `/studio?tenant=${first.tenantId}`);
  await studioLink.click();
  await expect(page.locator('#workspace-label')).toHaveText('Studio');
  assert.equal(new URL(page.url()).pathname, '/studio');
  assert.equal(new URL(page.url()).searchParams.get('tenant'), first.tenantId);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sandbox setup', exact: true })).toBeVisible();
  await page.locator('#switch-sandbox').click();
  await expect(page.getByRole('heading', { name: 'Your customer workspaces' })).toBeVisible();
  await expect(page.locator('.sandbox-tenant')).toHaveCount(1);
  await expect(page.locator('.sandbox-tenant')).not.toContainText('Synthetic tenant Beta');
  await expect(page.locator('.insurance-record-detail')).toHaveCount(0);
  await page.goto(`${origin}/?tenant=${second.tenantId}&view=insurance`);
  await expect(page.locator('#workspace-content')).toContainText(
    'not in your current authorized account list',
  );
  await expect(page.locator('.insurance-record-detail')).toHaveCount(0);
  checks.push(
    'Tenant switching is blocked during pending scoped reads, and switching clears prior tenant data; an unauthorized deep link cannot select or display another tenant',
  );

  await pages[3]!.goto(origin);
  await expect(pages[3]!.getByRole('heading', { name: 'Your customer workspaces' })).toBeVisible();
  await expect(
    pages[3]!.getByRole('button', { name: 'Create sandbox tenant', exact: true }),
  ).toHaveCount(0);
  await expect(pages[3]!.locator('.sandbox-tenant')).toHaveCount(0);
  const revoked = await request(2, '/api/control/memberships/revoke', 'POST', {
    accountId: 'synthetic-account',
    actorId: actors[1]!.actorId,
    idempotencyKey: randomUUID(),
  });
  assert.equal(revoked.status, 200);
  await pages[1]!.reload();
  await expect(pages[1]!.locator('.sandbox-tenant')).toHaveCount(0);
  await expect(pages[1]!.locator('.insurance-record-detail')).toHaveCount(0);
  assert.equal(
    (await request(1, '/api/control/setup', 'GET', undefined, second.tenantId)).status,
    403,
  );
  checks.push(
    'Viewer cannot provision or discover unassigned tenants; admin membership revocation removes existing-session access on subsequent UI/HTTP requests',
  );

  await page.goto(`${origin}/?tenant=${first.tenantId}&view=insurance`);
  await expect(page.locator(`[data-insurance-record="${record.id}"]`)).toBeVisible();
  assert.equal(new URL(page.url()).pathname, '/', 'Legacy tenant URLs remain compatible');
  await page.locator('#logout-button').click();
  await expect(page.getByRole('link', { name: 'Sign in with Facio', exact: true })).toBeVisible();
  assert.equal((await request(0, '/api/session')).status, 401);
  const reopened = new Store(database);
  try {
    const saved = reopened.insuranceRead(first.release.scope, record.id);
    assert.equal(saved.version, 2);
    assert.equal(saved.runtimeReleaseId, first.release.id);
    assert.equal(reopened.control.release(first.release.scope)!.id, first.release.id);
  } finally {
    reopened.close();
  }
  checks.push(
    'Fresh HTTPS deep link recovers server state; logout invalidates the browser session; a separate database connection recovers active release and pinned insurance history',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    'test-results/intern-browser-evidence.json',
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        transport: 'actual HTTPS localhost proxy to actual Fastify TCP server',
        identityBoundary:
          'synthetic principals with server-created hosted sessions; external IdP and actual ChatGPT not exercised',
        buildSha,
        checks,
        browserErrors: errors,
        productionReady: false,
        customerAcceptance: 'not_recorded',
        screenshots: ['intern-sandbox-setup.png', 'intern-sandbox-setup-mobile.png'],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      checks: checks.length,
      browserErrors: errors,
      tenants: 2,
      https: true,
      externalIdentityVerified: false,
      productionReady: false,
    }),
  );
} finally {
  await browser.close();
  await new Promise<void>((resolve) => tls.close(() => resolve()));
  await app.close();
  store.close();
  authStore.close();
  await rm(directory, { recursive: true, force: true });
}

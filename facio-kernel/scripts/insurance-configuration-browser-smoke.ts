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
const directory = await mkdtemp(join(tmpdir(), 'facio-configuration-browser-'));
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
const page = pages[0]!;
async function fill(id: string, value: string) {
  await page.locator('#ic-' + id).fill(value);
}
async function section(id: string) {
  await page.locator(`[data-ic-section="${id}"]`).click();
}
async function activate(tenantId: string) {
  const candidate = (await setup(0, tenantId)).candidate;
  const { draftVersion, draftHash, requirementsHash, runtimeDraftVersion, runtimeDraftHash } =
    candidate;
  const result = await request(
    0,
    '/api/control/activate',
    'POST',
    {
      draftVersion,
      draftHash,
      requirementsHash,
      runtimeDraftVersion,
      runtimeDraftHash,
      idempotencyKey: randomUUID(),
    },
    tenantId,
  );
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return (await setup(0, tenantId)).activeRelease!;
}
try {
  const created = await request(0, '/api/control/tenants', 'POST', {
    accountId: 'synthetic-account',
    displayName: 'Insurance configuration training',
    environment: 'sandbox',
    region: 'synthetic-test-region',
    idempotencyKey: randomUUID(),
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const tenantId = created.body.tenant.id as string;
  const initial = await setup(0, tenantId);
  const attached = await request(
    0,
    '/api/control/requirements',
    'PUT',
    {
      expectedVersion: 0,
      profile: syntheticScopedRequirements.profile,
      idempotencyKey: randomUUID(),
    },
    tenantId,
  );
  assert.equal(attached.status, 200);
  const configuration: Configuration = {
    tenant: {
      displayName: 'Insurance configuration training',
      locale: 'en-GB',
      currency: 'GBP',
      timeZone: 'UTC',
      residency: 'uk',
    },
    operatingEntities: [
      { id: initial.tenant.scope.operatingEntityId, name: 'Training entity', territories: ['GB'] },
    ],
    products: [],
    processes: [
      {
        id: 'training-process',
        version: '1.0.0',
        name: 'Training process',
        initialStage: 'review',
        stages: [{ id: 'review', label: 'Review', terminal: true }],
        transitions: [],
      },
    ],
    integrations: [],
  };
  const initialSnapshot = await request(
    0,
    '/api/configuration?view=draft',
    'GET',
    undefined,
    tenantId,
  );
  const seeded = await request(
    0,
    '/api/draft',
    'PUT',
    { configuration, expectedVersion: initialSnapshot.body.version, idempotencyKey: randomUUID() },
    tenantId,
  );
  assert.equal(seeded.status, 200, JSON.stringify(seeded.body));
  await page.goto(origin + '/studio?tenant=' + tenantId);
  await page.locator('#primary-nav [data-page="products"]').click();
  await page.getByRole('button', { name: 'Create insurance product', exact: true }).click();
  for (const [id, value] of Object.entries({
    id: 'configured-cover',
    version: '1.0.0',
    name: 'Training property cover',
    'insurance-territories': 'GB',
    'insurance-sourceRefs': 'fixture://training-only',
  }))
    await fill(id, value);
  await page.locator('#ic-operatingEntityId').selectOption(initial.tenant.scope.operatingEntityId);
  await page.locator('#ic-processId').selectOption('training-process');
  await fill('insurance-termRules-minimumDays', '1');
  await fill('insurance-termRules-maximumDays', '366');
  await page.locator('#ic-insurance-termRules-backdating').selectOption('not_permitted');
  await section('questions');
  await page.getByRole('button', { name: 'Add risk question', exact: true }).click();
  for (const [id, value] of Object.entries({
    id: 'employees',
    label: 'Employees',
    description: 'Number of people employed at the fictional risk.',
    sourceRefs: 'fixture://training-only#employees',
  }))
    await fill('insurance-riskFields-0-' + id, value);
  await page.locator('#ic-insurance-riskFields-0-type').selectOption('integer');
  await fill('insurance-riskFields-0-minimum', '0');
  await fill('insurance-riskFields-0-maximum', '1000');
  await page.locator('#ic-insurance-riskFields-0-required').check();
  await section('coverages');
  await page.getByRole('button', { name: 'Add coverage', exact: true }).click();
  for (const [id, value] of Object.entries({
    id: 'buildings',
    name: 'Buildings',
    description: 'Fictional material damage coverage.',
    sourceRefs: 'fixture://training-only#buildings',
    'limit-minimumMinor': '1000.00',
    'limit-maximumMinor': '1000000.00',
    'deductible-minimumMinor': '0',
    'deductible-maximumMinor': '10000.00',
    'rate-premiumMinor': '100.00',
  }))
    await fill('insurance-coverages-0-' + id, value);
  await page.locator('#ic-insurance-coverages-0-required').check();
  await page.locator('#ic-insurance-coverages-0-basis').selectOption('single_risk_per_occurrence');
  await page.locator('#main-content').focus();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'test-results/insurance-authoring-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.locator('#sidebar').evaluate((el) => el.getBoundingClientRect().right))
    .toBeLessThanOrEqual(1);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({
    path: 'test-results/insurance-authoring-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await section('rules');
  await page.getByRole('button', { name: 'Add decision rule', exact: true }).click();
  for (const [id, value] of Object.entries({
    id: 'employee-referral',
    reason: 'Risks with more than 50 employees require an underwriter.',
    sourceRefs: 'fixture://training-only#referral',
  }))
    await fill('insurance-eligibilityRules-0-' + id, value);
  await page
    .locator('#ic-insurance-eligibilityRules-0-when-conditions-0-fieldId')
    .selectOption('employees');
  await page
    .locator('#ic-insurance-eligibilityRules-0-when-conditions-0-operator')
    .selectOption('gt');
  await fill('insurance-eligibilityRules-0-when-conditions-0-value', '50');
  await section('rating');
  await fill('insurance-rating-minimumPremiumMinor', '25.00');
  await section('authority');
  await fill('insurance-authority-maximumPremiumMinor', '1000.00');
  await fill('insurance-authority-maximumTotalLimitMinor', '1000000.00');
  await fill('insurance-authority-sourceRefs', 'fixture://training-only#authority');
  await page.getByRole('button', { name: 'Save product definition', exact: true }).click();
  await expect(page.locator('#notification')).toContainText('Updated');
  const saved = await request(0, '/api/configuration?view=draft', 'GET', undefined, tenantId);
  const product = saved.body.configuration.products[0];
  assert.equal(product.insurance.coverages[0].rate.premiumMinor, '10000');
  assert.equal(product.insurance.eligibilityRules[0].when.conditions[0].value, 50);
  assert.equal(product.insurance.pricingOwnership, 'kernel_deterministic');
  assert.deepEqual(product.fields, []);
  checks.push(
    'An intern authored a versioned product, typed risk question, exact-money coverage, referral rule, rating floor and authority through structured Studio controls without JSON.',
  );
  const beforePolicy = await setup(0, tenantId);
  const policy = {
    id: 'configured-cover',
    version: '1.0.0',
    name: 'Training operating policy',
    currency: 'GBP',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2027-12-31',
    maximumPremiumMinor: '1000000',
    maximumParticipants: 10,
    commission: {
      rateBps: 700,
      base: 'gross_premium',
      recipientId: 'synthetic-broker',
      settlementPartyId: 'synthetic-settlement',
      cashCustody: 'external',
    },
    requirements: {
      payment: 'not_required',
      approval: 'not_required',
      providerVerification: 'not_required',
    },
  };
  const policyResult = await request(
    0,
    '/api/control/runtime-draft',
    'PUT',
    {
      expectedVersion: beforePolicy.runtimeDraft.version,
      policies: [policy],
      idempotencyKey: randomUUID(),
    },
    tenantId,
  );
  assert.equal(policyResult.status, 200, JSON.stringify(policyResult.body));
  const release = await activate(tenantId);
  await page.locator('#primary-nav [data-page="insurance"]').click();
  await page.getByRole('button', { name: 'New quote', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Evaluate a configured risk', exact: true }),
  ).toBeVisible();
  for (const [label, value] of Object.entries({
    'Risk description': 'Fictional office building',
    'Submission reference': 'training-001',
    'Submission version': '1',
    'Term start': '2026-09-06',
    'Term end': '2027-09-05',
    'Quote expires at (UTC)': '2026-09-30T12:00',
    'Submission evidence references': 'fixture://training-only#risk',
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel('Risk territory', { exact: true }).selectOption('GB');
  await page.getByRole('button', { name: 'Evaluate risk', exact: true }).click();
  await expect(page.locator('.decision-result')).toContainText('Invalid');
  await expect(page.locator('.decision-result')).toContainText('Binding blocked');
  await expect(
    page.getByRole('button', { name: 'Retain evaluated quote', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Employees', { exact: true }).fill('60');
  await page.locator('[name="coverage-buildings-selected"]').check();
  await page.locator('[name="coverage-buildings-limit"]').fill('100000.00');
  await page.locator('[name="coverage-buildings-deductible"]').fill('500.00');
  await page.getByRole('button', { name: 'Evaluate risk', exact: true }).click();
  await expect(page.locator('.decision-result')).toContainText('employee-referral');
  await expect(page.locator('.decision-result')).toContainText('Binding blocked');
  await expect(page.locator('.decision-result')).toContainText('GBP 100.00');
  checks.push(
    'Active server preview reports missing answers and selections, then a priced referral with rule/source evidence. No policy record is created by evaluation.',
  );
  assert.deepEqual(
    (await request(0, '/api/insurance/records', 'GET', undefined, tenantId)).body.records,
    [],
  );
  await page.getByLabel('Employees', { exact: true }).fill('10');
  await expect(page.locator('.decision-result')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Retain evaluated quote', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Participant 1 identifier', { exact: true }).fill('synthetic-lead');
  await page.getByLabel('Participant 1 share (%)', { exact: true }).fill('100.00');
  const previewResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/insurance/evaluate') && response.status() === 200,
  );
  await page.getByRole('button', { name: 'Evaluate risk', exact: true }).click();
  const evaluated = await (await previewResponse).json();
  await expect(page.locator('.decision-result')).toContainText('Bind checks passed');
  await page.getByRole('button', { name: 'Retain evaluated quote', exact: true }).click();
  await expect(page.locator('.insurance-record-detail')).toContainText('current revision 1');
  const record = (await request(0, '/api/insurance/records', 'GET', undefined, tenantId)).body
    .records[0];
  assert.equal(record.sourceMode, 'configured_product');
  assert.equal(record.decision.evaluation.evaluationHash, evaluated.evaluationHash);
  assert.equal(record.premiumMinor, '10000');
  assert.equal(record.runtimeReleaseId, release.id);
  const repeated = await request(
    0,
    '/api/insurance/evaluate',
    'POST',
    {
      productId: 'configured-cover',
      productVersion: '1.0.0',
      submission: record.decision.submission,
    },
    tenantId,
  );
  assert.equal(repeated.body.evaluationHash, evaluated.evaluationHash);
  const changed = structuredClone(saved.body.configuration);
  changed.products[0].insurance.coverages[0].rate.premiumMinor = '20000';
  const modified = await request(
    0,
    '/api/draft',
    'PUT',
    { expectedVersion: saved.body.version, configuration: changed, idempotencyKey: randomUUID() },
    tenantId,
  );
  assert.equal(modified.status, 200, JSON.stringify(modified.body));
  const changedRelease = await activate(tenantId);
  assert.notEqual(changedRelease.id, release.id);
  await page.getByRole('button', { name: 'Bind selected quote', exact: true }).click();
  await expect(page.locator('.insurance-record-detail')).toContainText('current revision 2');
  const bound = (
    await request(0, '/api/insurance/record?recordId=' + record.id, 'GET', undefined, tenantId)
  ).body.record;
  assert.equal(bound.status, 'bound');
  assert.equal(bound.runtimeReleaseId, release.id);
  assert.equal(bound.premiumMinor, '10000');
  await expect(
    page.getByRole('button', { name: 'Manual policy change', exact: true }),
  ).toBeDisabled();
  assert.equal(
    (await request(1, '/api/insurance/record?recordId=' + record.id, 'GET', undefined, tenantId))
      .status,
    403,
  );
  checks.push(
    'The UI and direct API produce identical decision hashes; quote capture retains the full decision; a later active price does not change the historical quote or its bind decision; another intern cannot read this tenant.',
  );
  await page.locator('#main-content').focus();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'test-results/insurance-configuration-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({
    path: 'test-results/insurance-configuration-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  assert.deepEqual(errors, []);
  checks.push(
    'Desktop and 390px mobile insurance decision rendering complete without page errors or horizontal overflow.',
  );
  await writeFile(
    'test-results/insurance-configuration-browser.json',
    JSON.stringify({ passed: true, origin, buildSha, checks, errors }, null, 2) + '\n',
  );
  console.log(JSON.stringify({ passed: true, checks: checks.length, errors }));
} catch (error) {
  await page
    .screenshot({
      path: 'test-results/insurance-configuration-failure.png',
      fullPage: true,
      animations: 'disabled',
    })
    .catch(() => {});
  await writeFile(
    'test-results/insurance-configuration-browser.json',
    JSON.stringify({ passed: false, checks, errors, error: String(error) }, null, 2) + '\n',
  );
  throw error;
} finally {
  await browser.close();
  await app.close();
  await new Promise<void>((resolve, reject) =>
    tls.close((error) => (error ? reject(error) : resolve())),
  );
  authStore.close();
  store.close();
  await rm(directory, { recursive: true, force: true });
}

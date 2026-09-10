import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel } from '../src/application/kernel.js';
import type { Scope } from '../src/contracts/configuration.js';
import { runtimePolicySchema } from '../src/contracts/insurance.js';
import { hash } from '../src/domain/canonical.js';
import { incompleteConfiguration } from '../src/fixtures/reference.js';
import { buildApp } from '../src/server/app.js';
import type { Credential } from '../src/server/auth.js';
import { Store } from '../src/storage/store.js';

// Isolated fictional inputs exercise real HTTP/UI/storage behavior, not customer acceptance.
const directory = await mkdtemp(join(tmpdir(), 'facio-insurance-browser-'));
const database = join(directory, 'insurance.sqlite');
const store = new Store(database);
const scope: Scope = {
  workspaceId: 'browser',
  tenantId: 'synthetic-insurance',
  environment: 'development',
  operatingEntityId: 'synthetic-entity',
};
const sourceOnlyScope: Scope = { ...scope, tenantId: 'source-only' };
store.seed(scope, incompleteConfiguration);
store.seed(sourceOnlyScope, incompleteConfiguration);
const policy = runtimePolicySchema.parse({
  id: 'synthetic-placement',
  version: '1.0.0',
  name: 'Synthetic capacity placement',
  currency: 'GBP',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2030-12-31',
  maximumPremiumMinor: '999999999999999999',
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
});
const alternatePolicy = runtimePolicySchema.parse({
  ...policy,
  id: 'synthetic-three-decimal',
  name: 'Synthetic exact currency exercise',
  currency: 'KWD',
});
const credentials: Credential[] = [
  {
    token: randomBytes(32).toString('hex'),
    context: {
      ...scope,
      actorId: 'browser-writer',
      permissions: [
        'configuration:read',
        'insurance:read',
        'insurance:quote',
        'insurance:bind',
        'insurance:service',
      ],
    },
  },
  {
    token: randomBytes(32).toString('hex'),
    context: {
      ...scope,
      actorId: 'browser-reader',
      permissions: ['configuration:read', 'insurance:read'],
    },
  },
  {
    token: randomBytes(32).toString('hex'),
    context: {
      ...sourceOnlyScope,
      actorId: 'source-reader',
      permissions: ['configuration:read', 'insurance:read'],
    },
  },
  {
    token: randomBytes(32).toString('hex'),
    context: {
      ...sourceOnlyScope,
      actorId: 'configuration-reader',
      permissions: ['configuration:read'],
    },
  },
];
const app = buildApp({
  kernel: new Kernel(
    store,
    [],
    [policy, alternatePolicy].map((entry) => ({ scope, policy: entry, policyHash: hash(entry) })),
    () => new Date('2026-09-06T12:00:00.000Z'),
  ),
  credentials,
  maxRequestsPerMinute: 1000,
});
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const browserErrors: string[] = [];
const checks: string[] = [];
page.on('pageerror', (error) => browserErrors.push(error.message));
await mkdir('test-results', { recursive: true });

async function login(index: number) {
  await page.locator('#access-token').fill(credentials[index]!.token);
  await page.locator('#login-submit').click();
  await expect(page.locator('#app-shell')).toBeVisible();
  await expect(page.locator('#loading-state')).toBeHidden();
  await page.getByRole('button', { name: 'Insurance workspace', exact: true }).click();
}
async function expectRevision(version: number, status: string) {
  await expect(page.locator('.insurance-record-detail .panel-heading')).toContainText(
    `current revision ${version}`,
  );
  await expect(page.locator('.insurance-record-detail .panel-heading .tag')).toHaveText(status);
  await expect(page.locator('.insurance-history-item')).toHaveCount(version);
  await expect(page.locator('#refresh-button')).toBeEnabled();
}
async function checkMobile(name: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const dimensions = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  assert(dimensions.scroll <= dimensions.client + 1, `${name}: mobile content overflows`);
  await page.screenshot({
    path: `test-results/${name}.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
}
async function service(action: string, delta: string, reason: string) {
  await page.getByRole('button', { name: 'Manual policy change', exact: true }).click();
  await page.getByLabel('Action', { exact: true }).selectOption(action);
  await page.getByLabel('Effective date', { exact: true }).fill('2026-09-06');
  await page.getByLabel('Premium change (GBP)', { exact: true }).fill(delta);
  await page.getByLabel('Reason and external decision reference').fill(reason);
  await page.getByRole('button', { name: 'Record policy change', exact: true }).click();
}

let recordId = '';
let originalHash = '';
let expectedFinalHash = '';
try {
  await page.goto(address);
  await login(0);
  await expect(page.getByRole('heading', { name: 'No insurance records yet' })).toBeVisible();
  await expect(page.locator('#workspace-content')).toContainText(
    'do not create production policies',
  );
  await expect(page.locator('#view-draft')).toBeHidden();
  await page.getByRole('button', { name: 'New quote' }).click();
  await page.getByLabel('Registered product version').selectOption('synthetic-placement@1.0.0');
  await page
    .getByLabel('Risk description', { exact: true })
    .fill('Fictional warehouse capacity exercise');
  await page.getByLabel('External risk reference', { exact: true }).fill('synthetic-risk-001');
  await page.getByLabel('External quote reference', { exact: true }).fill('synthetic-quote-001');
  await page.getByLabel('External quote version', { exact: true }).fill('external-v1');
  await page.getByLabel('Term start', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Term end', { exact: true }).fill('2027-08-31');
  await page.getByLabel('Quote expires at (UTC)', { exact: true }).fill('2026-09-30T12:00');
  await page.getByLabel('Quoted premium (GBP)', { exact: true }).fill('500,000.001');
  await page
    .getByLabel('Source evidence references', { exact: true })
    .fill('fixture://synthetic-external-quote/v1');
  await page.getByLabel('Participant 1 identifier', { exact: true }).fill('synthetic-lead');
  await page.getByLabel('Participant 1 share (%)', { exact: true }).fill('60.00');
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Add participant', exact: true }).click();
  await page.getByLabel('Participant 2 identifier', { exact: true }).fill('synthetic-follow');
  await page.getByLabel('Participant 2 share (%)', { exact: true }).fill('30.00');
  await page.getByRole('button', { name: 'Create quote', exact: true }).click();
  await expect(page.locator('#notification')).toContainText('use at most 2 decimal places');
  assert.equal(store.insuranceList(scope).records.length, 0);
  await page.getByLabel('Quoted premium (GBP)', { exact: true }).fill('500,000.00');
  await page.getByLabel('Participant 1 share (%)', { exact: true }).fill('60.001');
  await page.getByRole('button', { name: 'Create quote', exact: true }).click();
  await expect(page.locator('#notification')).toContainText('use at most 2 decimal places');
  assert.equal(store.insuranceList(scope).records.length, 0);
  await page.getByLabel('Participant 1 share (%)', { exact: true }).fill('60.00');
  await page.getByRole('button', { name: 'Create quote', exact: true }).click();
  await expect(page.locator('#notification')).toContainText('The command was not accepted');
  assert.equal(store.insuranceList(scope).records.length, 0);
  await expect(page.getByLabel('Quoted premium (GBP)', { exact: true })).toHaveValue('500,000.00');
  await page.getByLabel('Participant 2 share (%)', { exact: true }).fill('40.00');
  await checkMobile('insurance-quote-mobile');
  checks.push(
    'Scoped registered product drives decimal currency and percentage fields; excess monetary and share precision rejected without rounding; variable capacity inputs preserve values after real server rejection of an invalid share total; mobile form has no overflow',
  );

  await page.getByRole('button', { name: 'Create quote', exact: true }).click();
  await expectRevision(1, 'Quoted');
  await expect(
    page.getByRole('button', { name: 'Manual policy change', exact: true }),
  ).toBeDisabled();
  const original = store.insuranceList(scope).records[0]!;
  recordId = original.id;
  originalHash = original.recordHash;
  assert.equal(original.premiumMinor, '50000000');
  assert.equal(original.quote.sourceQuote.version, 'external-v1');
  assert.deepEqual(
    original.financials.allocations.map((entry) => [entry.participantId, entry.premiumMinor]),
    [
      ['synthetic-follow', '20000000'],
      ['synthetic-lead', '30000000'],
    ],
  );
  await expect(page.locator('.insurance-money-summary')).toContainText('GBP 500,000.00');
  await expect(page.locator('.insurance-money-summary')).toContainText('GBP 35,000.00');
  checks.push(
    'UI converted GBP 500,000.00 to exactly 50000000 minor units and 60.00%/40.00% to 6000/4000 bps in a persisted external quote with canonical allocations and separate external-custody commission',
  );

  await page.getByRole('button', { name: 'Revise quote', exact: true }).click();
  await expect(page.getByLabel('Registered product version')).toBeDisabled();
  await expect(page.getByLabel('Quoted premium (GBP)', { exact: true })).toHaveValue('500000.00');
  await expect(page.getByLabel('Participant 1 share (%)', { exact: true })).toHaveValue('60.00');
  await page.getByLabel('External quote version', { exact: true }).fill('external-v2');
  await page.getByLabel('Quoted premium (GBP)', { exact: true }).fill('1000.03');
  await page.getByRole('button', { name: 'Save quote revision', exact: true }).click();
  await expectRevision(2, 'Quoted');
  const second = store.insuranceRead(scope, recordId);
  const competing = await app.inject({
    method: 'PUT',
    url: '/api/insurance/quotes',
    headers: { authorization: `Bearer ${credentials[0]!.token}` },
    payload: {
      idempotencyKey: randomUUID(),
      recordId,
      expectedVersion: second.version,
      recordHash: second.recordHash,
      quote: {
        ...second.quote,
        sourceQuote: { ...second.quote.sourceQuote, version: 'external-v3' },
        premiumMinor: '100005',
      },
    },
  });
  assert.equal(competing.statusCode, 200, competing.body);
  await page.getByRole('button', { name: 'Bind selected quote', exact: true }).click();
  await expect(page.locator('#notification')).toContainText('selected record or quote is stale');
  assert.equal(store.insuranceRead(scope, recordId).status, 'quoted');
  assert.equal(store.insuranceRead(scope, recordId).version, 3);
  await page.locator('#refresh-button').click();
  await expectRevision(3, 'Quoted');
  await page.getByRole('button', { name: 'Bind selected quote', exact: true }).click();
  await expectRevision(4, 'Bound');
  await expect(
    page.getByRole('button', { name: 'Bind selected quote', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Revise quote', exact: true })).toBeDisabled();
  assert.equal(store.insuranceRead(scope, recordId).quote.sourceQuote.version, 'external-v3');
  checks.push(
    'UI quote revision retained original history; competing actual HTTP revision invalidated the selected bind hash; refresh then bound exactly the new selected quote',
  );

  await service('endorsement', '+250.01', 'Synthetic external adjustment ref endorsement-001');
  await expectRevision(5, 'Bound');
  assert.equal(store.insuranceRead(scope, recordId).premiumMinor, '125006');
  assert.equal(store.insuranceRead(scope, recordId).quote.premiumMinor, '100005');
  await service('cancellation', '-1250.06', 'Synthetic external adjustment ref cancellation-001');
  await expectRevision(6, 'Cancelled');
  assert.equal(store.insuranceRead(scope, recordId).premiumMinor, '0');
  await service('reinstatement', '1250.06', 'Synthetic external adjustment ref reinstatement-001');
  await expectRevision(7, 'Bound');
  const history = store.insuranceHistory(scope, recordId);
  assert.equal(history.revisions[0]!.recordHash, originalHash);
  assert.equal(history.revisions[0]!.quote.premiumMinor, '50000000');
  assert.deepEqual(
    history.events.map((entry) => entry.type),
    [
      'quote_created',
      'quote_revised',
      'quote_revised',
      'bound',
      'endorsement',
      'cancellation',
      'reinstatement',
    ],
  );
  checks.push(
    'Manual endorsement, cancellation and reinstatement persisted effective dates and signed deltas; original source quote and all prior version hashes remained immutable',
  );

  let lostResponse = true;
  await page.route('**/api/insurance/service', async (route) => {
    if (lostResponse) {
      lostResponse = false;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort('failed');
    } else await route.continue();
  });
  await service('endorsement', '0.01', 'Synthetic lost response retry exercise');
  await expect(page.locator('#notification')).toContainText('result is uncertain');
  assert.equal(store.insuranceRead(scope, recordId).version, 8);
  await page.getByRole('button', { name: 'Record policy change', exact: true }).click();
  await expectRevision(8, 'Bound');
  assert.equal(store.insuranceRead(scope, recordId).premiumMinor, '125007');
  await page.unroute('**/api/insurance/service');
  expectedFinalHash = store.insuranceRead(scope, recordId).recordHash;
  checks.push(
    'A real successful write with deliberately lost response retried the exact idempotent command, with one additional version only',
  );

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'test-results/insurance-workspace.png',
    fullPage: true,
    animations: 'disabled',
  });
  await checkMobile('insurance-workspace-mobile');
  await page.locator('.insurance-history-item').first().locator('summary').click();
  await expect(page.getByLabel('Canonical record version 1', { exact: true })).toContainText(
    originalHash,
  );
  await expect(page.getByLabel('Canonical record version 1', { exact: true })).toContainText(
    'external-v1',
  );
  checks.push(
    'Desktop/mobile record and history presentation verified, with expandable canonical original evidence',
  );

  await page.route('**/api/insurance/catalog', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'TEST_UNAVAILABLE', message: 'Synthetic catalog unavailable' } },
    }),
  );
  await page.locator('#refresh-button').click();
  await expect(page.getByText('Insurance data unavailable', { exact: true })).toBeVisible();
  await expect(page.locator('.insurance-record-detail')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No runtime product registered' })).toHaveCount(0);
  await page.unroute('**/api/insurance/catalog');
  await page.locator('#refresh-button').click();
  await page.locator(`[data-insurance-record="${recordId}"]`).click();
  await expectRevision(8, 'Bound');
  checks.push(
    'Failed read cleared stale insurance data without falsely claiming no product or record, and refresh recovered persisted state',
  );

  await page.getByRole('button', { name: 'New quote' }).click();
  await page.getByLabel('Registered product version').selectOption('synthetic-three-decimal@1.0.0');
  await page
    .getByLabel('Risk description', { exact: true })
    .fill('Fictional exact currency display exercise');
  await page.getByLabel('External quote reference', { exact: true }).fill('synthetic-quote-exact');
  await page.getByLabel('External quote version', { exact: true }).fill('external-v1');
  await page.getByLabel('Term start', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Term end', { exact: true }).fill('2027-08-31');
  await page.getByLabel('Quote expires at (UTC)', { exact: true }).fill('2026-09-30T12:00');
  await page.getByLabel('Quoted premium (KWD)', { exact: true }).fill('9007199254740.993');
  await page
    .getByLabel('Source evidence references', { exact: true })
    .fill('fixture://synthetic-exact/v1');
  await page.getByLabel('Participant 1 identifier', { exact: true }).fill('synthetic-lead');
  await page.getByLabel('Participant 1 share (%)', { exact: true }).fill('100.00');
  await page.getByRole('button', { name: 'Create quote', exact: true }).click();
  await expectRevision(1, 'Quoted');
  await expect(page.locator('.insurance-money-summary')).toContainText('KWD 9,007,199,254,740.993');
  assert.equal(store.insuranceList(scope).records[0]!.premiumMinor, '9007199254740993');
  checks.push(
    'Alternate registered currency and premium above JavaScript safe integer displayed exactly using three minor-unit decimals',
  );

  await page.locator('#logout-button').click();
  await login(1);
  await expect(page.getByRole('button', { name: 'New quote' })).toBeDisabled();
  await page.locator(`[data-insurance-record="${recordId}"]`).click();
  await expectRevision(8, 'Bound');
  for (const name of ['Revise quote', 'Bind selected quote', 'Manual policy change'])
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  const denied = await app.inject({
    method: 'POST',
    url: '/api/insurance/service',
    headers: { authorization: `Bearer ${credentials[1]!.token}` },
    payload: {
      idempotencyKey: randomUUID(),
      recordId,
      expectedVersion: 8,
      recordHash: expectedFinalHash,
      action: 'endorsement',
      premiumDeltaMinor: '1',
      effectiveDate: '2026-09-06',
      reason: 'Denied synthetic write',
    },
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(store.insuranceRead(scope, recordId).version, 8);
  await page.locator('#logout-button').click();
  await login(2);
  await expect(page.getByRole('heading', { name: 'No runtime product registered' })).toBeVisible();
  await expect(page.locator('[data-insurance-record]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New quote' })).toHaveCount(0);
  const isolated = await app.inject({
    method: 'GET',
    url: `/api/insurance/record?recordId=${recordId}`,
    headers: { authorization: `Bearer ${credentials[2]!.token}` },
  });
  assert.equal(isolated.statusCode, 404);
  await page.locator('#logout-button').click();
  await login(3);
  await expect(
    page.getByRole('heading', { name: 'Insurance access is not granted' }),
  ).toBeVisible();
  await expect(page.locator('[data-insurance-record]')).toHaveCount(0);
  checks.push(
    'Read-only credentials cannot write in UI or actual HTTP; unregistered scope shows no runtime product and cannot read another scope record; configuration-only session has no insurance access',
  );

  const reopened = new Store(database);
  try {
    const persisted = reopened.insuranceHistory(scope, recordId);
    assert.equal(persisted.revisions.length, 8);
    assert.equal(persisted.revisions[0]!.recordHash, originalHash);
    assert.equal(persisted.revisions.at(-1)!.recordHash, expectedFinalHash);
    assert.equal(persisted.events.length, 8);
  } finally {
    reopened.close();
  }
  checks.push(
    'A separate SQLite connection reopened the database and verified the full immutable eight-version event/history chain',
  );
  assert.deepEqual(browserErrors, []);
  await writeFile(
    'test-results/insurance-browser-evidence.json',
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        scope: 'isolated synthetic local database',
        productionReady: false,
        customerAcceptance: 'not_recorded',
        checks,
        browserErrors,
        screenshots: [
          'insurance-quote-mobile.png',
          'insurance-workspace.png',
          'insurance-workspace-mobile.png',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      checks: checks.length,
      browserErrors,
      screenshots: 3,
      recordRevisions: 8,
      productionReady: false,
    }),
  );
} finally {
  await browser.close();
  await app.close();
  store.close();
  await rm(directory, { recursive: true, force: true });
}

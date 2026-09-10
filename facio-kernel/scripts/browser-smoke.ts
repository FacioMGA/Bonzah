import { chromium, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/storage/store.js';
import { Kernel } from '../src/application/kernel.js';
import { buildApp } from '../src/server/app.js';
import type { Credential } from '../src/server/auth.js';
import { syntheticScopedRequirements } from '../tests/fixtures/requirements.js';
import {
  referenceScope,
  incompleteScope,
  referenceConfiguration,
  incompleteConfiguration,
} from '../src/fixtures/reference.js';

const dir = await mkdtemp(join(tmpdir(), 'facio-browser-'));
const store = new Store(join(dir, 'browser.sqlite'));
store.seed(referenceScope, referenceConfiguration, referenceConfiguration);
store.seed(incompleteScope, incompleteConfiguration);
const credentials: Credential[] = [referenceScope, incompleteScope].map((scope) => ({
  token: randomBytes(32).toString('hex'),
  context: {
    ...scope,
    actorId: 'browser-editor',
    permissions: ['configuration:read', 'configuration:write', 'audit:read'],
  },
}));
credentials.push({
  token: randomBytes(32).toString('hex'),
  context: { ...referenceScope, actorId: 'browser-reader', permissions: ['configuration:read'] },
});
const app = buildApp({
  kernel: new Kernel(store, [syntheticScopedRequirements]),
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
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
await mkdir('test-results', { recursive: true });
const checks: string[] = [];
async function login(index: number) {
  await page.locator('#access-token').fill(credentials[index]!.token);
  await page.locator('#login-submit').click();
  await expect(page.locator('#app-shell')).toBeVisible();
  await expect(page.locator('#loading-state')).toBeHidden();
}
try {
  await page.goto(address);
  await page.locator('#access-token').fill('invalid-credential');
  await page.locator('#login-submit').click();
  await expect(page.locator('#login-error')).toBeVisible();
  checks.push('Invalid credential denied');
  await login(0);
  await expect(page.locator('#scope-summary')).toContainText('reference');
  await expect(page.getByText('Metadata valid', { exact: true })).toBeVisible();
  await expect(page.locator('#primary-nav [data-page]')).toHaveCount(16);
  await page.screenshot({
    path: 'test-results/reference-overview.png',
    fullPage: true,
    animations: 'disabled',
  });
  checks.push('Reference scope, all 13 categories, metadata validity and wider gaps rendered');
  await page.getByRole('button', { name: 'Journey requirements', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic journey scope' })).toBeVisible();
  await expect(page.locator('#workspace-content')).toContainText(
    'Insurance runtime evidence is pending',
  );
  await expect(page.locator('#workspace-content')).toContainText(
    'Customer acceptance is not recorded',
  );
  await expect(page.locator('#workspace-content')).toContainText(
    syntheticScopedRequirements.sourceProfileHash,
  );
  await expect(page.locator('#view-draft')).toBeHidden();
  await page.getByText('Source boundaries and open inputs', { exact: true }).click();
  await expect(page.locator('#workspace-content')).toContainText('customer-approved golden quote');
  await page.getByText('Synthetic acceptance outline', { exact: true }).click();
  await expect(page.locator('#workspace-content')).toContainText('fixture://synthetic-outline');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'test-results/journey-requirements.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const requirementsWidths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  if (requirementsWidths.scroll > requirementsWidths.client + 1)
    throw new Error('Source requirements overflow on mobile');
  await page.screenshot({
    path: 'test-results/journey-requirements-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.route('**/api/requirements', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'TEST_UNAVAILABLE', message: 'Source service unavailable' } },
    }),
  );
  await page.locator('#refresh-button').click();
  await expect(page.getByText('Source requirements unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic journey scope' })).toHaveCount(0);
  await expect(page.getByText('No source profile attached', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/requirements');
  await page.locator('#refresh-button').click();
  await expect(page.getByRole('heading', { name: 'Synthetic journey scope' })).toBeVisible();
  await page.locator('#workspace-content [data-page="products"]').click();
  await expect(page.locator('#page-title')).toHaveText('Product definitions');
  await expect(page.locator('#view-draft')).toBeVisible();
  await page.locator('#primary-nav [data-page="overview"]').click();
  checks.push(
    'Source requirements, provenance, explicit pending evidence, category links and mobile layout verified; failed refresh clears stale profile and recovers',
  );
  let staleResponses = 0;
  await page.route('**/api/gaps?view=draft', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (staleResponses++ === 0) body.version += 1;
    await route.fulfill({ response, json: body });
  });
  await page.locator('#refresh-button').click();
  await expect(page.locator('#loading-state')).toBeHidden();
  if (staleResponses < 2) throw new Error('UI accepted mismatched snapshot/report versions');
  await page.unroute('**/api/gaps?view=draft');
  checks.push('Mismatched snapshot/report revisions trigger a bounded consistency retry');
  await page.locator('#primary-nav [data-page="tenant"]').click();
  await page.getByLabel('Tenant display name').fill('Browser verified draft');
  await page.getByRole('button', { name: /Save draft/ }).click();
  await expect(page.locator('#notification')).toContainText('Updated');
  if (
    store.read(referenceScope, 'draft').configuration.tenant?.displayName !==
    'Browser verified draft'
  )
    throw new Error('UI did not persist draft');
  await page.locator('#view-published').click();
  await expect(page.getByLabel('Tenant display name')).toHaveValue('Reference workspace');
  await expect(page.getByRole('button', { name: /Save draft/ })).toBeDisabled();
  checks.push('UI draft edit persisted; published snapshot remained immutable');
  await page.locator('#view-draft').click();
  await expect(page.getByLabel('Tenant display name')).toHaveValue('Browser verified draft');
  await page.route('**/api/gaps?view=draft', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'TEST_UNAVAILABLE', message: 'Report temporarily unavailable' } },
    }),
  );
  await page.getByLabel('Tenant display name').fill('Saved while report unavailable');
  await page.getByRole('button', { name: /Save draft/ }).click();
  await expect(page.getByText('Validation report unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('Metadata valid', { exact: true })).toHaveCount(0);
  if (
    store.read(referenceScope, 'draft').configuration.tenant?.displayName !==
    'Saved while report unavailable'
  )
    throw new Error('Save lost when gap refresh failed');
  await page.unroute('**/api/gaps?view=draft');
  await page.locator('#refresh-button').click();
  await expect(page.getByLabel('Tenant display name')).toHaveValue(
    'Saved while report unavailable',
  );
  checks.push(
    'Successful save with failed gap refresh shows unavailable validity and recovers without lost data',
  );
  await page.locator('[data-resource="openapi"]').click();
  await expect(page.locator('#detail-dialog')).toBeVisible();
  await expect(page.locator('#dialog-body')).toContainText('3.1.0');
  await page.locator('#dialog-close').click();
  await page.locator('[data-resource="mcp"]').click();
  await expect(page.locator('#dialog-body')).toContainText('configuration_inspect');
  await page.locator('#dialog-close').click();
  checks.push('Authenticated OpenAPI and MCP discovery dialogs rendered');
  await page.locator('#logout-button').click();
  await login(1);
  await expect(page.getByText('Metadata needs attention', { exact: true })).toBeVisible();
  await expect(page.locator('#scope-summary')).toContainText('incomplete');
  if (
    await page
      .locator('body')
      .innerText()
      .then((t) => t.includes('Browser verified draft'))
  )
    throw new Error('Prior tenant state leaked');
  await page.getByRole('button', { name: 'Journey requirements', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No source profile attached' })).toBeVisible();
  await expect(page.locator('#workspace-content')).not.toContainText('Synthetic journey scope');
  await page.locator('#primary-nav [data-page="overview"]').click();
  checks.push(
    'Missing scoped source profile is explicit after logout/login and reveals no previous tenant requirements',
  );
  await page.screenshot({
    path: 'test-results/incomplete-overview.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.locator('#view-published').click();
  await expect(page.locator('#notification')).toBeVisible();
  checks.push(
    'Incomplete tenant and missing published version show explicit gaps/errors without prior-tenant leakage',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#view-draft').click();
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  if (widths.scroll > widths.client + 1)
    throw new Error(`Mobile page overflows ${JSON.stringify(widths)}`);
  await page.screenshot({
    path: 'test-results/mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  checks.push('390px mobile viewport has no document overflow');
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.locator('#logout-button').click();
  await login(2);
  await page.locator('#primary-nav [data-page="tenant"]').click();
  await expect(page.getByRole('button', { name: /Save draft/ })).toBeDisabled();
  await expect(page.locator('#audit-button')).toBeHidden();
  checks.push('Read-only role cannot edit or inspect audit');
  await page.reload();
  await expect(page.locator('#login-screen')).toBeVisible();
  const storage = await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
  }));
  if (storage.local || storage.session)
    throw new Error('Credential/session persisted in browser storage');
  checks.push('Reload clears authentication; no browser storage used');
  if (errors.length) throw new Error('Browser errors: ' + errors.join('; '));
  await writeFile(
    'test-results/browser-evidence.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        mode: 'isolated synthetic local fixtures',
        checks,
        errors,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Browser verification passed: ${checks.length} checks, desktop/mobile, three scoped roles.`,
  );
} finally {
  await browser.close();
  await app.close();
  store.close();
  await rm(dir, { recursive: true, force: true });
}

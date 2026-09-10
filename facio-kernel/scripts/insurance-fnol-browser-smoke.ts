import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnolFixture, fnolCas } from '../tests/fixtures/fnol.js';
import { incompleteConfiguration } from '../src/fixtures/reference.js';
import { buildApp } from '../src/server/app.js';
import type { Credential } from '../src/server/auth.js';
import type { Context } from '../src/contracts/configuration.js';
const directory = await mkdtemp(join(tmpdir(), 'facio-fnol-browser-')),
  f = fnolFixture(join(directory, 'kernel.sqlite'));
f.store.seed(f.context, incompleteConfiguration);
const reader: Context = {
    ...f.context,
    actorId: 'synthetic-intake-reader',
    permissions: ['configuration:read', 'insurance:read', 'fnol:read'],
  },
  outsider: Context = { ...reader, tenantId: 'other-intake-tenant' };
f.store.seed(outsider, incompleteConfiguration);
const credentials: Credential[] = [f.context, reader, outsider].map(
  ({ correlationId: _, ...context }) => ({ token: randomBytes(32).toString('hex'), context }),
);
const app = buildApp({ kernel: f.kernel, credentials, maxRequestsPerMinute: 2000 });
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }),
  errors: string[] = [],
  checks: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
await mkdir('test-results', { recursive: true });
async function login(index: number) {
  await page.locator('#access-token').fill(credentials[index]!.token);
  await page.locator('#login-submit').click();
  await expect(page.locator('#app-shell')).toBeVisible();
  await expect(page.locator('#loading-state')).toBeHidden();
  await page.getByRole('button', { name: 'Insurance workspace', exact: true }).click();
  await page.locator(`[data-insurance-record="${f.bound.id}"]`).click();
  await expect(page.locator('.fnol-panel')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Refresh loss notices', exact: true }),
  ).toBeEnabled();
}
try {
  await page.goto(address);
  await login(0);
  await page.getByRole('button', { name: 'New loss notice', exact: true }).click();
  await page
    .getByLabel('Source notice reference', { exact: true })
    .fill('synthetic-browser-notice');
  let uncertain = true;
  await page.route(address + '/api/insurance/fnol', async (route) => {
    if (uncertain && route.request().method() === 'POST') {
      uncertain = false;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Save notice draft', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry unchanged request', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Source notice reference', { exact: true })).toBeDisabled();
  assert.equal(f.store.fnol.list(f.context, f.bound.id).notices.length, 1);
  await page.getByRole('button', { name: 'Retry unchanged request', exact: true }).click();
  await expect(page.locator('.fnol-notice')).toHaveCount(1);
  assert.equal(f.store.fnol.list(f.context, f.bound.id).notices.length, 1);
  const draft = f.store.fnol.list(f.context, f.bound.id).notices[0]!;
  assert.equal(draft.version, 1);
  assert.equal(draft.details.loss.description, '');
  checks.push(
    'Actual incomplete draft survives an accepted-but-lost HTTP response and unchanged retry creates no duplicate effect',
  );
  await page.getByRole('button', { name: 'Resume draft', exact: true }).click();
  await page
    .getByLabel('Declared insured name', { exact: true })
    .fill('Synthetic Training Organization');
  await page.getByLabel('Reporter name', { exact: true }).fill('Example Reporter');
  await page.getByLabel('Reporter email', { exact: true }).fill('reporter@example.test');
  await page.getByLabel('Preparer name', { exact: true }).fill('Example Preparer');
  await page.getByLabel('Preparer role', { exact: true }).selectOption('broker');
  await page
    .getByLabel('Loss timestamp with UTC offset', { exact: true })
    .fill('2026-08-31T23:30:00-05:00');
  await page
    .getByLabel('Source timezone interpretation', { exact: true })
    .fill('UTC-05:00 retained from synthetic report');
  await page
    .getByLabel('Loss location or location reference', { exact: true })
    .fill('Synthetic training location');
  await page
    .getByLabel('Reported loss narrative', { exact: true })
    .fill('Synthetic property damage notice. No real claimant or incident.');
  await page.getByLabel('Injury status reported', { exact: true }).selectOption('none_reported');
  await page.getByRole('button', { name: 'Add evidence reference', exact: true }).click();
  await page.getByLabel('Evidence 1 type', { exact: true }).selectOption('photo');
  await page
    .getByLabel('Evidence 1 reference', { exact: true })
    .fill('fixture://fnol/browser-scene');
  await page
    .getByLabel('Evidence 1 description', { exact: true })
    .fill('Synthetic evidence pointer; no file upload');
  await page.getByLabel(/I confirm these are the reported training facts/).check();
  await page.locator('#insurance-fnol-form').evaluate((element) =>
    window.scrollTo({
      top: element.getBoundingClientRect().top + window.scrollY - 80,
      behavior: 'instant',
    }),
  );
  await page.screenshot({
    path: 'test-results/insurance-fnol-form-desktop.png',
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Save notice draft', exact: true }).click();
  await expect(page.locator('.fnol-inspection')).toContainText('Outside recorded term');
  await expect(page.locator('.fnol-inspection')).toContainText('not a coverage denial');
  const updated = f.store.fnol.read(f.context, draft.id);
  assert.equal(updated.version, 2);
  assert.equal(updated.policySnapshot.version, 2);
  assert.equal(updated.actorId, f.context.actorId);
  assert.equal(updated.details.preparer.role, 'broker');
  checks.push(
    'Structured save/resume retains reporter/preparer/evidence/server actor and flags out-of-term source date without adjudication',
  );
  await page.getByRole('button', { name: 'Review submission', exact: true }).click();
  await page.getByRole('button', { name: 'Submit retained notice', exact: true }).click();
  await expect(page.locator('.fnol-notice')).toContainText('Submitted for internal handoff');
  await page.getByRole('button', { name: 'Acknowledge in training queue', exact: true }).click();
  await expect(page.locator('.fnol-inspection')).toContainText(
    'External delivery was not attempted',
  );
  const acknowledged = f.store.fnol.read(f.context, draft.id);
  assert.equal(acknowledged.status, 'acknowledged');
  assert.equal(acknowledged.acknowledgement!.externalDelivery, 'not_attempted');
  assert.equal(acknowledged.version, 4);
  await expect(page.getByRole('button', { name: 'Resume draft', exact: true })).toBeDisabled();
  checks.push(
    'Reviewed submission and explicit internal handoff retain one immutable acknowledgement; frozen facts cannot be edited',
  );
  const duplicate = f.create('second-synthetic-report', structuredClone(updated.details));
  await page.getByRole('button', { name: 'Refresh loss notices', exact: true }).click();
  const card = page
    .locator('.fnol-notice')
    .filter({ has: page.getByRole('heading', { name: 'second-synthetic-report', exact: true }) });
  await expect(card).toContainText('possible related notice');
  await card.getByRole('button', { name: 'Review submission', exact: true }).click();
  await page.getByRole('button', { name: 'Submit retained notice', exact: true }).click();
  await expect(page.locator('#notification')).toContainText('possible duplicate');
  assert.equal(f.store.fnol.read(f.context, duplicate.notice.id).status, 'draft');
  await page.getByLabel('Duplicate disposition', { exact: true }).selectOption('related_notice');
  await page
    .getByLabel('Duplicate review rationale', { exact: true })
    .fill('Second synthetic preparer reports the same source incident; preserve both accounts.');
  await page.getByRole('button', { name: 'Submit retained notice', exact: true }).click();
  await expect(card).toContainText('Recorded disposition: Related notice');
  assert.equal(
    f.store.fnol.read(f.context, duplicate.notice.id).duplicateReview!.disposition,
    'related_notice',
  );
  assert.equal(f.store.fnol.read(f.context, draft.id).noticeHash, acknowledged.noticeHash);
  checks.push(
    'Possible duplicate blocks unreviewed submission; actual rationale form preserves both notice histories',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.fnol-panel').evaluate((element) =>
    window.scrollTo({
      top: element.getBoundingClientRect().top + window.scrollY - 80,
      behavior: 'instant',
    }),
  );
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
    'Mobile intake must not overflow',
  );
  await page.screenshot({ path: 'test-results/insurance-fnol-mobile.png', animations: 'disabled' });
  await card.getByRole('button', { name: 'Inspect loss notice', exact: true }).click();
  await expect(page.locator('.fnol-inspection')).toContainText('Example Preparer');
  checks.push('390px interface supports actual notice inspection without horizontal overflow');
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.locator('#logout-button').click();
  await login(1);
  await expect(page.getByRole('button', { name: 'New loss notice', exact: true })).toBeDisabled();
  const denied = await page.request.post(address + '/api/insurance/fnol/handoff', {
    headers: { Authorization: `Bearer ${credentials[1]!.token}` },
    data: fnolCas(f.store.fnol.read(f.context, duplicate.notice.id)),
  });
  assert.equal(denied.status(), 403);
  const hidden = await page.request.get(
    address + `/api/insurance/fnol/notice?noticeId=${draft.id}`,
    { headers: { Authorization: `Bearer ${credentials[2]!.token}` } },
  );
  assert.equal(hidden.status(), 404);
  assert.deepEqual(f.store.insuranceRead(f.context, f.bound.id), f.bound);
  assert.deepEqual(errors, []);
  checks.push(
    'Read-only and other-tenant requests cannot mutate or retrieve unauthorized intake; policy money/state remain unchanged',
  );
  await writeFile(
    'test-results/insurance-fnol-browser-report.json',
    JSON.stringify(
      {
        scope:
          'Local disposable synthetic UI/HTTP/storage evidence; no customer routing, public token or legal signature acceptance',
        checks,
        pageErrors: errors,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    JSON.stringify({
      checks: checks.length,
      pageErrors: errors.length,
      report: 'test-results/insurance-fnol-browser-report.json',
    }) + '\n',
  );
} catch (error) {
  await page.screenshot({ path: 'test-results/insurance-fnol-failure.png', fullPage: true });
  process.stderr.write(JSON.stringify({ pageErrors: errors, completedChecks: checks }) + '\n');
  throw error;
} finally {
  await browser.close();
  await app.close();
  f.store.close();
  await rm(directory, { recursive: true, force: true });
}

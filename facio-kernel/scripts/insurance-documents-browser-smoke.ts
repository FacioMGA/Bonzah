import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel } from '../src/application/kernel.js';
import { Store } from '../src/storage/store.js';
import { documentBytesHash } from '../src/storage/documents.js';
import { syntheticDocumentPack } from '../src/domain/document-training.js';
import { documentViewSchema } from '../src/contracts/documents.js';
import { insuranceMutationResultSchema } from '../src/contracts/insurance.js';
import { incompleteConfiguration } from '../src/fixtures/reference.js';
import { buildApp } from '../src/server/app.js';
import type { Credential } from '../src/server/auth.js';
import type { Context } from '../src/contracts/configuration.js';
import {
  insuranceContext,
  scopedRuntimePolicy,
  externalQuote,
  testNow,
} from '../tests/fixtures/insurance.js';

// Disposable synthetic inputs only. Real HTTP, application, worker, SQLite and browser downloads.
const directory = await mkdtemp(join(tmpdir(), 'facio-documents-browser-'));
const store = new Store(join(directory, 'kernel.sqlite'));
const context: Context = {
  ...insuranceContext,
  permissions: [
    'configuration:read',
    ...insuranceContext.permissions,
    'documents:read',
    'documents:issue',
  ],
};
const reader: Context = {
  ...context,
  actorId: 'document-reader',
  permissions: ['configuration:read', 'insurance:read', 'documents:read'],
};
const outsider: Context = { ...reader, tenantId: 'other-document-tenant' };
store.seed(context, incompleteConfiguration);
store.seed(outsider, incompleteConfiguration);
const kernel = new Kernel(
  store,
  [],
  [scopedRuntimePolicy],
  testNow,
  undefined,
  [],
  [syntheticDocumentPack],
);
const credentials: Credential[] = [context, reader, outsider].map(
  ({ correlationId: _, ...entry }) => ({ token: randomBytes(32).toString('hex'), context: entry }),
);
function quote(summary: string) {
  return insuranceMutationResultSchema.parse(
    kernel.execute(
      'insurance_create_quote',
      {
        productId: scopedRuntimePolicy.policy.id,
        productVersion: scopedRuntimePolicy.policy.version,
        quote: {
          ...structuredClone(externalQuote),
          sourceQuote: { ...externalQuote.sourceQuote, reference: randomUUID() },
          risk: { summary, externalRiskReference: null },
        },
        idempotencyKey: randomUUID(),
      },
      context,
    ),
  ).record;
}
const quoted = quote('Synthetic document quote, not yet bound');
const boundQuote = quote('Synthetic document retention exercise');
const bound = insuranceMutationResultSchema.parse(
  kernel.execute(
    'insurance_bind',
    {
      recordId: boundQuote.id,
      expectedVersion: boundQuote.version,
      quoteHash: boundQuote.quoteHash,
      idempotencyKey: randomUUID(),
    },
    context,
  ),
).record;
const app = buildApp({ kernel, credentials, documentWorker: true, maxRequestsPerMinute: 2000 });
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1050 },
  acceptDownloads: true,
});
const errors: string[] = [];
const checks: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
await mkdir('test-results/documents', { recursive: true });
async function login(index: number) {
  await page.locator('#access-token').fill(credentials[index]!.token);
  await page.locator('#login-submit').click();
  await expect(page.locator('#app-shell')).toBeVisible();
  await expect(page.locator('#loading-state')).toBeHidden();
  await page.getByRole('button', { name: 'Insurance workspace', exact: true }).click();
}
async function select(id: string) {
  await page.locator(`[data-insurance-record="${id}"]`).click();
  await expect(page.locator('.documents-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh documents', exact: true })).toBeEnabled();
}
async function complete(expectedCount: number) {
  await expect
    .poll(() => store.documents.list(context, bound.id).requests.length)
    .toBe(expectedCount);
  const job = store.documents.list(context, bound.id).requests[0]!;
  await expect
    .poll(() => store.documents.state(context, job.id).status, { timeout: 15000 })
    .toBe('completed');
  await page.getByRole('button', { name: 'Refresh documents', exact: true }).click();
  await expect(page.locator('.documents-job')).toHaveCount(expectedCount);
  await expect(
    page.locator('.documents-job .tag').filter({ hasText: 'Documents available' }),
  ).toHaveCount(expectedCount);
  return documentViewSchema.parse(kernel.execute('documents_get', { jobId: job.id }, context));
}
try {
  await page.goto(address);
  await login(0);
  await select(quoted.id);
  await expect(
    page.getByRole('button', { name: 'Generate training pack', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('.documents-panel')).toContainText('Documents cannot issue a quote');
  assert.equal(store.documents.list(context, quoted.id).requests.length, 0);
  checks.push('Unbound quote cannot generate a document or gain an insurance state');
  await select(bound.id);
  await page.getByRole('button', { name: 'Generate training pack', exact: true }).click();
  const first = await complete(1);
  await expect(
    page.getByRole('button', { name: 'Generate training pack', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Inspect document history', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Immutable document history' })).toContainText(
    'Generation queued',
  );
  await expect(page.getByRole('region', { name: 'Immutable document history' })).toContainText(
    'Documents available',
  );
  checks.push(
    'Actual form queues one exact bound revision; background worker atomically retains PDF and HTML pack and immutable history',
  );
  for (const format of ['pdf', 'html'] as const) {
    const artifact = first.artifacts.find((item) => item.format === format)!;
    const downloadPromise = page.waitForEvent('download');
    await page.locator(`[data-artifact-id="${artifact.id}"]`).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), artifact.filename);
    const path = join(directory, artifact.filename);
    await download.saveAs(path);
    const bytes = await readFile(path);
    assert.equal(documentBytesHash(bytes), artifact.contentHash);
    if (format === 'html') {
      assert.match(bytes.toString(), /GBP 100\.01/);
      assert(bytes.toString().includes(artifact.documentNumber));
    }
  }
  checks.push(
    'Authenticated PDF and HTML browser downloads reproduce exact registered filenames and stored byte hashes',
  );
  await page
    .locator('.documents-panel')
    .screenshot({ path: 'test-results/insurance-documents-desktop.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Manual policy change', exact: true }).click();
  await page.getByLabel('Action', { exact: true }).selectOption('endorsement');
  await page.getByLabel('Effective date', { exact: true }).fill('2026-09-10');
  await page.getByLabel('Premium change (GBP)', { exact: true }).fill('25.99');
  await page
    .getByLabel('Reason and external decision reference')
    .fill('Synthetic additional premium; retain original documents');
  await page.getByRole('button', { name: 'Record policy change', exact: true }).click();
  await expect(page.locator('.insurance-record-detail .panel-heading')).toContainText(
    'current revision 3',
  );
  await expect(
    page.getByRole('button', { name: 'Generate training pack', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Generate training pack', exact: true }).click();
  await complete(2);
  assert.deepEqual(store.documents.artifacts(context, first.request.id), first.artifacts);
  assert.equal(
    store.documents.request(context, first.request.id).snapshot.record.premiumMinor,
    '10001',
  );
  await expect(page.locator('.documents-panel')).toContainText('Retained earlier revision');
  checks.push(
    'Actual service form creates revision 3 and a new document pack; original revision 2 PDF/HTML hashes remain immutable',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.documents-panel').scrollIntoViewIfNeeded();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
    'Mobile content must not overflow',
  );
  await page.locator('.documents-panel').evaluate((element) =>
    window.scrollTo({
      top: element.getBoundingClientRect().top + window.scrollY - 80,
      behavior: 'instant',
    }),
  );
  await page.screenshot({
    path: 'test-results/insurance-documents-mobile.png',
    animations: 'disabled',
  });
  await page
    .locator('.documents-downloads')
    .first()
    .evaluate((element) =>
      window.scrollTo({
        top: element.getBoundingClientRect().top + window.scrollY - 80,
        behavior: 'instant',
      }),
    );
  await page.screenshot({
    path: 'test-results/insurance-documents-mobile-downloads.png',
    animations: 'disabled',
  });
  checks.push(
    '390px document controls, history and download cards remain usable without horizontal overflow',
  );
  const mobileDownload = page.waitForEvent('download');
  await page.locator('[data-insurance-documents-action="download"]').first().click();
  assert((await mobileDownload).suggestedFilename().endsWith('.html'));
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.locator('#logout-button').click();
  await login(1);
  await select(bound.id);
  await expect(
    page.getByRole('button', { name: 'Generate training pack', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('[data-insurance-documents-action="download"]').first()).toBeEnabled();
  const denied = await page.request.post(address + '/api/insurance/documents', {
    headers: { Authorization: `Bearer ${credentials[1]!.token}` },
    data: {
      recordId: bound.id,
      recordVersion: bound.version,
      recordHash: bound.recordHash,
      packId: syntheticDocumentPack.id,
      packVersion: syntheticDocumentPack.version,
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(denied.status(), 403);
  const outside = await page.request.get(
    address + `/api/insurance/documents/content?artifactId=${first.artifacts[0]!.id}`,
    { headers: { Authorization: `Bearer ${credentials[2]!.token}` } },
  );
  assert.equal(outside.status(), 404);
  assert.equal((await outside.json()).error.code, 'NOT_FOUND');
  checks.push(
    'Read-only session can inspect/download but cannot issue; another authorized tenant cannot retrieve known artifact IDs',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    'test-results/insurance-documents-browser-report.json',
    JSON.stringify(
      {
        scope:
          'Isolated local synthetic browser evidence; no customer approval or hosted user acceptance',
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
      report: 'test-results/insurance-documents-browser-report.json',
    }) + '\n',
  );
} catch (error) {
  await page.screenshot({ path: 'test-results/insurance-documents-failure.png', fullPage: true });
  process.stderr.write(JSON.stringify({ pageErrors: errors, completedChecks: checks }) + '\n');
  throw error;
} finally {
  await browser.close();
  await app.close();
  store.close();
  await rm(directory, { recursive: true, force: true });
}

import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel } from '../src/application/kernel.js';
import { financeLedgerSchema } from '../src/contracts/finance.js';
import { HostedAuth, SESSION_COOKIE } from '../src/server/hosted-auth.js';
import { buildApp } from '../src/server/app.js';
import { AuthStore } from '../src/storage/auth-store.js';
import { approvalFixture, approvalBuilder, approvalReviewer } from '../tests/fixtures/approval.js';

const dir = await mkdtemp(join(tmpdir(), 'kernel-finance-browser-'));
const fixture = approvalFixture(join(dir, 'kernel.sqlite'));
const submission = {
  ...fixture.submission,
  reference: 'finance-browser-training',
  term: { startDate: '2026-09-10', endDate: '2026-09-30' },
  summary: 'Fictional commission reconciliation case',
  answers: { ...fixture.submission.answers, age: 35 },
};
const record = fixture.bind(fixture.create(submission));
const kernel = new Kernel(fixture.store, [], [], () => new Date('2026-09-10T12:00:00.000Z'), {
  region: 'test',
  buildSha: 'b'.repeat(40),
});
const authStore = new AuthStore(join(dir, 'auth.sqlite'));
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    join(dir, 'tls.key'),
    '-out',
    join(dir, 'tls.crt'),
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
  ],
  { stdio: 'ignore' },
);
const tls = createServer({
  key: await readFile(join(dir, 'tls.key')),
  cert: await readFile(join(dir, 'tls.crt')),
});
await new Promise<void>((resolve) => tls.listen(0, '127.0.0.1', resolve));
const origin = `https://localhost:${(tls.address() as AddressInfo).port}`;
const auth = new HostedAuth(authStore, {
  publicUrl: origin,
  providers: [],
  authorizePrincipal: () => {},
});
const session = auth.createSession(approvalReviewer);
const app = buildApp({
  kernel,
  hosted: { auth, publicUrl: origin, buildSha: 'b'.repeat(40), region: 'test' },
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
    response.end('Test proxy unavailable');
  });
  request.pipe(upstream);
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 1050 },
});
await context.addCookies([
  {
    name: SESSION_COOKIE,
    value: session.token,
    url: origin,
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
  },
]);
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const checks: string[] = [];
await mkdir('test-results', { recursive: true });
const ledger = () =>
  financeLedgerSchema.parse(
    kernel.executeForPrincipal(
      'finance_ledger',
      { recordId: record.id },
      approvalReviewer,
      fixture.tenant.id,
    ),
  );
const fillEvidence = async (reason: string) => {
  await page.getByLabel('Reason for this action', { exact: true }).fill(reason);
  await page
    .getByLabel('Evidence references, one per line', { exact: true })
    .fill('fixture://browser-finance-training');
};
try {
  await page.goto(`${origin}/studio?tenant=${fixture.tenant.id}&view=insurance`);
  await page.getByRole('button', { name: new RegExp(submission.summary) }).click();
  await expect(
    page.getByRole('heading', { name: 'Transaction finance', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Recognize insurance transactions', exact: true }).click();
  await fillEvidence('Recognize synthetic policy');
  await page.getByRole('button', { name: 'Record financial evidence', exact: true }).click();
  await expect(page.getByText('Financial evidence retained.', { exact: false })).toBeVisible();
  assert.equal(ledger().journals.length, 1);
  assert.equal(ledger().totals.commissionAccruedMinor, record.financials.commission.amountMinor);
  checks.push(
    'Authorized HTTPS UI recognizes the retained bound transaction with independently balanced financial and external-control books.',
  );

  await page.getByRole('button', { name: 'Record training receipt', exact: true }).click();
  await page.getByLabel('Immutable source reference').fill('browser-receipt-001');
  await page.getByLabel('Receipt date and time (UTC)').fill('2026-09-10T11:00');
  await page.getByLabel('Amount (GBP)', { exact: true }).fill('12.00');
  await fillEvidence('Synthetic partial commission receipt');
  let uncertain = true;
  await page.route('**/api/insurance/finance/receipts', async (route) => {
    if (route.request().method() !== 'POST' || !uncertain) return route.continue();
    uncertain = false;
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await route.abort('connectionfailed');
  });
  await page.getByRole('button', { name: 'Record financial evidence', exact: true }).click();
  await expect(
    page.getByText('A request has an uncertain result.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel('Immutable source reference')).toHaveValue('browser-receipt-001');
  await page.getByRole('button', { name: 'Record financial evidence', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Apply to commission', exact: true }),
  ).toBeEnabled();
  assert.equal(ledger().receipts.length, 1);
  assert.equal(ledger().totals.recordedUnappliedReceiptMinor, '1200');
  checks.push(
    'A committed receipt with a deliberately lost response retains the form and command identity; an unchanged retry creates one receipt.',
  );

  await page.getByRole('button', { name: 'Apply to commission', exact: true }).click();
  await page.getByLabel('Amount (GBP)', { exact: true }).fill('5.00');
  await fillEvidence('Apply synthetic partial receipt');
  const before = ledger();
  kernel.executeForPrincipal(
    'finance_record_receipt',
    {
      idempotencyKey: randomUUID(),
      sourceReference: 'concurrent-unmatched-receipt',
      payerId: 'another-party',
      currency: 'GBP',
      amountMinor: '100',
      receivedAt: '2026-09-10T11:00:00.000Z',
      provenance: 'synthetic_training',
      reason: 'Concurrent synthetic input',
      evidenceRefs: ['fixture://concurrent-receipt'],
    },
    approvalReviewer,
    fixture.tenant.id,
  );
  await page.getByRole('button', { name: 'Record financial evidence', exact: true }).click();
  await expect(page.getByLabel('Reason for this action')).toHaveValue(
    'Apply synthetic partial receipt',
  );
  assert.equal(ledger().applications.length, 0);
  assert.notEqual(ledger().ledgerHash, before.ledgerHash);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Refresh finance', exact: true }).click();
  await page
    .getByRole('button', { name: 'Apply to commission', exact: true })
    .filter({ visible: true })
    .first()
    .waitFor();
  const receiptRow = page
    .getByRole('row')
    .filter({ hasText: 'browser-receipt-001' })
    .filter({ has: page.getByRole('button', { name: 'Apply to commission' }) });
  await receiptRow.getByRole('button', { name: 'Apply to commission' }).click();
  await page.getByLabel('Amount (GBP)', { exact: true }).fill('5.00');
  await fillEvidence('Apply after inspecting current ledger');
  await page.getByRole('button', { name: 'Record financial evidence', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Reverse application', exact: true }),
  ).toBeVisible();
  assert.equal(ledger().totals.commissionReceivedMinor, '500');
  assert.equal(ledger().totals.recordedUnappliedReceiptMinor, '800');
  checks.push(
    'A changed ledger rejects an application while preserving entered evidence; refresh and an exact new command apply only the selected partial amount.',
  );

  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download journal CSV', exact: true }).click();
  const downloaded = await downloadEvent;
  const downloadedPath = await downloaded.path();
  assert(downloadedPath);
  const csv = await readFile(downloadedPath);
  const exported = kernel.executeForPrincipal(
    'finance_export',
    { recordId: record.id },
    approvalReviewer,
    fixture.tenant.id,
  ) as { contentHash: string; content: string };
  assert.equal(createHash('sha256').update(csv).digest('hex'), exported.contentHash);
  assert.equal(csv.toString(), exported.content);
  checks.push(
    'The downloaded CSV bytes match the displayed ledger and exact source-lineage export hash.',
  );

  await page.getByLabel('Effective through', { exact: true }).fill('2026-09-10');
  await page.getByLabel('Recorded through (UTC)', { exact: true }).fill('2026-09-10T12:00');
  await page.getByRole('button', { name: 'Build dated report', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Download dated report CSV', exact: true }),
  ).toBeEnabled();
  const reportDownloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download dated report CSV', exact: true }).click();
  const reportDownload = await reportDownloadEvent;
  const reportPath = await reportDownload.path();
  assert(reportPath);
  const reportExport = kernel.executeForPrincipal(
    'finance_report_export',
    { recordId: record.id, effectiveAsOf: '2026-09-10', recordedAsOf: '2026-09-10T12:00:00.000Z' },
    approvalReviewer,
    fixture.tenant.id,
  ) as { contentHash: string };
  assert.equal(
    createHash('sha256')
      .update(await readFile(reportPath))
      .digest('hex'),
    reportExport.contentHash,
  );
  await page.getByLabel('Recorded through (UTC)', { exact: true }).fill('2026-09-10T11:00');
  await expect(
    page.getByRole('button', { name: 'Download dated report CSV', exact: true }),
  ).toBeDisabled();
  checks.push(
    'Dated report and downloaded CSV share explicit effective/recorded cutoffs and byte hash; changing either cutoff invalidates the download.',
  );
  await page.getByRole('button', { name: 'Reverse application', exact: true }).click();
  await fillEvidence('Correct synthetic receipt application');
  await page.getByRole('button', { name: 'Record financial evidence', exact: true }).click();
  await expect(page.getByText('Applied · subsequently reversed', { exact: true })).toBeVisible();
  assert.equal(ledger().applications.length, 2);
  assert.equal(ledger().totals.commissionReceivedMinor, '0');
  assert.equal(ledger().totals.recordedUnappliedReceiptMinor, '1300');
  assert.deepEqual(fixture.store.insuranceRead(fixture.context, record.id), record);
  checks.push(
    'Reversal retains the original application and restores receipt availability without changing any insurance state.',
  );
  await page.screenshot({ path: 'test-results/insurance-finance-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: 'test-results/insurance-finance-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);

  const builderSession = auth.createSession(approvalBuilder);
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: builderSession.token,
      url: origin,
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.reload();
  await page.getByRole('button', { name: new RegExp(submission.summary) }).click();
  await expect(
    page.getByRole('button', { name: 'Record training receipt', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Recognize insurance transactions', exact: true }),
  ).toBeDisabled();
  assert.throws(() =>
    kernel.executeForPrincipal(
      'finance_post',
      {
        recordId: record.id,
        expectedVersion: record.version,
        recordHash: record.recordHash,
        idempotencyKey: randomUUID(),
        reason: 'Builder denial',
        evidenceRefs: ['fixture://denial'],
        accountingBasis: 'synthetic_external_custody_commission_v1',
      },
      approvalBuilder,
      fixture.tenant.id,
    ),
  );
  checks.push(
    'Desktop/mobile views have no page errors or overflow; builder sessions can inspect but cannot post or reconcile finance.',
  );
  await writeFile(
    'test-results/insurance-finance-browser.json',
    JSON.stringify({ passed: true, checks, errors, liveBankVerified: false }, null, 2) + '\n',
  );
  console.log(JSON.stringify({ passed: true, checks: checks.length, errors }));
} catch (error) {
  await page
    .screenshot({ path: 'test-results/insurance-finance-failure.png', fullPage: true })
    .catch(() => {});
  await writeFile(
    'test-results/insurance-finance-browser.json',
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
  fixture.store.close();
  await rm(dir, { recursive: true, force: true });
}

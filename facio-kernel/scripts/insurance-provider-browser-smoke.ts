import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel } from '../src/application/kernel.js';
import { createSyntheticProviderAdapter } from '../src/application/provider.js';
import { providerExecutionViewSchema } from '../src/contracts/provider-execution.js';
import { HostedAuth, SESSION_COOKIE } from '../src/server/hosted-auth.js';
import { buildApp } from '../src/server/app.js';
import { AuthStore } from '../src/storage/auth-store.js';
import { approvalFixture, approvalBuilder, approvalReviewer } from '../tests/fixtures/approval.js';

const dir = await mkdtemp(join(tmpdir(), 'kernel-provider-browser-'));
const fixture = approvalFixture(join(dir, 'kernel.sqlite'));
const submission = {
  ...fixture.submission,
  reference: 'provider-browser-training',
  summary: 'Fictional provider evidence case',
  answers: { ...fixture.submission.answers, age: 35 },
};
const record = fixture.create(submission);
const kernel = new Kernel(
  fixture.store,
  [],
  [],
  () => new Date('2026-09-10T12:00:00.000Z'),
  { region: 'test', buildSha: 'b'.repeat(40) },
  [createSyntheticProviderAdapter()],
);
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
const session = auth.createSession(approvalBuilder);
const app = buildApp({
  kernel,
  hosted: { auth, publicUrl: origin, buildSha: 'b'.repeat(40), region: 'test' },
  providerWorker: true,
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
try {
  await page.goto(`${origin}/studio?tenant=${fixture.tenant.id}&view=insurance`);
  await page.getByRole('button', { name: new RegExp(submission.summary) }).click();
  await expect(page.getByRole('heading', { name: 'Provider activity', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Queue training evidence', exact: true }).click();
  await expect(page.getByText('Provider request queued.', { exact: false })).toBeVisible();
  const list = () =>
    kernel.executeForPrincipal(
      'provider_list',
      { recordId: record.id },
      approvalBuilder,
      fixture.tenant.id,
    ) as { requests: unknown[] };
  await expect
    .poll(() => providerExecutionViewSchema.parse(list().requests[0]).state.status)
    .toBe('completed');
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(page.getByText('Evidence received', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Queue training evidence', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Inspect delivery history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Delivery history', exact: true })).toBeVisible();
  await expect(page.getByText('Receipt accepted', { exact: true })).toBeVisible();
  const execution = providerExecutionViewSchema.parse(list().requests[0]);
  assert.equal(execution.receipts.length, 1);
  assert.equal(execution.receipts[0]!.mode, 'synthetic');
  assert.equal(execution.request.recordHash, record.recordHash);
  assert.equal(execution.request.selection.riskHash, record.decision!.evaluation.inputHash);
  assert.equal(
    fixture.store.insuranceRead(fixture.context, record.id).recordHash,
    record.recordHash,
  );
  assert.equal(fixture.store.insuranceHistory(fixture.context, record.id).revisions.length, 1);
  checks.push(
    'Real HTTPS UI queues an exact configured quote, the actual worker retains synthetic delivery, and insurance price/version/history remain unchanged.',
  );
  await page.reload();
  await page.getByRole('button', { name: new RegExp(submission.summary) }).click();
  await expect(page.getByText('Evidence received', { exact: true })).toBeVisible();
  checks.push(
    'Reload retains the completed provider request and prevents a second request for the same adapter/quote revision.',
  );
  const denied = await context.request.post(
    `${origin}/provider-callbacks/${execution.request.adapter.adapterId}/${execution.request.id}`,
    { headers: { 'content-type': 'application/json' }, data: '{}' },
  );
  assert.equal(denied.status(), 403);
  assert.equal((await denied.json()).error.code, 'SYNTHETIC_CALLBACK_FORBIDDEN');
  const csrf = await context.request.post(`${origin}/api/insurance/providers/requests`, {
    headers: { 'x-kernel-tenant-id': fixture.tenant.id },
    data: {
      recordId: record.id,
      expectedVersion: record.version,
      expectedRecordHash: record.recordHash,
      adapterId: execution.request.adapter.adapterId,
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(csrf.status(), 403);
  const other = kernel.control.execute(
    'control_create_tenant',
    {
      accountId: 'review-account',
      displayName: 'Other provider scope',
      environment: 'sandbox',
      region: 'test',
      idempotencyKey: randomUUID(),
    },
    approvalReviewer,
  ) as { tenant: { id: string } };
  assert.throws(() =>
    kernel.executeForPrincipal(
      'provider_get',
      { requestId: execution.request.id },
      approvalReviewer,
      other.tenant.id,
    ),
  );
  checks.push(
    'Public synthetic callback, missing CSRF and cross-tenant provider reads are rejected.',
  );
  await page.getByRole('button', { name: 'Inspect delivery history', exact: true }).click();
  await page.screenshot({
    path: 'test-results/insurance-provider-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Provider activity', exact: true })).toBeVisible();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({
    path: 'test-results/insurance-provider-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  assert.deepEqual(errors, []);
  checks.push(
    'Desktop and 390px mobile provider evidence renders without page errors or horizontal overflow.',
  );
  await writeFile(
    'test-results/insurance-provider-browser.json',
    JSON.stringify(
      {
        passed: true,
        checks,
        errors,
        externalProviderVerified: false,
        requestId: execution.request.id,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ passed: true, checks: checks.length, errors }));
} catch (error) {
  await page
    .screenshot({ path: 'test-results/insurance-provider-failure.png', fullPage: true })
    .catch(() => {});
  await writeFile(
    'test-results/insurance-provider-browser.json',
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

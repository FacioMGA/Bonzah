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
import type { Principal, TenantSetup } from '../src/contracts/control-plane.js';
import { buildApp } from '../src/server/app.js';
import { HostedAuth, SESSION_COOKIE } from '../src/server/hosted-auth.js';
import { AuthStore } from '../src/storage/auth-store.js';
import { Store } from '../src/storage/store.js';
import { syntheticScopedRequirements } from '../tests/fixtures/requirements.js';
import {
  configuredProductConfiguration,
  configuredRuntimePolicy,
  syntheticConfiguredSubmission,
} from '../tests/fixtures/insurance-definition.js';

// Actual HTTPS browser -> loopback TLS proxy -> actual Fastify TCP -> canonical services.
// Fixture sessions exercise the hosted session boundary, not a live external identity provider.
const directory = await mkdtemp(join(tmpdir(), 'facio-approval-browser-'));
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
const buildSha = 'a'.repeat(40);
let now = new Date('2026-09-06T12:00:00.000Z');
const kernel = new Kernel(store, [], [], () => new Date(now), {
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
// These are separate authenticated local fixture actors, not observed external identities.
const requesterPage = pages[0]!;
const reviewerPage = pages[2]!;
let tenantId = '';
async function must(index: number, path: string, method = 'GET', body?: unknown) {
  const result = await request(index, path, method, body, tenantId);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
async function openRecord(page: Page, recordId: string) {
  await page.goto(origin + '/studio?tenant=' + tenantId + '&view=insurance');
  await page.locator('[data-insurance-record="' + recordId + '"]').click();
  await expect(page.locator('.approval-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh reviews', exact: true })).toBeEnabled();
}
async function quote(label: string, actor = 0) {
  const submission = structuredClone(syntheticConfiguredSubmission);
  submission.reference = 'approval-' + label;
  submission.summary = 'Fictional review case: ' + label;
  submission.answers.age = 18;
  submission.coverages = [submission.coverages[0]!];
  const payload = {
    productId: configuredRuntimePolicy.id,
    productVersion: configuredRuntimePolicy.version,
    submission,
  };
  const evaluation = await must(actor, '/api/insurance/evaluate', 'POST', payload);
  assert.equal(evaluation.referral.status, 'required');
  assert.equal(evaluation.rating.premiumMinor, '10000');
  return (
    await must(actor, '/api/insurance/configured-quotes', 'POST', {
      ...payload,
      expectedEvaluationHash: evaluation.evaluationHash,
      participants: [{ id: 'synthetic-lead', role: 'lead', shareBps: 10000 }],
      idempotencyKey: randomUUID(),
    })
  ).record;
}
async function requestReview(page: Page, recordId: string, expiry = '2026-09-08T12:00') {
  await openRecord(page, recordId);
  await page.getByRole('button', { name: 'Request review', exact: true }).click();
  await page
    .getByLabel('Review request rationale', { exact: true })
    .fill('Review the synthetic age referral against the retained quote.');
  await page
    .getByLabel('Supporting evidence references', { exact: true })
    .fill('fixture://independent-review/request');
  await page.getByLabel('Review expires at (UTC)', { exact: true }).fill(expiry);
  await page.getByRole('button', { name: 'Submit review request', exact: true }).click();
  await expect(page.locator('.approval-status')).toContainText('Awaiting independent review');
  return (await must(0, '/api/insurance/approvals?recordId=' + recordId)).approvals[0].approval;
}
let capturedReviewForm = false;
async function decide(page: Page, recordId: string, decision: 'approve' | 'decline') {
  await openRecord(page, recordId);
  await page.getByRole('button', { name: 'Review request', exact: true }).click();
  await page
    .getByLabel('Decision rationale', { exact: true })
    .fill(
      decision === 'approve'
        ? 'Independent synthetic review completed for the exact retained quote and referral.'
        : 'Independent synthetic review declines this retained risk.',
    );
  await page
    .getByLabel('Supporting evidence references', { exact: true })
    .fill('fixture://independent-review/' + decision);
  if (!capturedReviewForm) {
    await page.getByText('Review retained risk answers and coverage', { exact: true }).click();
    await expect(
      page
        .locator('.approval-panel dt')
        .filter({ hasText: /^Declared value$/ })
        .locator('..'),
    ).toContainText('GBP 1,000.00');
    await expect(
      page
        .locator('.approval-panel dt')
        .filter({ hasText: /^Risk class$/ })
        .locator('..'),
    ).toContainText('Standard');
    await expect(page.locator('.approval-cover-list')).toContainText('Basic cover');
    await page.locator('.approval-panel').screenshot({
      path: 'test-results/insurance-approval-review-desktop.png',
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#main-content').focus();
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    );
    await page.locator('.approval-form').screenshot({
      path: 'test-results/insurance-approval-review-mobile.png',
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 1440, height: 1050 });
    capturedReviewForm = true;
  }
  await page
    .getByRole('button', {
      name: decision === 'approve' ? 'Approve pinned quote' : 'Decline review',
      exact: true,
    })
    .click();
  await expect(page.locator('.approval-status')).toContainText(
    decision === 'approve' ? 'Approved for the pinned quote' : 'Review declined',
  );
}
const decisionPayload = (approval: any) => ({
  approvalId: approval.id,
  expectedVersion: approval.version,
  approvalHash: approval.approvalHash,
  decision: 'approve',
  reason: 'Synthetic direct forbidden attempt',
  evidenceRefs: ['fixture://independent-review/forbidden'],
  idempotencyKey: randomUUID(),
});
try {
  const created = await request(0, '/api/control/tenants', 'POST', {
    accountId: 'synthetic-account',
    displayName: 'Independent review training',
    environment: 'sandbox',
    region: 'synthetic-test-region',
    idempotencyKey: randomUUID(),
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  tenantId = created.body.tenant.id;
  const initial = await setup(0, tenantId);
  await must(0, '/api/control/requirements', 'PUT', {
    expectedVersion: 0,
    profile: syntheticScopedRequirements.profile,
    idempotencyKey: randomUUID(),
  });
  const snapshot = await must(0, '/api/configuration?view=draft');
  await must(0, '/api/draft', 'PUT', {
    expectedVersion: snapshot.version,
    configuration: configuredProductConfiguration(initial.tenant.scope),
    idempotencyKey: randomUUID(),
  });
  const beforePolicy = await setup(0, tenantId);
  await must(0, '/api/control/runtime-draft', 'PUT', {
    expectedVersion: beforePolicy.runtimeDraft.version,
    policies: [configuredRuntimePolicy],
    idempotencyKey: randomUUID(),
  });
  const candidate = (await setup(0, tenantId)).candidate;
  await must(0, '/api/control/activate', 'POST', {
    draftVersion: candidate.draftVersion,
    draftHash: candidate.draftHash,
    requirementsHash: candidate.requirementsHash,
    runtimeDraftVersion: candidate.runtimeDraftVersion,
    runtimeDraftHash: candidate.runtimeDraftHash,
    idempotencyKey: randomUUID(),
  });

  const retained = await quote('approved');
  const requested = await requestReview(requesterPage, retained.id);
  await expect(
    requesterPage.getByRole('button', { name: 'Review request', exact: true }),
  ).toBeDisabled();
  assert.equal(
    (
      await request(
        0,
        '/api/insurance/approval/decision',
        'POST',
        decisionPayload(requested),
        tenantId,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        1,
        '/api/insurance/approval?approvalId=' + requested.id,
        'GET',
        undefined,
        tenantId,
      )
    ).status,
    403,
  );
  await decide(reviewerPage, retained.id, 'approve');
  const decided = await must(2, '/api/insurance/approval?approvalId=' + requested.id);
  assert.equal(decided.approval.actorId, actors[2]!.actorId);
  assert.equal(decided.approval.requesterId, actors[0]!.actorId);
  assert.equal(decided.history.length, 2);
  const exactReview = await must(2, '/api/insurance/approvals?recordId=' + retained.id);
  assert.equal(
    exactReview.reviewDefinition.riskFields.find((field: any) => field.id === 'value').type,
    'money',
  );
  // A prepared withdrawal must not silently disappear when the operator attempts binding.
  await reviewerPage.getByRole('button', { name: 'Withdraw review', exact: true }).click();
  const unsavedRationale = 'Unsaved withdrawal draft: retain this until explicitly discarded.';
  await reviewerPage.getByLabel('Withdrawal rationale', { exact: true }).fill(unsavedRationale);
  await reviewerPage
    .getByLabel('Supporting evidence references', { exact: true })
    .fill('fixture://independent-review/unsaved-withdrawal');
  const bindDialogPromise = reviewerPage.waitForEvent('dialog', { timeout: 5000 });
  const attemptedBind = reviewerPage
    .getByRole('button', { name: 'Bind selected quote', exact: true })
    .click();
  const bindDialog = await bindDialogPromise;
  assert.match(bindDialog.message(), /unsaved form changes/i);
  await bindDialog.dismiss();
  await attemptedBind;
  await expect(reviewerPage.getByLabel('Withdrawal rationale', { exact: true })).toHaveValue(
    unsavedRationale,
  );
  const afterDismiss = (await must(2, '/api/insurance/record?recordId=' + retained.id)).record;
  assert.equal(afterDismiss.recordHash, retained.recordHash);
  assert.equal(afterDismiss.status, 'quoted');
  assert.equal(
    (await must(2, '/api/insurance/approval?approvalId=' + requested.id)).history.length,
    2,
  );
  const navigationDialogPromise = reviewerPage.waitForEvent('dialog', { timeout: 5000 });
  const navigation = reviewerPage.locator('#sidebar [data-page="overview"]').click();
  const navigationDialog = await navigationDialogPromise;
  assert.match(navigationDialog.message(), /unsaved form changes/i);
  await navigationDialog.accept();
  await navigation;
  await reviewerPage.locator('#sidebar [data-page="insurance"]').click();
  await reviewerPage.locator('[data-insurance-record="' + retained.id + '"]').click();
  await expect(reviewerPage.locator('#insurance-approval-form')).toHaveCount(0);
  await reviewerPage.getByRole('button', { name: 'Withdraw review', exact: true }).click();
  await expect(reviewerPage.getByLabel('Withdrawal rationale', { exact: true })).toHaveValue('');
  await expect(
    reviewerPage.getByLabel('Supporting evidence references', { exact: true }),
  ).toHaveValue('');
  checks.push(
    'Dismissing Bind discard confirmation preserves an unsaved withdrawal and the exact quoted record/review history; accepting navigation discard clears the draft when returning and reopening the form.',
  );
  await openRecord(requesterPage, retained.id);
  await requesterPage.getByRole('button', { name: 'Bind selected quote', exact: true }).click();
  await expect(requesterPage.locator('.insurance-record-detail')).toContainText(
    'current revision 2',
  );
  await expect(requesterPage.locator('.approval-status')).toContainText(
    'Approval retained with binding',
  );
  const bound = (await must(0, '/api/insurance/record?recordId=' + retained.id)).record;
  assert.equal(bound.status, 'bound');
  assert.equal(bound.approval.approvalId, requested.id);
  assert.equal(bound.approval.reviewerId, actors[2]!.actorId);
  assert.equal(bound.premiumMinor, '10000');
  assert.equal(
    bound.decision.evaluation.evaluationHash,
    retained.decision.evaluation.evaluationHash,
  );
  await requesterPage.getByRole('button', { name: 'Inspect review history', exact: true }).click();
  await expect(requesterPage.locator('.approval-panel')).toContainText('Immutable review history');
  checks.push(
    'Actual requester and independent reviewer forms request, approve and bind the exact quote; retained question labels, choice labels and exact monetary units render from the pinned definition. Actor/evidence/history and original evaluation hashes match canonical API reads. Requester mutation and cross-tenant read are denied.',
  );

  const declined = await quote('declined');
  const declineRequest = await requestReview(requesterPage, declined.id);
  await decide(reviewerPage, declined.id, 'decline');
  assert.equal(
    (
      await request(
        0,
        '/api/insurance/bind',
        'POST',
        {
          recordId: declined.id,
          expectedVersion: declined.version,
          quoteHash: declined.quoteHash,
          approvalId: declineRequest.id,
          idempotencyKey: randomUUID(),
        },
        tenantId,
      )
    ).status,
    409,
  );
  const declineReport = await must(0, '/api/insurance/approvals?recordId=' + declined.id);
  assert.equal(declineReport.requestAvailability.canRequest, false);
  assert.equal(declineReport.bindableApprovalId, null);
  checks.push(
    'An independent decline through the form is retained, blocks binding and cannot be replaced by a new request on the same quote revision.',
  );

  const creatorCase = await quote('creator-cannot-review', 2);
  const creatorRequest = await requestReview(requesterPage, creatorCase.id);
  await openRecord(reviewerPage, creatorCase.id);
  await expect(
    reviewerPage.getByRole('button', { name: 'Review request', exact: true }),
  ).toBeDisabled();
  await expect(reviewerPage.locator('.approval-panel')).toContainText('created the record');
  assert.equal(
    (
      await request(
        2,
        '/api/insurance/approval/decision',
        'POST',
        decisionPayload(creatorRequest),
        tenantId,
      )
    ).status,
    403,
  );
  const requesterCase = await quote('admin-requester-cannot-review');
  const adminRequested = await requestReview(reviewerPage, requesterCase.id);
  await expect(
    reviewerPage.getByRole('button', { name: 'Review request', exact: true }),
  ).toBeDisabled();
  assert.equal(
    (
      await request(
        2,
        '/api/insurance/approval/decision',
        'POST',
        decisionPayload(adminRequested),
        tenantId,
      )
    ).status,
    403,
  );
  checks.push(
    'An administrator who created the quote or requested its review cannot approve it; UI controls and direct server decisions enforce both independence boundaries.',
  );

  const stale = await quote('stale');
  const staleRequest = await requestReview(requesterPage, stale.id);
  await openRecord(reviewerPage, stale.id);
  await reviewerPage.getByRole('button', { name: 'Review request', exact: true }).click();
  await reviewerPage
    .getByLabel('Decision rationale', { exact: true })
    .fill('This decision will become stale before submission.');
  await reviewerPage
    .getByLabel('Supporting evidence references', { exact: true })
    .fill('fixture://independent-review/stale');
  const revisedSubmission = structuredClone(stale.decision.submission);
  revisedSubmission.version = '2';
  revisedSubmission.answers.age = 19;
  const newEvaluation = await must(0, '/api/insurance/evaluate', 'POST', {
    recordId: stale.id,
    productId: stale.productId,
    productVersion: stale.productVersion,
    submission: revisedSubmission,
  });
  await must(0, '/api/insurance/configured-quotes', 'PUT', {
    recordId: stale.id,
    expectedVersion: stale.version,
    recordHash: stale.recordHash,
    submission: revisedSubmission,
    participants: stale.quote.participants,
    expectedEvaluationHash: newEvaluation.evaluationHash,
    idempotencyKey: randomUUID(),
  });
  const staleResponse = reviewerPage.waitForResponse(
    (response) =>
      response.url().endsWith('/api/insurance/approval/decision') &&
      response.request().method() === 'POST',
  );
  await reviewerPage.getByRole('button', { name: 'Approve pinned quote', exact: true }).click();
  assert.equal((await staleResponse).status(), 409);
  await expect(reviewerPage.locator('#notification')).toContainText(
    /changed|stale|review|applicable/i,
  );
  const staleView = await must(2, '/api/insurance/approval?approvalId=' + staleRequest.id);
  assert.equal(staleView.effectiveStatus, 'stale');
  assert.equal(staleView.approval.status, 'requested');
  await openRecord(reviewerPage, stale.id);
  await expect(reviewerPage.locator('.approval-status')).toContainText('no longer applies');
  checks.push(
    'A quote revision between opening and submitting a review rejects the stale form decision and projects stale status while preserving the original request.',
  );

  const withdrawn = await quote('withdrawn');
  const withdrawalRequest = await requestReview(requesterPage, withdrawn.id);
  await decide(reviewerPage, withdrawn.id, 'approve');
  await reviewerPage.getByRole('button', { name: 'Withdraw review', exact: true }).click();
  await reviewerPage
    .getByLabel('Withdrawal rationale', { exact: true })
    .fill('Withdraw this synthetic review before binding.');
  await reviewerPage
    .getByLabel('Supporting evidence references', { exact: true })
    .fill('fixture://independent-review/revoke');
  await reviewerPage
    .locator('#insurance-approval-form')
    .getByRole('button', { name: 'Withdraw review', exact: true })
    .click();
  await expect(reviewerPage.locator('.approval-status')).toContainText('Review withdrawn');
  assert.equal(
    (await must(2, '/api/insurance/approval?approvalId=' + withdrawalRequest.id)).history.length,
    3,
  );
  assert.equal(
    (await must(0, '/api/insurance/approvals?recordId=' + withdrawn.id)).bindableApprovalId,
    null,
  );
  checks.push(
    'The actual withdrawal form records a third immutable action and removes approval applicability without deleting the quote or history.',
  );

  const uncertain = await quote('uncertain-response');
  await openRecord(requesterPage, uncertain.id);
  await requesterPage.getByRole('button', { name: 'Request review', exact: true }).click();
  await requesterPage
    .getByLabel('Review request rationale', { exact: true })
    .fill('Retry this exact synthetic request after an uncertain response.');
  await requesterPage
    .getByLabel('Supporting evidence references', { exact: true })
    .fill('fixture://independent-review/uncertain');
  await requesterPage
    .getByLabel('Review expires at (UTC)', { exact: true })
    .fill('2026-09-08T12:00');
  const interceptedPayloads: any[] = [];
  await requesterPage.route('**/api/insurance/approvals', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    interceptedPayloads.push(route.request().postDataJSON());
    // Execute the real command, then lose its first response. No fake success body is supplied.
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    if (interceptedPayloads.length === 1) await route.abort('connectionfailed');
    else await route.fulfill({ response });
  });
  await requesterPage.getByRole('button', { name: 'Submit review request', exact: true }).click();
  await expect(requesterPage.locator('#notification')).toContainText(/uncertain/i);
  const durableFirstAttempt = await must(0, '/api/insurance/approvals?recordId=' + uncertain.id);
  assert.equal(durableFirstAttempt.approvals.length, 1);
  assert.equal(durableFirstAttempt.approvals[0].approval.version, 1);
  await expect(
    requesterPage.getByRole('button', { name: 'Submit review request', exact: true }),
  ).toBeEnabled();
  await requesterPage.getByRole('button', { name: 'Submit review request', exact: true }).click();
  await expect(requesterPage.locator('.approval-status')).toContainText(
    'Awaiting independent review',
  );
  await requesterPage.unroute('**/api/insurance/approvals');
  assert.equal(interceptedPayloads.length, 2);
  assert.deepEqual(interceptedPayloads[1], interceptedPayloads[0]);
  const durableRetry = await must(0, '/api/insurance/approvals?recordId=' + uncertain.id);
  assert.equal(durableRetry.approvals.length, 1);
  assert.equal(durableRetry.approvals[0].approval.id, durableFirstAttempt.approvals[0].approval.id);
  assert.equal(
    (await must(0, '/api/insurance/approval?approvalId=' + durableRetry.approvals[0].approval.id))
      .history.length,
    1,
  );
  checks.push(
    'A real accepted request whose response is lost remains durable; unchanged form retry reuses the identical idempotency key and payload, returning one original review with one history action.',
  );

  const expiring = await quote('expired');
  const expiryRequest = await requestReview(requesterPage, expiring.id, '2026-09-06T13:00');
  now = new Date('2026-09-06T14:00:00.000Z');
  await openRecord(reviewerPage, expiring.id);
  await expect(reviewerPage.locator('.approval-status')).toContainText('Review expired');
  assert.equal(
    (await must(2, '/api/insurance/approval?approvalId=' + expiryRequest.id)).effectiveStatus,
    'expired',
  );
  checks.push(
    'Server clock advancement projects expired status and disables review; no browser time assumption grants approval.',
  );

  await openRecord(reviewerPage, retained.id);
  await reviewerPage.locator('#main-content').focus();
  await reviewerPage.evaluate(() => window.scrollTo(0, 0));
  await reviewerPage.screenshot({
    path: 'test-results/insurance-approval-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await reviewerPage.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      reviewerPage.locator('#sidebar').evaluate((element) => element.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(1);
  assert(
    await reviewerPage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await reviewerPage.screenshot({
    path: 'test-results/insurance-approval-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  assert.deepEqual(errors, []);
  checks.push(
    'Desktop and 390px mobile review rendering has no page errors or horizontal overflow; the mobile navigation drawer is closed.',
  );
  await writeFile(
    'test-results/insurance-approval-browser.json',
    JSON.stringify({ passed: true, origin, buildSha, checks, errors }, null, 2) + '\n',
  );
  console.log(JSON.stringify({ passed: true, checks: checks.length, errors }));
} catch (error) {
  await reviewerPage
    .screenshot({ path: 'test-results/insurance-approval-failure.png', fullPage: true })
    .catch(() => {});
  await writeFile(
    'test-results/insurance-approval-browser.json',
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

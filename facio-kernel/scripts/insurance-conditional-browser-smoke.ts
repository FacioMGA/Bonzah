import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  configuredSubmissionV2Schema,
  type ConfiguredSubmissionV2,
} from '../src/contracts/insurance-definition.js';
import { buildApp } from '../src/server/app.js';
import { setupConfiguredV2 } from '../tests/fixtures/configured-v2.js';
const fixture = setupConfiguredV2(),
  record = fixture.create();
const token = randomBytes(32).toString('hex');
const { correlationId: _, ...context } = fixture.context;
const app = buildApp({
  kernel: fixture.kernel,
  credentials: [{ token, context }],
  maxRequestsPerMinute: 5000,
});
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors: string[] = [],
  checks: string[] = [];
const inputs: Array<{ submission: ConfiguredSubmissionV2 }> = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (new URL(request.url()).pathname === '/api/insurance/evaluate' && request.method() === 'POST')
    inputs.push(request.postDataJSON());
});
await mkdir('test-results', { recursive: true });
try {
  await page.goto(address);
  await page.locator('#access-token').fill(token);
  await page.locator('#login-submit').click();
  await expect(page.locator('#app-shell')).toBeVisible();
  await page.locator('#primary-nav [data-page="insurance"]').click();
  await page.locator(`[data-insurance-record="${record.id}"]`).click();
  await page.getByRole('button', { name: 'Revise quote', exact: true }).click();
  const row = page.locator('.decision-risk-row').first(),
    loss = row.getByLabel('Loss detail', { exact: true }),
    previous = row.getByLabel('Previous loss', { exact: true });
  await expect(loss).toBeHidden();
  await previous.selectOption('');
  await expect(loss).toBeVisible();
  await expect(
    row.locator('[data-risk-condition]').filter({ hasText: 'Answer the controlling questions' }),
  ).toBeVisible();
  await previous.selectOption('true');
  await expect(loss).toBeVisible();
  await expect(loss).toHaveAttribute('aria-required', 'true');
  await loss.fill('Local draft fact retained on a reversible toggle');
  await previous.selectOption('false');
  await expect(loss).toBeHidden();
  await expect(loss).toBeDisabled();
  await expect(page.locator('.insurance-record-detail .decision-result')).toBeVisible();
  await expect(row.locator('[data-risk-hidden-prefix]')).toContainText(
    'Previous values stay only in this unsaved form',
  );
  await page.getByLabel('Submission version', { exact: true }).fill('2');
  await page.getByLabel('Quote expires at (UTC)', { exact: true }).fill('2026-09-15T12:00');
  await page.getByRole('button', { name: 'Evaluate risk', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retain evaluated quote', exact: true }),
  ).toBeEnabled();
  assert.equal(inputs.length, 1);
  assert.equal(
    Object.hasOwn(inputs[0]!.submission.riskGroups[0]!.rows[0]!.answers, 'loss-detail'),
    false,
  );
  assert.equal(inputs[0]!.submission.riskGroups[0]!.rows[0]!.answers['previous-loss'], false);
  checks.push(
    'Unknown conditions stay visible; No hides and excludes the answer immediately, and the first preview succeeds without a hidden-answer retry.',
  );
  await previous.selectOption('true');
  await expect(loss).toBeVisible();
  await expect(loss).toHaveValue('Local draft fact retained on a reversible toggle');
  await expect(
    page.getByRole('button', { name: 'Retain evaluated quote', exact: true }),
  ).toBeDisabled();
  await loss.fill('');
  await page.getByRole('button', { name: 'Evaluate risk', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retain evaluated quote', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('.insurance-form-panel .decision-result')).toContainText(
    'Loss detail is required',
  );
  await loss.fill('Fresh visible disclosure');
  await page.getByRole('button', { name: 'Add Drivers', exact: true }).click();
  const second = page.locator('.decision-risk-row').last();
  await second.getByLabel('Name', { exact: true }).fill('Example B');
  await second.getByLabel('Age', { exact: true }).fill('35');
  await second.getByLabel('Previous loss', { exact: true }).selectOption('false');
  await expect(second.getByLabel('Loss detail', { exact: true })).toBeHidden();
  await expect(loss).toBeVisible();
  await page.getByRole('button', { name: 'Evaluate risk', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retain evaluated quote', exact: true }),
  ).toBeEnabled();
  const answers = inputs.at(-1)!.submission.riskGroups[0]!.rows;
  assert.equal(answers[0]!.answers['loss-detail'], 'Fresh visible disclosure');
  assert.equal(Object.hasOwn(answers[1]!.answers, 'loss-detail'), false);
  checks.push(
    'Restoring applicability restores only the local draft; clearing a visible required answer blocks evaluation, and repeated rows resolve their own conditions independently.',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({
    path: 'test-results/insurance-conditional-mobile-form.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({
    path: 'test-results/insurance-conditional-desktop-form.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Retain evaluated quote', exact: true }).click();
  await expect(
    page.getByText('Synthetic record saved · version 2.', { exact: false }),
  ).toBeVisible();
  const saved = fixture.store.insuranceRead(fixture.context, record.id);
  const retained = configuredSubmissionV2Schema.parse(saved.decision!.submission);
  assert.deepEqual(
    retained.riskGroups[0]!.rows.map((row) => row.answers),
    answers.map((row) => row.answers),
  );
  assert.equal(saved.status, 'quoted');
  await page.screenshot({ path: 'test-results/insurance-conditional-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  checks.push(
    'Only the canonical visible submission is retained on the exact revised quote; no bind occurs and mobile has no overflow.',
  );
  await writeFile(
    'test-results/insurance-conditional-browser.json',
    JSON.stringify({ passed: true, checks, errors, customerAcceptance: false }, null, 2) + '\n',
  );
  console.log(JSON.stringify({ passed: true, checks: checks.length, errors }));
} catch (error) {
  await page
    .screenshot({ path: 'test-results/insurance-conditional-failure.png', fullPage: true })
    .catch(() => {});
  await writeFile(
    'test-results/insurance-conditional-browser.json',
    JSON.stringify(
      {
        passed: false,
        checks,
        errors,
        error: String(error),
        notification: await page.locator('#notification').innerText(),
      },
      null,
      2,
    ) + '\n',
  );
  throw error;
} finally {
  await browser.close();
  await app.close();
  fixture.store.close();
}

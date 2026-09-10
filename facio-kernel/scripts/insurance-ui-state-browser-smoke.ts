import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { buildApp } from '../src/server/app.js';
import { setupConfiguredV2 } from '../tests/fixtures/configured-v2.js';
import { multiRiskDefinition, multiRiskSubmission } from '../tests/fixtures/insurance-v2.js';

const fixture = setupConfiguredV2();
const bound = fixture.bind(fixture.create());
const referral = structuredClone(multiRiskSubmission);
referral.reference = 'ui-state-referral';
referral.summary = 'Synthetic state review referral';
referral.riskGroups[0]!.rows[0]!.answers.age = 19;
const referred = fixture.create(referral);
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
page.on('pageerror', (error) => errors.push(error.message));
page.on('dialog', (dialog) => dialog.accept());
await mkdir('test-results', { recursive: true });
const select = async (id: string) => {
  await page.locator(`[data-insurance-record="${id}"]`).click();
  await expect(
    page.getByRole('button', { name: 'Record training receipt', exact: true }),
  ).toBeEnabled();
};
try {
  await page.goto(address);
  await page.locator('#access-token').fill(token);
  await page.locator('#login-submit').click();
  await expect(page.locator('#app-shell')).toBeVisible();
  await page.locator('#primary-nav [data-page="insurance"]').click();
  await select(bound.id);
  await page.getByRole('button', { name: 'Change risk or term', exact: true }).click();
  await page.getByLabel('Submission version', { exact: true }).fill('2');
  await page.getByLabel('Quote expires at (UTC)', { exact: true }).fill('2026-09-15T12:00');
  await page.getByLabel('Term end', { exact: true }).fill('2026-09-15');
  await page.getByLabel('Change effective date', { exact: true }).fill('2026-09-12');
  await page
    .getByLabel('Reason for change', { exact: true })
    .fill('Synthetic review of disabled participant state');
  await expect(page.locator('#participant-0-id')).toBeDisabled();
  await page.getByRole('button', { name: 'Preview change', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Record configured change', exact: true }),
  ).toBeEnabled();
  await expect(page.locator('#participant-0-id')).toBeDisabled();
  assert.equal(fixture.store.insuranceRead(fixture.context, bound.id).version, bound.version);
  checks.push('Service preview preserves disabled participant inputs and remains read-only.');

  await page.getByRole('button', { name: 'Record training receipt', exact: true }).click();
  await expect(page.locator('#insurance-quote-form')).toHaveCount(0);
  await expect(page.locator('#insurance-finance-form')).toBeVisible();
  await page
    .getByLabel('Reason for this action', { exact: true })
    .fill('Keep this unfinished financial input');
  await page.getByLabel('Effective through', { exact: true }).fill('2026-09-10');
  await page.getByLabel('Recorded through (UTC)', { exact: true }).fill('2026-09-10T12:00');
  await page.getByRole('button', { name: 'Build dated report', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Download dated report CSV', exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel('Reason for this action', { exact: true })).toHaveValue(
    'Keep this unfinished financial input',
  );
  await expect(page.locator('.finance-report-currency')).toHaveCount(1);
  await page.getByLabel('Recorded through (UTC)', { exact: true }).fill('2026-09-10T11:00');
  await expect(page.locator('.finance-report-currency')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Download dated report CSV', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('.finance-report-result')).toContainText('Report inputs changed');
  checks.push(
    'Opening finance discards an acknowledged service form; read-only report preserves financial input but changing cutoffs removes stale totals and disables export.',
  );

  await select(referred.id);
  await page.getByRole('button', { name: 'Revise quote', exact: true }).click();
  await page.getByLabel('Submission version', { exact: true }).fill('2');
  await page.locator('[data-insurance-approval-action="request"]').click();
  await expect(page.locator('#insurance-quote-form')).toHaveCount(0);
  await expect(page.locator('#insurance-approval-form')).toBeVisible();
  await page.locator('#approval-reason').fill('Synthetic request draft');
  await page.getByRole('button', { name: 'Record training receipt', exact: true }).click();
  await expect(page.locator('#insurance-approval-form')).toHaveCount(0);
  await expect(page.locator('#insurance-finance-form')).toBeVisible();
  checks.push(
    'Approval and finance are mutually exclusive with insurance revision forms after acknowledged discard.',
  );

  const repriced = structuredClone(multiRiskDefinition);
  repriced.coverages[0]!.rate = { method: 'flat', premiumMinor: '2000' };
  fixture.update(repriced);
  fixture.activate();
  await page.reload();
  await page.locator('#access-token').fill(token);
  await page.locator('#login-submit').click();
  await page.locator('#primary-nav [data-page="insurance"]').click();
  await select(bound.id);
  await page.getByRole('button', { name: 'Prepare renewal quote', exact: true }).click();
  await expect(page.locator('.decision-risk-row')).toHaveCount(1);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Example A');
  await expect(page.getByLabel('Commercial activity', { exact: true })).toHaveValue('false');
  checks.push(
    'A rate-only active release change retains editable risk answers and coverage selections for a separately evaluated renewal.',
  );

  const replacement = structuredClone(multiRiskDefinition);
  replacement.riskGroups[0]!.id = 'operators';
  replacement.riskGroups[0]!.label = 'Operators';
  replacement.coverages[2]!.scope = { kind: 'risk_group', groupId: 'operators' };
  fixture.update(replacement);
  fixture.activate();
  await page.reload();
  await page.locator('#access-token').fill(token);
  await page.locator('#login-submit').click();
  await page.locator('#primary-nav [data-page="insurance"]').click();
  await select(bound.id);
  await page.getByRole('button', { name: 'Prepare renewal quote', exact: true }).click();
  await expect(page.locator('#notification')).toContainText('active product definition changed');
  await expect(page.locator('.decision-risk-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add Operators', exact: true }).click();
  await expect(page.locator('.decision-risk-row')).toHaveCount(1);
  const rowId = await page
    .locator('.decision-risk-row [data-risk-row]')
    .getAttribute('data-risk-row');
  assert.match(rowId || '', /^risk-[a-f0-9-]+$/);
  await expect(page.getByRole('button', { name: 'Add Drivers', exact: true })).toHaveCount(0);
  assert.deepEqual(fixture.store.insuranceRead(fixture.context, bound.id), bound);
  checks.push(
    'A renewal against changed repeated-risk semantics requires re-entry, avoids stale invisible group data, and generates valid stable row identifiers without changing the source policy.',
  );
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'test-results/insurance-ui-state.png', fullPage: true });
  await writeFile(
    'test-results/insurance-ui-state-browser.json',
    JSON.stringify({ passed: true, checks, errors, customerAcceptance: false }, null, 2) + '\n',
  );
  console.log(JSON.stringify({ passed: true, checks: checks.length, errors }));
} catch (error) {
  await page
    .screenshot({ path: 'test-results/insurance-ui-state-failure.png', fullPage: true })
    .catch(() => {});
  await writeFile(
    'test-results/insurance-ui-state-browser.json',
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

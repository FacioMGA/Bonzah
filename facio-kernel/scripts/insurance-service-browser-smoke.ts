import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { buildApp } from '../src/server/app.js';
import { setupConfiguredV2 } from '../tests/fixtures/configured-v2.js';
import { multiRiskDefinition } from '../tests/fixtures/insurance-v2.js';

const fixture = setupConfiguredV2();
const initial = structuredClone(multiRiskDefinition);
initial.cancellation = {
  calculation: 'per_day_remaining',
  minimumPremiumTreatment: 'block_if_applied',
  sourceRefs: ['synthetic://cancellation-browser-rule'],
};
fixture.update(initial);
fixture.activate();
const quote = fixture.create();
const token = randomBytes(32).toString('hex');
const { correlationId: _, ...credentialContext } = fixture.context;
const app = buildApp({
  kernel: fixture.kernel,
  credentials: [{ token, context: credentialContext }],
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
const current = () => fixture.store.insuranceRead(fixture.context, quote.id);
const fillVersion = async (version: string) => {
  await page.getByLabel('Submission version', { exact: true }).fill(version);
  await page.getByLabel('Quote expires at (UTC)', { exact: true }).fill('2026-09-15T12:00');
};
await mkdir('test-results', { recursive: true });
try {
  await page.goto(address);
  await page.locator('#access-token').fill(token);
  await page.locator('#login-submit').click();
  await expect(page.locator('#app-shell')).toBeVisible();
  await page.locator('#primary-nav [data-page="insurance"]').click();
  await page.getByRole('button', { name: /Synthetic four-day multi-risk rental/ }).click();

  const replacement = structuredClone(multiRiskDefinition);
  replacement.coverages[0]!.rate = { method: 'flat', premiumMinor: '2000' };
  fixture.update(replacement);
  fixture.activate();
  await page.getByRole('button', { name: 'Revise quote', exact: true }).click();
  await fillVersion('2');
  await page.getByRole('button', { name: 'Evaluate risk', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retain evaluated quote', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Retain evaluated quote', exact: true }).click();
  await expect(
    page.getByText('Synthetic record saved · version 2.', { exact: false }),
  ).toBeVisible();
  assert.equal(current().premiumMinor, quote.premiumMinor);
  assert.equal(current().runtimeReleaseId, quote.runtimeReleaseId);
  assert.equal(current().decision!.submission.version, '2');
  checks.push(
    'Studio revises a configured quote against its retained release despite an active replacement with a different rate.',
  );
  await page.getByRole('button', { name: 'Bind selected quote', exact: true }).click();
  await expect(
    page.getByText('Synthetic record saved · version 3.', { exact: false }),
  ).toBeVisible();
  const bound = current();
  await page.getByRole('button', { name: 'Change risk or term', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Change configured risk or term', exact: true }),
  ).toBeVisible();
  await fillVersion('3');
  await page.getByLabel('Term end', { exact: true }).fill('2026-09-15');
  await page.getByLabel('Change effective date', { exact: true }).fill('2026-09-12');
  await page
    .getByLabel('Reason for change', { exact: true })
    .fill('Synthetic four-to-six-day extension');
  await expect(page.locator('#participant-0-id')).toBeDisabled();
  await page.getByRole('button', { name: 'Preview change', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Record configured change', exact: true }),
  ).toBeEnabled();
  assert.equal(current().version, bound.version);
  await page.getByLabel('Term end', { exact: true }).fill('2026-09-16');
  await expect(
    page.getByRole('button', { name: 'Record configured change', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Term end', { exact: true }).fill('2026-09-15');
  await page.getByRole('button', { name: 'Preview change', exact: true }).click();
  await page.getByRole('button', { name: 'Record configured change', exact: true }).click();
  await expect(
    page.getByText('Synthetic record saved · version 4.', { exact: false }),
  ).toBeVisible();
  const extended = current();
  assert.equal(extended.configuredService?.submission.term.endDate, '2026-09-15');
  assert.equal(extended.configuredService?.calculation?.premiumDeltaMinor, '2400');
  assert.equal(extended.premiumMinor, '7200');
  assert.deepEqual(extended.quote, bound.quote);
  assert.deepEqual(extended.decision, bound.decision);
  checks.push(
    'An actual four-to-six-day extension previews a 2400-minor-unit delta, invalidates on edits and retains the original quote/decision while committing one new contractual revision.',
  );

  await page.getByRole('button', { name: 'Change risk or term', exact: true }).click();
  await fillVersion('4');
  await page.getByLabel('Change effective date', { exact: true }).fill('2026-09-12');
  await page
    .getByLabel('Reason for change', { exact: true })
    .fill('Add a second named synthetic risk');
  await page.getByRole('button', { name: 'Add Drivers', exact: true }).click();
  const added = page.locator('.decision-risk-row').last();
  await added.getByLabel('Name', { exact: true }).fill('Example B');
  await added.getByLabel('Age', { exact: true }).fill('18');
  await added.getByLabel('Previous loss', { exact: true }).selectOption('true');
  await page.getByRole('button', { name: 'Preview change', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Record configured change', exact: true }),
  ).toBeDisabled();
  assert.equal(current().version, extended.version);
  await added.getByLabel('Loss detail', { exact: true }).fill('Synthetic reviewed prior incident');
  await added.getByLabel('Age', { exact: true }).fill('35');
  await page.getByRole('button', { name: 'Preview change', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Record configured change', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Record configured change', exact: true }).click();
  await expect(
    page.getByText('Synthetic record saved · version 5.', { exact: false }),
  ).toBeVisible();
  const serviced = current();
  assert.equal(serviced.configuredService?.submission.riskGroups[0]?.rows.length, 2);
  assert.equal(serviced.configuredService?.submission.riskGroups[0]?.rows[0]?.rowId, 'driver-a');
  assert.deepEqual(serviced.quote.participants, bound.quote.participants);
  checks.push(
    'Named repeated risks retain stable IDs; a missing conditional loss answer and referral block service until the new input independently satisfies retained rules.',
  );
  await page.getByRole('button', { name: 'Prepare renewal quote', exact: true }).click();
  await page.getByLabel('Submission reference', { exact: true }).fill('separate-renewal-term');
  await fillVersion('1');
  await page.getByLabel('Term start', { exact: true }).fill('2026-09-16');
  await page.getByLabel('Term end', { exact: true }).fill('2026-09-19');
  await page
    .getByLabel('Submission evidence references', { exact: true })
    .fill('synthetic://fresh-renewal-evidence');
  await page.locator('[data-insurance-action="evaluate-renewal"]').click();
  await expect(page.locator('[data-insurance-action="submit-renewal"]')).toBeEnabled();
  await page.locator('[data-insurance-action="submit-renewal"]').click();
  await expect(
    page.getByText('Synthetic record saved · version 1.', { exact: false }),
  ).toBeVisible();
  const renewal = fixture.store
    .insuranceList(fixture.context)
    .records.find((item) => item.renewal?.source.recordId === quote.id)!;
  assert(renewal);
  assert.equal(renewal.status, 'quoted');
  assert.equal(renewal.renewal?.source.recordHash, serviced.recordHash);
  assert.equal(renewal.premiumMinor, '8800');
  assert.deepEqual(current(), serviced);
  await page.getByRole('button', { name: 'Bind selected quote', exact: true }).click();
  await expect(
    page.getByText('Synthetic record saved · version 2.', { exact: false }),
  ).toBeVisible();
  assert.equal(fixture.store.insuranceRead(fixture.context, renewal.id).status, 'bound');
  checks.push(
    'Renewal uses a fresh source reference and active rate to create a distinct linked quote; normal binding is a separate explicit action and the source policy remains unchanged.',
  );
  await page.locator(`[data-insurance-record="${quote.id}"]`).click();
  await page.getByRole('button', { name: 'Cancel with configured return', exact: true }).click();
  await page.getByLabel('Cancellation effective date', { exact: true }).fill('2026-09-14');
  await page
    .getByLabel('Reason for cancellation', { exact: true })
    .fill('Synthetic scheduled cancellation');
  await page
    .getByLabel('Cancellation evidence references', { exact: true })
    .fill('synthetic://cancellation-instruction');
  await page.getByRole('button', { name: 'Preview cancellation', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Record configured cancellation', exact: true }),
  ).toBeEnabled();
  assert.equal(current().status, 'bound');
  await page.getByRole('button', { name: 'Record configured cancellation', exact: true }).click();
  await expect(
    page.getByText('Synthetic record saved · version 6.', { exact: false }),
  ).toBeVisible();
  assert.equal(current().status, 'cancelled');
  assert.equal(current().configuredCancellation?.calculation?.returnPremiumMinor, '2400');
  assert.equal(current().premiumMinor, '4800');
  assert.equal(current().configuredCancellation?.refundStatus, 'not_requested');
  checks.push(
    'A separate scheduled cancellation uses the retained explicit daily return rule and records cessation without inventing a refund payment or notice.',
  );
  await page.reload();
  await page.locator('#access-token').fill(token);
  await page.locator('#login-submit').click();
  await page.locator('#primary-nav [data-page="insurance"]').click();
  await page.locator(`[data-insurance-record="${quote.id}"]`).click();
  await expect(page.getByText('Latest contractual term', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/insurance-service-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: 'test-results/insurance-service-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  checks.push(
    'Reload retains the changed term and immutable history; desktop and mobile have no page errors or overflow.',
  );
  await writeFile(
    'test-results/insurance-service-browser.json',
    JSON.stringify({ passed: true, checks, errors, customerAcceptance: false }, null, 2) + '\n',
  );
  console.log(JSON.stringify({ passed: true, checks: checks.length, errors }));
} catch (error) {
  await page
    .screenshot({ path: 'test-results/insurance-service-failure.png', fullPage: true })
    .catch(() => {});
  await writeFile(
    'test-results/insurance-service-browser.json',
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

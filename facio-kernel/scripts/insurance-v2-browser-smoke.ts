import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { buildApp } from '../src/server/app.js';
import { setupConfiguredV2 } from '../tests/fixtures/configured-v2.js';
import { snapshotSchema } from '../src/contracts/configuration.js';
import { validateInsuranceDefinition } from '../src/domain/insurance-decision.js';
const fixture = setupConfiguredV2();
const token = randomBytes(32).toString('hex');
const { correlationId: _, ...credentialContext } = fixture.context;
const app = buildApp({
  kernel: fixture.kernel,
  credentials: [{ token, context: credentialContext }],
  maxRequestsPerMinute: 2000,
});
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
try {
  await page.goto(address);
  await page.locator('#access-token').fill(token);
  await page.locator('#login-submit').click();
  await expect(page.locator('#app-shell')).toBeVisible();
  await page.locator('#primary-nav [data-page="products"]').click();
  await page.getByRole('button', { name: 'Edit product', exact: true }).click();
  await page.locator('[data-ic-section="questions"]').click();
  await expect(
    page.getByRole('heading', { name: 'Repeated risk groups', exact: true }),
  ).toBeVisible();
  await page.locator('[data-ic-path="insurance.riskGroups.0.maximumRows"]').fill('6');
  await page
    .locator('[data-ic-action="add-field"][data-ic-list="insurance.riskGroups.0.fields"]')
    .click();
  const fieldPath = 'insurance.riskGroups.0.fields.4';
  await page.locator(`[data-ic-path="${fieldPath}.id"]`).fill('licensed');
  await page.locator(`[data-ic-path="${fieldPath}.label"]`).fill('Licence confirmed');
  await page.locator(`[data-ic-path="${fieldPath}.type"]`).selectOption('boolean');
  await page
    .locator(`[data-ic-path="${fieldPath}.description"]`)
    .fill('Synthetic row-local conditional boolean');
  await page.locator(`[data-ic-path="${fieldPath}.sourceRefs"]`).fill('synthetic://editor/licence');
  await page
    .locator(`[data-ic-action="set-condition"][data-ic-path-target="${fieldPath}.visibleWhen"]`)
    .click();
  await page
    .locator(`[data-ic-path="${fieldPath}.visibleWhen.conditions.0.fieldId"]`)
    .selectOption('previous-loss');
  await page
    .locator(`[data-ic-path="${fieldPath}.visibleWhen.conditions.0.value"]`)
    .selectOption('true');
  await page.locator('[data-ic-section="coverages"]').click();
  await expect(
    page.locator('[data-ic-path="insurance.coverages.1.layer.underlyingCoverageId"]'),
  ).toHaveValue('primary');
  await page
    .locator('[data-ic-path="insurance.coverages.1.aggregateLimit.maximumMinor"]')
    .fill('25000.00');
  await page.locator('[data-ic-section="rating"]').click();
  await expect(page.locator('[data-ic-path="insurance.rating.termBasis"]')).toHaveValue('per_day');
  await expect(page.locator('[data-ic-path="insurance.servicing.calculation"]')).toHaveValue(
    'per_day_remaining',
  );
  await page.getByRole('button', { name: 'Save product definition', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit product', exact: true })).toBeVisible();
  const draft = snapshotSchema.parse(fixture.execute('configuration_inspect', { view: 'draft' })),
    definition = draft.configuration.products[0]!.insurance!;
  assert.equal(definition.schemaVersion, 'insurance-product-v2');
  if (definition.schemaVersion !== 'insurance-product-v2') throw new Error('Version mismatch');
  assert.equal(definition.riskGroups[0]!.maximumRows, 6);
  assert.equal(definition.riskGroups[0]!.fields[4]!.visibleWhen?.conditions[0]?.kind, 'comparison');
  assert.equal(definition.coverages[1]!.aggregateLimit?.maximumMinor, '2500000');
  assert.deepEqual(validateInsuranceDefinition(definition), []);
  checks.push(
    'Actual Studio saves typed repeated questions and row-local boolean conditions, exact scoped aggregate/excess values and explicit servicing rules',
  );
  assert.deepEqual(errors, []);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/insurance-v2-editor.png', fullPage: true });
  await writeFile(
    'test-results/insurance-v2-browser-checks.json',
    JSON.stringify({ checks, errors }, null, 2) + '\n',
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
  await app.close();
  fixture.store.close();
}

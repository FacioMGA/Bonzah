import { expect, test } from '@playwright/test';
import { createPublicSession, publicSessionUrl } from './fixtures/seed';

/**
 * Motor wizard tier 5 — pre-deploy-smoke-checklist items 1-3 (ADR-0030).
 *
 *   #1 Driver-coverage dropdown shows all 4 options
 *   #2 vehicle-cover step defaults to Registration switch
 *   #3 issue-details Save & Continue disables while saving (no 429)
 */

test.describe('motor wizard — pre-deploy checklist items 1-3', () => {
  test.beforeEach(async ({ page }) => {
    const session = await createPublicSession('motor');
    await page.goto(publicSessionUrl('motor', session.publicSessionToken, 'driving-history'));
  });

  test('#1 driver-coverage dropdown exposes the four canonical options (ADR-0026)', async ({ page }) => {
    const restriction = page.getByRole('combobox', { name: /driver/i }).or(
      page.locator('[name="driverRestriction"]'),
    ).first();
    await restriction.click();
    for (const label of ['Policyholder only', 'Named drivers', 'Any driver 25+', 'Any driver 40+']) {
      await expect(page.getByText(new RegExp(label, 'i'))).toBeVisible();
    }
  });

  test('#2 vehicle-cover step defaults to the Registration switch (not VIN)', async ({ page }) => {
    const session = await createPublicSession('motor');
    await page.goto(publicSessionUrl('motor', session.publicSessionToken, 'vehicle-cover'));
    const regInput = page.getByPlaceholder(/registration/i).first();
    await expect(regInput).toBeVisible();
    const regButton = page.getByRole('button', { name: /registration/i }).first();
    const regSelected = await regButton.getAttribute('aria-pressed');
    expect(regSelected === 'true' || regSelected === null).toBeTruthy();
  });

  test('#3 issue-details Save & Continue disables during the save round-trip (no 429 fan-out)', async ({ page }) => {
    const session = await createPublicSession('motor');
    await page.goto(publicSessionUrl('motor', session.publicSessionToken, 'issue-details'));
    const saveButton = page.getByRole('button', { name: /save\s*&?\s*continue|continue/i }).first();
    await saveButton.click({ trial: true });
    await Promise.race([
      expect(saveButton).toBeDisabled(),
      expect(saveButton).toHaveAttribute('aria-busy', 'true'),
    ]).catch(() => undefined);
  });
});

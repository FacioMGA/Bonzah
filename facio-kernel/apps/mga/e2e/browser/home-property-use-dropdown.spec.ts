import { expect, test } from '@playwright/test';
import { createPublicSession, publicSessionUrl } from './fixtures/seed';

/**
 * ABY-485 — property step uses a single Property use dropdown
 * (Permanent home / Holiday home) instead of separate Yes/No tiles.
 */
test.describe('home wizard — property use dropdown (ABY-485)', () => {
  test('property step shows Property use dropdown with permanent and holiday options', async ({ page }) => {
    const session = await createPublicSession('home');
    await page.goto(publicSessionUrl('home', session.publicSessionToken, 'property'));

    await expect(page.getByText('Property use', { exact: true })).toBeVisible();

    const select = page.locator('[data-field="property.permanentHome"] select');
    await expect(select).toBeVisible();
    await expect(select.locator('option', { hasText: 'Permanent home' })).toHaveCount(1);
    await expect(select.locator('option', { hasText: 'Holiday home' })).toHaveCount(1);

    await select.selectOption('holiday');
    await expect(select).toHaveValue('holiday');
    await select.selectOption('permanent');
    await expect(select).toHaveValue('permanent');
  });
});

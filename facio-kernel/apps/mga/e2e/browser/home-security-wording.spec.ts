import { expect, test } from '@playwright/test';
import { createPublicSession, publicSessionUrl } from './fixtures/seed';

/**
 * ABY-460 — home wizard security step customer-facing lock wording.
 */
test.describe('home wizard — security step wording (ABY-460)', () => {
  test('shows simplified door and window lock questions', async ({ page }) => {
    const session = await createPublicSession('home');
    await page.goto(publicSessionUrl('home', session.publicSessionToken, 'security'));

    await expect(
      page.getByText('Are all external doors fitted with key operated locks (standard or local equivalent)?'),
    ).toBeVisible();
    await expect(
      page.getByText('Are all easily accessible windows and patio doors fitted with interior locks?'),
    ).toBeVisible();
  });
});

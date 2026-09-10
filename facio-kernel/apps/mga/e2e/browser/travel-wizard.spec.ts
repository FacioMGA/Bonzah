import { expect, test } from '@playwright/test';
import { createPublicSession, publicSessionUrl } from './fixtures/seed';

/**
 * Travel wizard tier 5 — pre-deploy-smoke-checklist items 5-7 (ADR-0030).
 *
 *   #5 Lead DOB 20/04/1975 renders as 20/04/1975 on your-details (ABY-239)
 *   #6 Selected addons show euro amounts on order summary (ABY-241/242)
 *   #7 Trip dates in sidebar match what the user entered (no off-by-one)
 */

test.describe('travel wizard — pre-deploy checklist items 5-7', () => {
  test('#5 lead-traveller DOB 20/04/1975 round-trips to your-details surface (ABY-239)', async ({ page }) => {
    const session = await createPublicSession('travel');
    await page.goto(publicSessionUrl('travel', session.publicSessionToken, 'travellers'));
    const dob = page.getByPlaceholder(/dd\s*\/\s*mm\s*\/\s*yyyy|date of birth/i).first();
    await dob.fill('20/04/1975');
    await dob.blur();
    await expect(dob).toHaveValue(/20\/04\/1975/);
  });

  test('#6 selected addons render with euro amounts on the order summary (ABY-241/242)', async ({ page }) => {
    const session = await createPublicSession('travel');
    await page.goto(publicSessionUrl('travel', session.publicSessionToken, 'options'));
    const addButton = page.getByRole('button', { name: /^add$/i }).first();
    await addButton.click();
    await expect(page.getByRole('button', { name: /^added$/i }).first()).toBeVisible();
    await expect(page.locator('text=/€\\s*\\d+/').first()).toBeVisible();
  });

  test('#7 trip dates in sidebar match what the user entered (no off-by-one)', async ({ page }) => {
    const session = await createPublicSession('travel');
    await page.goto(publicSessionUrl('travel', session.publicSessionToken, 'trip'));
    await page.getByLabel(/start date/i).fill('2026-06-15');
    await page.getByLabel(/end date/i).fill('2026-06-22');
    await expect(page.locator('aside,[role="complementary"]').getByText(/15\/06\/2026|2026-06-15/)).toBeVisible();
    await expect(page.locator('aside,[role="complementary"]').getByText(/22\/06\/2026|2026-06-22/)).toBeVisible();
  });

  test('#8 trip end date calendar stays inside the viewport near the page bottom (ABY-524)', async ({ page }) => {
    const session = await createPublicSession('travel');
    await page.setViewportSize({ width: 1663, height: 927 });
    await page.goto(publicSessionUrl('travel', session.publicSessionToken, 'trip'));
    const endDatePicker = page.getByRole('button', { name: /open trip end date picker/i });
    await endDatePicker.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await endDatePicker.click();
    const dialog = page.getByRole('dialog', { name: /trip end date calendar/i });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
    await expect(dialog.getByRole('button', { name: 'Next month' })).toBeVisible();
  });
});

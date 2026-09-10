import { expect, test } from '@playwright/test';
import { createPublicSession, publicSessionUrl } from './fixtures/seed';

/**
 * Home wizard tier 5 — pre-deploy-smoke-checklist item 8 (ADR-0030).
 *
 *   #8 "+ Add joint proposer" button has visible spacing above and below
 */

test.describe('home wizard — pre-deploy checklist item 8', () => {
  test('#8 Add joint proposer button has visible spacing above and below', async ({ page }) => {
    const session = await createPublicSession('home');
    await page.goto(publicSessionUrl('home', session.publicSessionToken, 'policy-holder'));
    const button = page.getByRole('button', { name: /joint proposer/i });
    await expect(button).toBeVisible();
    const spacing = await button.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const margin = parseFloat(style.marginTop) + parseFloat(style.marginBottom);
      const parent = el.parentElement ? window.getComputedStyle(el.parentElement) : null;
      const gap = parent ? parseFloat(parent.rowGap || parent.gap || '0') : 0;
      return { margin, gap };
    });
    expect(spacing.margin + spacing.gap).toBeGreaterThan(0);
  });
});

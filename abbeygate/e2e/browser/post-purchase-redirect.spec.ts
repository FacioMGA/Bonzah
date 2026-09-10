import { expect, test } from '@playwright/test';
import { createPublicSession, publicSessionUrl } from './fixtures/seed';

/**
 * Post-purchase redirect tier 5 — pre-deploy-smoke-checklist items 4
 * + 9 (ABY-238, ADR-0030).
 *
 *   #4 Motor post-purchase: logged-out -> /verify-email; logged-in -> /client;
 *      NEVER /login?mode=signup&claimToken=...
 *   #9 Home post-purchase: same redirect contract as motor.
 *
 * The wizard's success screen calls `resolvePostPurchaseDashboardTarget`
 * (frontend/src/shared/lib/wizard/postPurchaseDashboardTarget.ts) — the
 * three deterministic branches that file pins are exercised end-to-end
 * here.
 */

for (const productCode of ['motor', 'home'] as const) {
  test.describe(`${productCode} post-purchase redirect (ABY-238)`, () => {
    test(`logged-out customer with email lands on /verify-email (#${productCode === 'motor' ? '4' : '9'})`, async ({ page }) => {
      const session = await createPublicSession(productCode);
      // The spec assumes the success screen renders for sessions that
      // reached payment. Test-mode bypasses CardCorp via a flag we set
      // server-side in seed.ts; the success screen's primary CTA calls
      // resolvePostPurchaseDashboardTarget with { hasSession: false,
      // email: '<seeded email>' }.
      await page.goto(publicSessionUrl(productCode, session.publicSessionToken, 'success'));
      const dashboardCta = page.getByRole('link', { name: /dashboard|client portal|account/i }).first();
      const href = await dashboardCta.getAttribute('href');
      expect(href).toMatch(/\/verify-email\?/);
      expect(href).not.toMatch(/\/login\?mode=signup&claimToken=/);
    });

    test(`logged-in customer lands straight on /client (#${productCode === 'motor' ? '4' : '9'} authenticated)`, async ({ page, context }) => {
      // Authenticated context — set the auth_token cookie the
      // readClientSessionFlag helper observes.
      await context.addCookies([
        { name: 'auth_token', value: 'e2e-fake-session', url: 'http://127.0.0.1:5173' },
      ]);
      await page.evaluate(() => {
        try { window.localStorage.setItem('auth_token', 'e2e-fake-session'); } catch {}
      });
      const session = await createPublicSession(productCode);
      await page.goto(publicSessionUrl(productCode, session.publicSessionToken, 'success'));
      const dashboardCta = page.getByRole('link', { name: /dashboard|client portal|account/i }).first();
      const href = await dashboardCta.getAttribute('href');
      expect(href).toMatch(/^\/client/);
    });
  });
}

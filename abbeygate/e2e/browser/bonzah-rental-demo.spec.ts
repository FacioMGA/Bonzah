import { expect, test } from '@playwright/test';

const apiBase = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:3000';

test.describe('Summit Rentals / Bonzah embedded demo', () => {
  test('reprices coverage, enforces dependencies, and exposes the identical partner snapshot', async ({ page, request }) => {
    await page.goto('/summit-rentals');
    await page.getByRole('button', { name: /choose pickup and return dates/i }).click();
    await page.getByRole('button', { name: 'September 20, 2026' }).click();
    await page.getByRole('button', { name: 'September 25, 2026' }).click();
    await page.getByRole('button', { name: /apply rental dates/i }).click();
    await expect(page.getByRole('button', { name: /choose pickup and return dates/i })).toContainText('Sep 20 — Sep 25');
    await page.getByRole('button', { name: /show available vehicles/i }).click();
    await page.getByRole('button', { name: /choose toyota rav4/i }).click();
    await page.getByRole('button', { name: /^continue$/i }).click();

    const sli = page.getByLabel(/supplemental liability/i);
    await expect(sli).toBeDisabled();
    await page.getByLabel(/renter's contingent liability/i).check();
    await expect(sli).toBeEnabled();
    await sli.check();
    await page.getByRole('button', { name: /^continue$/i }).click();

    const finalQuoteResponse = page.waitForResponse(response => response.url().endsWith('/api/public/bonzah/quotes') && response.request().method() === 'POST');
    await page.getByRole('button', { name: /continue to payment/i }).click();
    const finalQuote = (await (await finalQuoteResponse).json()).data;
    expect(finalQuote.ruleVersion).toBe('bonzah-rental-foundation@2.0.0');

    const partnerResponse = await request.get(`${apiBase}/api/v1/bonzah/quotes/${finalQuote.quoteId}`, {
      headers: { Authorization: 'Bearer bonzah-demo-local-token', 'X-Partner-Id': 'summit-rentals-demo' },
    });
    expect(partnerResponse.ok()).toBe(true);
    const partnerQuote = (await partnerResponse.json()).data;
    expect(partnerQuote).toMatchObject({ quoteId: finalQuote.quoteId, total: finalQuote.total, ruleVersion: finalQuote.ruleVersion });
    await page.getByRole('button', { name: /^pay /i }).click();
    await expect(page.getByRole('heading', { name: /summit journey is confirmed/i })).toBeVisible();
  });

  test('visibly differentiates referred and declined vehicles', async ({ page }) => {
    await page.goto('/summit-rentals');
    await page.getByRole('button', { name: /show available vehicles/i }).click();
    await page.getByRole('button', { name: /choose porsche 911/i }).click();
    await page.getByRole('button', { name: /^continue$/i }).click();
    await page.getByRole('button', { name: /^continue$/i }).click();
    await page.getByRole('button', { name: /continue to payment/i }).click();
    await expect(page.getByRole('alert')).toContainText(/not eligible/i);

    await page.getByRole('button', { name: /back to protect your rental/i }).click();
    await page.getByRole('button', { name: /back to which vehicle/i }).click();
    await page.getByRole('button', { name: /choose apex touring/i }).click();
    await page.getByRole('button', { name: /^continue$/i }).click();
    await page.getByRole('button', { name: /^continue$/i }).click();
    await page.getByRole('button', { name: /continue to payment/i }).click();
    await expect(page.getByRole('alert')).toContainText(/review is required/i);
  });
});

test.describe('Bonzah direct rental-protection demo', () => {
  test('saves trip parameters, completes renter and vehicle details, reprices, and confirms payment', async ({ page }) => {
    await page.goto('/bonzah');
    expect(new URL(page.url()).search).toBe('');
    await expect(page.getByRole('heading', { name: /affordable, complete protection/i })).toBeVisible();
    await page.getByRole('button', { name: /choose pickup and return dates/i }).click();
    await expect(page.getByRole('dialog', { name: /pickup and return dates/i })).toBeVisible();
    await page.getByRole('button', { name: /close date picker/i }).click();
    await page.getByRole('button', { name: /get my quote/i }).click();
    await expect(page).toHaveURL(/\/bonzah\/quote\/coverages\?pickupCountry=United\+States/);
    const savedTripSearch = new URL(page.url()).search;
    await expect(page.getByRole('navigation', { name: /bonzah quote steps/i }).getByText(/2\. coverages/i)).toHaveAttribute('aria-current', 'step');

    const sli = page.getByLabel(/supplemental liability/i);
    await expect(sli).toBeDisabled();
    const cdwTripPrice = await page.getByText(/for 4 charged periods/i).first().textContent();
    await page.getByLabel(/renter's contingent liability/i).check();
    await expect(sli).toBeEnabled();
    await sli.check();
    await page.getByLabel(/personal accident/i).check();
    expect(await page.getByText(/for 4 charged periods/i).last().textContent()).not.toBe(cdwTripPrice);
    await page.getByRole('button', { name: /continue to renter details/i }).click();
    await expect(page).toHaveURL(/\/bonzah\/quote\/renter-and-vehicle/);
    expect(new URL(page.url()).search).toBe(savedTripSearch);
    await expect(page.getByRole('heading', { name: /tell us about your rental and drivers/i })).toBeVisible();
    await page.getByLabel(/rental company/i).fill('Summit Rentals');
    await page.getByLabel(/^make/i).fill('Toyota');
    await page.getByLabel(/^model/i).fill('RAV4');
    await page.getByRole('button', { name: /continue to payment/i }).click();

    await expect(page.getByRole('heading', { name: /secure payment/i })).toBeVisible();
    await expect(page).toHaveURL(/\/bonzah\/quote\/payment/);
    expect(new URL(page.url()).search).toBe(savedTripSearch);
    await expect(page.getByText(/summary of charges/i)).toBeVisible();
    await expect(page.getByLabel(/card number/i)).toBeVisible();
    await expect(page.getByText(/^Demo checkout$/i)).toHaveCount(0);
    await page.getByRole('button', { name: /^pay .* demo$/i }).click();
    await expect(page.getByRole('heading', { name: /your protection is confirmed/i })).toBeVisible();
    await expect(page).toHaveURL(/\/bonzah\/quote\/confirmation/);
    expect(new URL(page.url()).search).toBe(savedTripSearch);
    await expect(page.getByText(/BC-DEMO-/i)).toBeVisible();
  });
});

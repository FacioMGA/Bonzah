/**
 * ABY-487 — Home construction-risk NCD field should read
 * "Years claim free (up to a maximum of 4)" and cap wizard options at 4 years.
 */
import { describe, expect, it } from 'vitest';
import {
  HOME_NO_CLAIMS_DISCOUNT_LABEL,
  HOME_NO_CLAIMS_DISCOUNT_LEGACY_VALUE,
  HOME_NO_CLAIMS_DISCOUNT_OPTIONS,
  HOME_NO_CLAIMS_DISCOUNT_VALID_OPTIONS,
  homeManifest,
} from '../manifest';

describe('home manifest — no claims discount wording (ABY-487)', () => {
  it('uses the agreed customer-facing field label', () => {
    expect(HOME_NO_CLAIMS_DISCOUNT_LABEL).toBe('Years claim free (up to a maximum of 4)');

    const constructionRisk = homeManifest.questionnaire.sections.find((section) => section.id === 'construction-risk');
    const field = constructionRisk?.fields.find((entry) => entry.path === 'risk.noClaimsDiscount');

    expect(field?.label).toBe(HOME_NO_CLAIMS_DISCOUNT_LABEL);
  });

  it('offers 0–4 years claim free in the wizard and keeps legacy 5+ Years valid', () => {
    expect(HOME_NO_CLAIMS_DISCOUNT_OPTIONS.map((option) => option.value)).toEqual([
      '0 Years',
      '1 Year',
      '2 Years',
      '3 Years',
      '4 Years',
    ]);
    expect(HOME_NO_CLAIMS_DISCOUNT_OPTIONS.map((option) => option.label)).toEqual([
      '0 years claim free',
      '1 year claim free',
      '2 years claim free',
      '3 years claim free',
      '4 years claim free',
    ]);
    expect(HOME_NO_CLAIMS_DISCOUNT_OPTIONS.some((option) => option.value === HOME_NO_CLAIMS_DISCOUNT_LEGACY_VALUE)).toBe(false);
    expect(HOME_NO_CLAIMS_DISCOUNT_VALID_OPTIONS.map((option) => option.value)).toContain(HOME_NO_CLAIMS_DISCOUNT_LEGACY_VALUE);
  });
});

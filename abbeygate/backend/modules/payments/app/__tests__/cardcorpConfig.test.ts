import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import type { TenantConfig } from '../../../../platform/tenant/tenantConfig.js';
import {
  cardcorpBaseUrl,
  getCardcorpConfig,
  isCardcorpLive,
  listCardcorpWebhookSecrets,
  listConfiguredCardcorpCountries,
} from '../cardcorpConfig.js';

const TRACKED = [
  'CARDCORP_ENV',
  'CARDCORP_BASE_URL',
  'CARDCORP_TEST_MODE',
  'CARDCORP_BEARER_TOKEN',
  'CARDCORP_ENTITY_ID_CY',
  'CARDCORP_ENTITY_ID_PT',
  'CARDCORP_ENTITY_ID_GR',
  'CARDCORP_WEBHOOK_SECRET_CY',
  'CARDCORP_WEBHOOK_SECRET_PT',
  'CARDCORP_WEBHOOK_SECRET_GR',
];

const CY_TENANT: TenantConfig = {
  id: '00000000-0000-4000-8000-000000000001',
  tenantSlug: 'abbeygate-cy',
  countryCode: 'CY',
  country: 'Cyprus',
  currency: 'EUR',
  ipt: { flatFee: 0 },
  adminFee: 18,
  legalPack: 'cy',
  publicBaseUrl: 'https://abbeygate-cy.facio.io',
  fromEmail: 'no-reply@facio.io',
  brandLogo: { white: '', blue: '' },
};

describe('cardcorpConfig', () => {
  const original: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of TRACKED) original[k] = process.env[k];
    for (const k of TRACKED) delete process.env[k];
  });
  afterEach(() => {
    for (const k of TRACKED) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it('defaults to test mode with the OPPWA test host', () => {
    expect(isCardcorpLive()).toBe(false);
    expect(cardcorpBaseUrl()).toBe('https://eu-test.oppwa.com');
  });

  it('uses the live host and omits testMode when CARDCORP_ENV=live', () => {
    process.env.CARDCORP_ENV = 'live';
    process.env.CARDCORP_BEARER_TOKEN = 'shared-bearer';
    process.env.CARDCORP_ENTITY_ID_PT = 'ent-pt';
    const cfg = getCardcorpConfig('PT');
    expect(isCardcorpLive()).toBe(true);
    expect(cfg.baseUrl).toBe('https://eu-prod.oppwa.com');
    expect(cfg.testMode).toBeUndefined();
    expect(cfg.entityId).toBe('ent-pt');
    expect(cfg.bearerToken).toBe('shared-bearer');
  });

  it('resolves the per-country entity id from the ALS operating tenant', async () => {
    process.env.CARDCORP_BEARER_TOKEN = 'shared-bearer';
    process.env.CARDCORP_ENTITY_ID_CY = 'ent-cy';
    await runWithOperatingTenant(CY_TENANT, async () => {
      const cfg = getCardcorpConfig();
      expect(cfg.countryCode).toBe('CY');
      expect(cfg.entityId).toBe('ent-cy');
      expect(cfg.testMode).toBe('EXTERNAL');
    });
  });

  it('does NOT fall back to another country or a global entity id (fail closed)', () => {
    process.env.CARDCORP_BEARER_TOKEN = 'shared-bearer';
    process.env.CARDCORP_ENTITY_ID_CY = 'ent-cy';
    // Ask for GR, which is not configured — no fallback to CY.
    const cfg = getCardcorpConfig('GR');
    expect(cfg.entityId).toBe('');
  });

  it('lists only countries with BOTH an entity id and a webhook secret', () => {
    process.env.CARDCORP_ENTITY_ID_CY = 'ent-cy';
    process.env.CARDCORP_WEBHOOK_SECRET_CY = 'a'.repeat(64);
    process.env.CARDCORP_ENTITY_ID_PT = 'ent-pt'; // no PT secret → excluded
    expect(listConfiguredCardcorpCountries()).toEqual(['CY']);
    expect(listCardcorpWebhookSecrets()).toEqual([{ countryCode: 'CY', secretHex: 'a'.repeat(64) }]);
  });
});

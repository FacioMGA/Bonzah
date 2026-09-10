import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getIntegrationStatuses, summarizeIntegrationHealth } from '../integrationHealth.js';

const TRACKED_ENV = [
  'NODE_ENV',
  'CARDCORP_ENTITY_ID',
  'CARDCORP_ENTITY_ID_CY',
  'CARDCORP_WEBHOOK_SECRET_CY',
  'CARDCORP_BEARER_TOKEN',
  'CREDITSAFE_ENABLED',
  'CREDITSAFE_BASE_URL',
  'CREDITSAFE_USERNAME',
  'CREDITSAFE_PASSWORD',
  'SENTRY_DSN',
  'SENDGRID_API_KEY',
];

describe('integrationHealth', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of TRACKED_ENV) original[key] = process.env[key];
    for (const key of TRACKED_ENV) delete process.env[key];
  });

  afterEach(() => {
    for (const key of TRACKED_ENV) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('reports CardCorp as not configured when env vars are blank', () => {
    process.env.NODE_ENV = 'production';
    const cardcorp = getIntegrationStatuses().find((i) => i.id === 'cardcorp');
    expect(cardcorp).toBeDefined();
    expect(cardcorp?.configured).toBe(false);
    expect(cardcorp?.required).toBe(true);
  });

  it('reports CardCorp as configured when the shared bearer + a per-country entity/secret are set', () => {
    process.env.NODE_ENV = 'production';
    process.env.CARDCORP_BEARER_TOKEN = 'tok-1';
    process.env.CARDCORP_ENTITY_ID_CY = 'ent-cy';
    process.env.CARDCORP_WEBHOOK_SECRET_CY = 'a'.repeat(64);
    const cardcorp = getIntegrationStatuses().find((i) => i.id === 'cardcorp');
    expect(cardcorp?.configured).toBe(true);
  });

  it('reports CardCorp as NOT configured when only the legacy global entity id is set (per-country required)', () => {
    process.env.NODE_ENV = 'production';
    process.env.CARDCORP_ENTITY_ID = 'ent-legacy';
    process.env.CARDCORP_BEARER_TOKEN = 'tok-1';
    const cardcorp = getIntegrationStatuses().find((i) => i.id === 'cardcorp');
    expect(cardcorp?.configured).toBe(false);
  });

  it('treats missing CardCorp as advisory (not required) outside production', () => {
    process.env.NODE_ENV = 'development';
    const cardcorp = getIntegrationStatuses().find((i) => i.id === 'cardcorp');
    expect(cardcorp?.required).toBe(false);
  });

  it('Creditsafe is not required unless CREDITSAFE_ENABLED is truthy', () => {
    process.env.NODE_ENV = 'production';
    const off = getIntegrationStatuses().find((i) => i.id === 'creditsafe');
    expect(off?.required).toBe(false);

    process.env.CREDITSAFE_ENABLED = 'true';
    const on = getIntegrationStatuses().find((i) => i.id === 'creditsafe');
    expect(on?.required).toBe(true);
    expect(on?.configured).toBe(false);
  });

  it('summary is degraded when any required integration is missing in prod', () => {
    process.env.NODE_ENV = 'production';
    expect(summarizeIntegrationHealth().status).toBe('degraded');

    process.env.CARDCORP_BEARER_TOKEN = 'tok-1';
    process.env.CARDCORP_ENTITY_ID_CY = 'ent-cy';
    process.env.CARDCORP_WEBHOOK_SECRET_CY = 'a'.repeat(64);
    process.env.SENTRY_DSN = 'https://abc@o0.ingest.us.sentry.io/0';
    process.env.SENDGRID_API_KEY = 'SG.test-key';
    expect(summarizeIntegrationHealth().status).toBe('ok');
  });

  it('reports SendGrid email as required in production and configured when SENDGRID_API_KEY is set', () => {
    process.env.NODE_ENV = 'production';
    const missing = getIntegrationStatuses().find((i) => i.id === 'sendgrid');
    expect(missing?.required).toBe(true);
    expect(missing?.configured).toBe(false);

    process.env.SENDGRID_API_KEY = 'SG.test-key';
    const set = getIntegrationStatuses().find((i) => i.id === 'sendgrid');
    expect(set?.configured).toBe(true);
  });

  it('treats SendGrid email as advisory (not required) outside production', () => {
    process.env.NODE_ENV = 'development';
    const sendgrid = getIntegrationStatuses().find((i) => i.id === 'sendgrid');
    expect(sendgrid?.required).toBe(false);
  });

  it('summary is ok in non-prod even when CardCorp is unconfigured', () => {
    process.env.NODE_ENV = 'development';
    expect(summarizeIntegrationHealth().status).toBe('ok');
  });

  it('reports Sentry as required in production and configured when SENTRY_DSN is set', () => {
    process.env.NODE_ENV = 'production';
    const missing = getIntegrationStatuses().find((i) => i.id === 'sentry');
    expect(missing?.required).toBe(true);
    expect(missing?.configured).toBe(false);

    process.env.SENTRY_DSN = 'https://abc@o0.ingest.us.sentry.io/0';
    const set = getIntegrationStatuses().find((i) => i.id === 'sentry');
    expect(set?.configured).toBe(true);
  });

  it('treats Sentry as advisory (not required) outside production', () => {
    process.env.NODE_ENV = 'development';
    const sentry = getIntegrationStatuses().find((i) => i.id === 'sentry');
    expect(sentry?.required).toBe(false);
  });
});

#!/usr/bin/env node
import fs from 'node:fs/promises';

const baseUrlRaw = process.env.APP_BASE_URL || process.env.AKS_API_BASE_URL || '';
const apiKey = String(process.env.API_V1_SMOKE_KEY || '').trim();
const programId = String(process.env.API_V1_PROGRAM_ID || '11111111-1111-4111-8111-111111111111').trim();
const artifactPath = String(process.env.SMOKE_ARTIFACT_PATH || '/tmp/quote-bind-issue-smoke.json').trim();
const publicTenantId = String(process.env.PUBLIC_TENANT_ID || process.env.API_V1_SMOKE_TENANT_ID || '').trim();
const publicSessionToken = String(process.env.PUBLIC_SESSION_TOKEN || '').trim();
const hardTimeoutMs = Number(process.env.API_V1_SMOKE_TIMEOUT_MS || 180000);
const strictMissingApiKey = ['1', 'true', 'yes'].includes(
  String(process.env.API_V1_SMOKE_STRICT || process.env.RELEASE_SMOKE_STRICT_APP_JOURNEYS || '').toLowerCase(),
);

if (!baseUrlRaw) {
  throw new Error('Missing APP_BASE_URL or AKS_API_BASE_URL for smoke test');
}

const baseUrl = baseUrlRaw.replace(/\/$/, '');
const attemptId = `smoke-${Date.now()}`;
const timings = [];
const startedAt = Date.now();
const out = {
  attemptId,
  baseUrl,
  startedAt: new Date(startedAt).toISOString(),
  passed: false,
  quoteId: null,
  policyId: null,
  timings,
  readiness: {
    attempted: false,
    endpoint: null,
    canIssue: null,
    fallbackUsed: false,
    lastPayload: null,
    lastStatus: null,
  },
  docs: {
    requiredTypes: ['MOTOR_SCHEDULE_PDF', 'MOTOR_CERTIFICATE_PDF'],
    lastPayload: null,
    observedTypes: [],
  },
  error: null,
};

function markStep(name, startMs, status, details = {}) {
  timings.push({
    step: name,
    durationMs: Date.now() - startMs,
    status,
    ...details,
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isoDateDaysFromNow(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function requestJson(url, init = {}) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: res.status, ok: res.ok, json };
  } finally {
    clearTimeout(timeout);
  }
}

function documentListFromPayload(payload) {
  const data = payload?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.documents)) return data.documents;
  return [];
}

function smokeQuotePayload() {
  const effectiveDate = isoDateDaysFromNow(7);
  return {
    programId,
    quoteData: {
      proposer: {
        firstName: 'Smoke',
        lastName: 'Tester',
        email: `smoke+${Date.now()}@example.com`,
        phone: '+35799111222',
        dateOfBirth: '1988-01-01',
        address: {
          line1: '123 Integration Lane',
          city: 'Nicosia',
          province: 'Nicosia',
          postcode: '1000',
          country: 'Cyprus',
        },
        domicileCountry: 'Cyprus',
        // Must NOT be an operating-territory nationality (CY/PT/GR/ES/IT):
        // local nationals refer to UW (ADR-0059), which would break the
        // bind step. A UK expat resident in Cyprus is the target customer.
        nationality: 'United Kingdom',
        nif: '12345678',
        occupation: 'Software Engineer',
        whereDidYouHear: 'Friend',
        bestTimeToCall: 'Morning (09:00-12:00)',
        privacyPolicyAccepted: true,
        marketingConsent: false,
      },
      licenseYears: 10,
      licenseType: 'Full',
      licenseIssuedIn: 'Cyprus',
      hasClaims: false,
      hasConvictions: false,
      coverRequired: 'Comprehensive',
      renewalDate: effectiveDate,
      vehicleType: 'Car',
      make: 'Toyota',
      model: 'Corolla',
      fuelType: 'Petrol',
      kmsPerYear: '10,000',
      year: 2020,
      countryOfRegistration: 'Cyprus',
      registrationNumber: `SMK${String(Date.now()).slice(-6)}`,
      engineSize: 1800,
      vehicleValue: 30000,
      ncb: '2 Years',
      driverRestriction: 'POLICYHOLDER_ONLY',
      hasAdditionalDrivers: false,
      additionalDrivers: [],
      vehicleUse: 'SD&P',
      requiredExcess: '300',
      infoTrueAndAccurate: true,
      fairProcessingAccepted: true,
    },
    effectiveDate,
  };
}

async function run() {
  if (!apiKey) {
    const skipReason = 'API_V1_SMOKE_KEY missing; smoke skipped';
    const skipArtifact = {
      ...out,
      passed: !strictMissingApiKey,
      skipped: true,
      skipReason,
      finishedAt: new Date().toISOString(),
    };
    await fs.writeFile(artifactPath, JSON.stringify(skipArtifact, null, 2), 'utf8');
    if (strictMissingApiKey) {
      throw new Error('API_V1_SMOKE_KEY missing; strict smoke cannot run quote-bind issue journey');
    }
    console.log(`[smoke] skipped (missing API_V1_SMOKE_KEY), artifact written to ${artifactPath}`);
    return;
  }

  try {
    const quoteStep = Date.now();
    const quoteResp = await requestJson(`${baseUrl}/api/v1/quotes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(smokeQuotePayload()),
    });
    if (!quoteResp.ok) {
      throw new Error(`Quote failed (${quoteResp.status}): ${JSON.stringify(quoteResp.json)}`);
    }
    const quoteId = quoteResp.json?.data?.quoteId;
    const quoteToken = quoteResp.json?.data?.quoteToken;
    if (!quoteId || !quoteToken) {
      throw new Error(`Quote response missing quoteId/quoteToken: ${JSON.stringify(quoteResp.json)}`);
    }
    out.quoteId = String(quoteId);
    markStep('quote', quoteStep, 'success', { quoteId: out.quoteId });

    const bindStep = Date.now();
    const bindResp = await requestJson(`${baseUrl}/api/v1/policies`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        quoteId: out.quoteId,
        quoteToken: String(quoteToken),
        paymentMethod: { type: 'INVOICE' },
      }),
    });
    if (!bindResp.ok) {
      throw new Error(`Bind failed (${bindResp.status}): ${JSON.stringify(bindResp.json)}`);
    }
    out.policyId = String(bindResp.json?.data?.id || out.quoteId || '');
    if (!out.policyId) {
      throw new Error(`Bind response missing policy id: ${JSON.stringify(bindResp.json)}`);
    }
    markStep('bind', bindStep, 'success', { policyId: out.policyId });

    const readinessStep = Date.now();
    out.readiness.attempted = true;
    out.readiness.endpoint = `${baseUrl}/api/public/motor/session/${out.policyId}/issue-readiness`;
    const readinessHeaders = {};
    if (publicTenantId) readinessHeaders['x-tenant-id'] = publicTenantId;
    if (publicSessionToken) readinessHeaders['x-public-session-token'] = publicSessionToken;
    let readinessPass = false;
    const backoff = [2000, 3000, 5000, 8000, 13000];
    for (const delay of backoff) {
      const rd = await requestJson(out.readiness.endpoint, { headers: readinessHeaders });
      out.readiness.lastStatus = rd.status;
      out.readiness.lastPayload = rd.json;
      if (rd.ok && rd.json?.data) {
        const canIssue = Boolean(rd.json.data.canIssue || rd.json.data.customerOutcome === 'issued');
        out.readiness.canIssue = canIssue;
        if (canIssue) {
          readinessPass = true;
          break;
        }
      }
      await wait(delay);
      if (Date.now() - startedAt > hardTimeoutMs) break;
    }
    if (!readinessPass) {
      out.readiness.fallbackUsed = true;
    }
    markStep('readiness_poll', readinessStep, readinessPass ? 'success' : 'fallback', {
      status: out.readiness.lastStatus,
      canIssue: out.readiness.canIssue,
    });

    const docsStep = Date.now();
    const required = new Set(out.docs.requiredTypes);
    const docsBackoff = [3000, 5000, 8000, 12000, 15000];
    let docsReady = false;
    for (const delay of docsBackoff) {
      const docs = await requestJson(`${baseUrl}/api/v1/policies/${out.policyId}/documents`, {
        headers: { 'x-api-key': apiKey },
      });
      out.docs.lastPayload = docs.json;
      if (docs.ok) {
        const list = documentListFromPayload(docs.json);
        const types = list.map((d) => String(d?.type || '').toUpperCase()).filter(Boolean);
        out.docs.observedTypes = Array.from(new Set(types));
        const hasRequired = Array.from(required).every((reqType) => types.includes(reqType));
        const hasMetadata = list.some((d) => d?.id && d?.filename && d?.url && d?.createdAt);
        if (hasRequired && hasMetadata) {
          docsReady = true;
          break;
        }
      }
      await wait(delay);
      if (Date.now() - startedAt > hardTimeoutMs) break;
    }
    if (!docsReady) {
      throw new Error(`Documents not ready within timeout. Last payload: ${JSON.stringify(out.docs.lastPayload)}`);
    }
    markStep('documents', docsStep, 'success', {
      observedTypes: out.docs.observedTypes,
    });

    out.passed = true;
  } catch (error) {
    out.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    out.finishedAt = new Date().toISOString();
    out.totalDurationMs = Date.now() - startedAt;
    await fs.writeFile(artifactPath, JSON.stringify(out, null, 2), 'utf8');
    console.log(`[smoke] artifact written to ${artifactPath}`);
  }
}

run().catch((err) => {
  console.error(`[smoke] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});


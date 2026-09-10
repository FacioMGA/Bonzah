#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * tools/smoke/sanctions-screening-verify.mjs
 *
 * End-to-end smoke check for the Creditsafe KYC Protect AML integration.
 * Authenticates, runs a search for a known PEP/sanctions hit (Saud
 * Al-Qahtani, Saudi Arabia), asserts the search returns at least one hit,
 * requests the PDF report, downloads it, and writes it to
 * `/tmp/sanctions-smoke.pdf`. Prints the first-hit projection in the same
 * shape the BO will render.
 *
 * Usage:
 *   node tools/smoke/sanctions-screening-verify.mjs
 *
 * Required env vars (see backend/modules/compliance/app/serviceFactory.ts
 * for the canonical loader):
 *   CREDITSAFE_BASE_URL      e.g. https://connect.creditsafe.com/v1
 *   CREDITSAFE_USERNAME      Creditsafe Connect account email
 *   CREDITSAFE_PASSWORD      Creditsafe Connect account password
 * Optional:
 *   CREDITSAFE_TIMEOUT_MS    default 15000
 *   CREDITSAFE_DATASETS      default "SAN-CURRENT,PEP-CURRENT,AM"
 *                            (the production default is SAN-CURRENT only;
 *                            we expand here because the test subject is
 *                            primarily a PEP — without PEP-CURRENT this
 *                            script would falsely report "no hits".)
 *   CREDITSAFE_THRESHOLD     default 90
 *   SMOKE_PDF_OUT            default /tmp/sanctions-smoke.pdf
 *
 * Exit codes:
 *   0  search returned a hit AND the PDF was downloaded successfully
 *   1  any step failed (auth, search, no hits, PDF download)
 *
 * This script intentionally does NOT touch the database or the platform's
 * storage service — it is a thin black-box probe of the third-party API
 * surface only, so it can be safely run from a developer machine to verify
 * credentials and connectivity before relying on the in-app integration.
 */

import { writeFile } from 'node:fs/promises';

const BASE_URL = (process.env.CREDITSAFE_BASE_URL || '').replace(/\/+$/, '');
const USERNAME = process.env.CREDITSAFE_USERNAME || '';
const PASSWORD = process.env.CREDITSAFE_PASSWORD || '';
const TIMEOUT_MS = Math.max(1000, Number(process.env.CREDITSAFE_TIMEOUT_MS || 15000));
// Smoke default is `SAN-CURRENT` only — the test subject (Saud Al-Qahtani)
// returns a hit against this single dataset, so the smoke stays cheap (1
// Creditsafe credit per run) and asserts the narrowest possible path. The
// production dataset list lives in `backend/modules/compliance/app/serviceFactory.ts`
// and defaults to the full AML stack — do not import that default here,
// the smoke must remain executable without the backend.
const DATASETS = String(process.env.CREDITSAFE_DATASETS || 'SAN-CURRENT')
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean);
const THRESHOLD = Number(process.env.CREDITSAFE_THRESHOLD || 90);
const PDF_OUT = process.env.SMOKE_PDF_OUT || '/tmp/sanctions-smoke.pdf';

function die(message, extra) {
  console.error(`[smoke] FAIL: ${message}`);
  if (extra !== undefined) console.error(extra);
  process.exit(1);
}

function ok(message) {
  console.log(`[smoke] OK: ${message}`);
}

function info(message, value) {
  console.log(`[smoke] ${message}${value !== undefined ? ` ${JSON.stringify(value)}` : ''}`);
}

if (!BASE_URL || !USERNAME || !PASSWORD) {
  die('CREDITSAFE_BASE_URL / CREDITSAFE_USERNAME / CREDITSAFE_PASSWORD must be set.');
}

async function authenticate() {
  const res = await fetch(`${BASE_URL}/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) die(`authenticate failed: HTTP ${res.status}`, await res.text());
  const payload = await res.json();
  if (typeof payload?.token !== 'string' || payload.token.length === 0) {
    die('authenticate response missing token', payload);
  }
  ok('authenticated');
  return payload.token;
}

async function searchSaudAlQahtani(token) {
  // Mirror production: screen by name (+ DOB when known) only. `countryCodes`
  // is intentionally omitted — it filters the AML search and over-narrows
  // results (ADR-0043). The test subject still hits on name alone.
  const body = {
    name: 'Saud Al-Qahtani',
    threshold: THRESHOLD,
    datasets: DATASETS,
  };
  info('search request', body);
  const res = await fetch(`${BASE_URL}/compliance/kyc-protect/searches/individuals`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) die(`search failed: HTTP ${res.status}`, text);
  const payload = text ? JSON.parse(text) : {};
  // The Creditsafe POST response is just search metadata — it tells us
  // `totalHitCount` but does NOT inline the hit rows. The hit list itself
  // lives behind GET /searches/individuals/{searchId}/hits.
  const totalHitCount = typeof payload?.totalHitCount === 'number'
    ? payload.totalHitCount
    : typeof payload?.hitCount === 'number'
      ? payload.hitCount
      : 0;
  info('search id', payload?.id);
  info('totalHitCount', totalHitCount);
  if (totalHitCount === 0) {
    die(
      `Expected at least one hit for the test subject. Check that the configured datasets include the relevant lists. Current datasets: ${DATASETS.join(', ')}`,
      payload,
    );
  }
  ok(`search returned ${totalHitCount} hit(s)`);
  return { searchId: String(payload?.id || ''), totalHitCount };
}

async function fetchHits(token, searchId) {
  const res = await fetch(
    `${BASE_URL}/compliance/kyc-protect/searches/individuals/${encodeURIComponent(searchId)}/hits`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  const text = await res.text();
  if (!res.ok) die(`fetch hits failed: HTTP ${res.status}`, text);
  const payload = text ? JSON.parse(text) : {};
  if (process.env.SMOKE_DEBUG_HITS) {
    console.log('[smoke] raw /hits payload:\n' + JSON.stringify(payload, null, 2));
  }
  // Creditsafe wraps the array under different keys depending on the
  // endpoint version — try `hits`, `data`, the top-level array, or a
  // common `items` wrapper.
  const candidates = [payload?.hits, payload?.data, payload?.items, payload?.results, payload];
  let hits = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      hits = candidate;
      break;
    }
  }
  if (hits.length === 0 && !process.env.SMOKE_DEBUG_HITS) {
    console.log('[smoke] /hits returned no recognizable array shape. Top-level keys:', Object.keys(payload));
  }
  ok(`fetched ${hits.length} hit row(s)`);
  return hits;
}

function pickHitId(hit) {
  return hit?.id || hit?.hitId || hit?.supplierHitId || '';
}

function projectFirstHit(hits) {
  if (hits.length === 0) return null;
  // Mirror the production projection in
  // backend/modules/compliance/infra/creditsafeSanctionsProvider.ts —
  // any drift between this script and the provider means BO will render
  // something different from what the smoke says is stored.
  const scored = hits.map((h) => ({
    h,
    score: typeof h?.hitScore === 'number' ? h.hitScore : Number(h?.matchScore ?? h?.score ?? -1),
  }));
  scored.sort((a, b) => (Number.isFinite(b.score) ? b.score : -1) - (Number.isFinite(a.score) ? a.score : -1));
  const top = scored[0]?.h || hits[0];
  const gender = String(top?.gender || '');
  return {
    matchScore: typeof top?.hitScore === 'number'
      ? top.hitScore
      : (typeof top?.matchScore === 'number' ? top.matchScore : null),
    name: top?.name || top?.match || [top?.firstName, top?.middleName, top?.lastName].filter(Boolean).join(' '),
    country: Array.isArray(top?.countries) ? top.countries[0] : (top?.country || top?.countryCode || ''),
    dateOfBirth: Array.isArray(top?.datesOfBirth) ? top.datesOfBirth[0] || '' : (top?.dateOfBirth || top?.dob || ''),
    gender: gender ? gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase() : '',
    pepTier: top?.pepTier || (Array.isArray(top?.pepTiers) ? top.pepTiers.join(', ') : ''),
    reasonsListed: Array.isArray(top?.datasets)
      ? top.datasets.join(', ')
      : (Array.isArray(top?.reasonsListed) ? top.reasonsListed.join(', ') : (top?.reasonsListed || top?.reasonListed || '')),
    hitId: pickHitId(top),
  };
}

async function downloadPdf(token, searchId, hitIds) {
  if (!searchId) die('searchId missing — cannot request PDF');
  if (hitIds.length === 0) die('no hit ids — cannot request PDF');
  info('PDF request', { searchId, hitIdCount: hitIds.length });
  const metaRes = await fetch(
    `${BASE_URL}/compliance/kyc-protect/searches/individuals/${encodeURIComponent(searchId)}/download`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(hitIds),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  const metaText = await metaRes.text();
  if (!metaRes.ok) die(`PDF metadata fetch failed: HTTP ${metaRes.status}`, metaText);
  const metadata = metaText ? JSON.parse(metaText) : {};
  if (!metadata?.downloadUrl) die('PDF metadata missing downloadUrl', metadata);
  ok('PDF download URL issued');
  info('PDF filename', metadata.fileName);
  info('PDF expiresAt', metadata.expiresAt);

  const binRes = await fetch(metadata.downloadUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!binRes.ok) die(`PDF binary fetch failed: HTTP ${binRes.status}`);
  const buf = Buffer.from(await binRes.arrayBuffer());
  if (buf.length < 256) die(`PDF binary suspiciously small (${buf.length} bytes)`);
  await writeFile(PDF_OUT, buf);
  ok(`PDF written to ${PDF_OUT} (${buf.length} bytes)`);
}

async function main() {
  const token = await authenticate();
  const { searchId } = await searchSaudAlQahtani(token);
  const hits = await fetchHits(token, searchId);
  if (hits.length === 0) die('search reported hits but /hits endpoint returned an empty array');
  const firstHit = projectFirstHit(hits);
  if (!firstHit?.hitId) die('failed to project a usable first-hit row', hits);
  info('first-hit row', firstHit);
  const hitIds = hits.map((h) => pickHitId(h)).filter(Boolean);
  await downloadPdf(token, searchId, hitIds);
  ok('integration verified end-to-end');
}

main().catch((err) => {
  die(err?.message || 'unhandled error', err);
});

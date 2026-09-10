import express from 'express';
import { mkdir, appendFile, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { EU_MAKE_ALIASES, EU_POPULAR_MAKES, EU_POPULAR_MODELS, type VehicleOption } from '../app/publicVehiclesCatalog.js';
import type { RequestHandler } from 'express';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { buildDomainEvent } from '../../../platform/events/domainEvents.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { logger } from '../../../platform/utils/logger.js';

const VPIC_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles';

type Option = VehicleOption;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAKES_TTL_MS = 7 * ONE_DAY_MS;
const MODELS_TTL_MS = 30 * ONE_DAY_MS;

const makesCache: { at: number; data: Option[]; key: string } = { at: 0, data: [], key: '' };
const modelsCache = new Map<string, { at: number; data: Option[] }>();
const metrics = {
  makesCalls: 0,
  modelsCalls: 0,
  upstreamCalls: 0,
  upstreamFailures: 0,
  estimatedCostEur: 0,
};
const VEHICLE_ADMIN_FILE = join(process.cwd(), 'server', 'data', 'vehicle_api_admin.json');
type VehicleApiAdmin = { payer: 'peter' | 'insurer' };
type VpicMakeResult = { Make_Name?: string };
type VpicModelResult = { Model_Name?: string };

const SuggestBodySchema = z.object({
  make: z.string().trim().optional(),
  model: z.string().trim().optional(),
  trim: z.string().trim().optional(),
  // `vin` is the VIN that the user entered which CarDog failed to
  // decode (Vin @ CarDog, 2026-06-02 — "Please also provide the VIN
  // entered that failed to decode" so they can pre-populate the
  // catalogue row in their automation). Optional because the
  // manual-model-entry blur on Step 3 can fire before the user has
  // typed a VIN, and the catalogue-gap email is still useful with
  // make/model only.
  vin: z.string().trim().optional(),
  note: z.string().trim().optional(),
  source: z.string().trim().optional(),
  publicSessionId: z.string().trim().optional(),
  policyId: z.string().trim().optional(),
});
const AdminPayerBodySchema = z.object({
  payer: z.enum(['peter', 'insurer']),
});

type PublicVehiclesRouterDeps = {
  authenticate: RequestHandler;
  requireBO: RequestHandler;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function loadVehicleApiAdmin(): Promise<VehicleApiAdmin> {
  try {
    const raw = await readFile(VEHICLE_ADMIN_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const payer = String(parsed?.payer || 'peter').toLowerCase() === 'insurer' ? 'insurer' : 'peter';
    return { payer };
  } catch {
    return { payer: 'peter' };
  }
}

async function saveVehicleApiAdmin(admin: VehicleApiAdmin): Promise<void> {
  await mkdir(join(process.cwd(), 'server', 'data'), { recursive: true });
  await writeFile(VEHICLE_ADMIN_FILE, JSON.stringify(admin, null, 2), 'utf8');
}

function uniqSorted(options: Option[]): Option[] {
  const seen = new Map<string, Option>();
  for (const o of options) {
    const v = String(o?.value || '').trim();
    if (!v) continue;
    if (!seen.has(v.toUpperCase())) seen.set(v.toUpperCase(), { value: v, label: o.label || v });
  }
  return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Merge curated (high-trust) options with upstream (vPIC) options:
 *  - Curated entries are pinned at the top, preserving the order they
 *    were declared in `EU_POPULAR_MAKES` / `EU_POPULAR_MODELS[make]`.
 *  - Upstream entries that don't collide (case-insensitive value match)
 *    are appended in alphabetical order.
 *
 * This is the canonical merge order used by `/makes` and `/models/:make`
 * by default — the wizard never has to opt-in to it. The `?strict=1`
 * query opt-out returns curated-only for callers (BO export, fixtures,
 * etc.) that need the high-trust subset.
 */
function mergeCuratedFirst(curated: Option[], upstream: Option[]): Option[] {
  const seen = new Set<string>();
  const out: Option[] = [];
  for (const o of curated) {
    const v = String(o?.value || '').trim();
    if (!v) continue;
    const key = v.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ value: v, label: o.label || v });
  }
  const upstreamSorted = upstream
    .map((o) => ({ value: String(o?.value || '').trim(), label: o.label || String(o?.value || '').trim() }))
    .filter((o) => o.value.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
  for (const o of upstreamSorted) {
    const key = o.value.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}

function normalizeMakeKey(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const up = raw.toUpperCase();
  const asciiish = up.normalize('NFD').replace(/\p{Diacritic}+/gu, '');
  return EU_MAKE_ALIASES[asciiish] || asciiish;
}

async function recordSuggestion(payload: Record<string, unknown>): Promise<void> {
  try {
    const dir = join(process.cwd(), 'server', 'data');
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), ...payload }) + '\n';
    await appendFile(join(dir, 'vehicle_suggestions.ndjson'), line, { encoding: 'utf8' });
  } catch {
    // suggestions should never break quote flow
  }
}

/**
 * Register the public-vehicles routes on a caller-supplied router.
 * Splitting registration from instantiation lets tests drive the
 * routes via a fake router (the same pattern used by
 * `registerPolicyEndorsementRoutes`) without poking at the
 * private Express router stack via untyped property access.
 */
export function registerPublicVehiclesRoutes(
  router: express.Router,
  { authenticate, requireBO }: PublicVehiclesRouterDeps,
) {

  router.get('/makes', async (req, res) => {
  try {
    metrics.makesCalls += 1;
    const now = Date.now();
    // `?strict=1` returns curated-only (BO/exports/fixtures). Default
    // is curated + vPIC merged with curated pinned at the top.
    // `?includeUpstream=0` is an explicit override to skip vPIC even
    // outside strict mode (kept for parity with the prior callers).
    const strict = String(req.query.strict || '') === '1';
    const includeUpstream = strict ? false : String(req.query.includeUpstream ?? '1') !== '0';

    const cacheKey = strict ? 'strict' : (includeUpstream ? 'merged' : 'curated');
    if (makesCache.data.length > 0 && makesCache.key === cacheKey && now - makesCache.at < MAKES_TTL_MS) {
      return res.json({ success: true, data: makesCache.data });
    }

    const curatedSorted = uniqSorted(EU_POPULAR_MAKES);

    if (!includeUpstream) {
      makesCache.at = now;
      makesCache.key = cacheKey;
      makesCache.data = curatedSorted;
      return res.json({ success: true, data: curatedSorted });
    }

    const resp = await fetch(`${VPIC_BASE}/getallmakes?format=json`);
    metrics.upstreamCalls += 1;
    metrics.estimatedCostEur += Number(process.env.CAR_API_COST_PER_CALL_EUR || 0);
    if (!resp.ok) {
      metrics.upstreamFailures += 1;
      makesCache.at = now;
      makesCache.key = cacheKey;
      makesCache.data = curatedSorted;
      return res.json({ success: true, data: curatedSorted, warning: { code: 'UPSTREAM_ERROR', message: `vPIC HTTP ${resp.status}` } });
    }

    const json = (await resp.json()) as { Results?: unknown };
    const results = Array.isArray(json.Results) ? (json.Results as VpicMakeResult[]) : [];
    const upstream: Option[] = results
      .map((m) => String(m?.Make_Name || '').trim())
      .filter(Boolean)
      .map((name) => ({ value: name, label: name }));

    // Curated pinned to the top in declaration order; vPIC entries
    // appended alphabetically with case-insensitive de-dup.
    const merged = mergeCuratedFirst(EU_POPULAR_MAKES, upstream);
    makesCache.at = now;
    makesCache.key = cacheKey;
    makesCache.data = merged;
    return res.json({ success: true, data: merged });
  } catch (e: unknown) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: errorMessage(e, 'Failed to load makes') } });
  }
  });

  router.get('/models/:make', async (req, res) => {
  try {
    metrics.modelsCalls += 1;
    const make = String(req.params.make || '').trim();
    if (!make) return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Missing make' } });

    const key = normalizeMakeKey(make);
    const now = Date.now();
    // Same merge contract as /makes: default merges curated + vPIC,
    // `?strict=1` returns curated-only.
    const strict = String(req.query.strict || '') === '1';
    const cacheKey = strict ? `${key}__strict` : key;
    const cached = modelsCache.get(cacheKey);
    if (cached && now - cached.at < MODELS_TTL_MS) {
      return res.json({ success: true, data: cached.data });
    }

    const curated = EU_POPULAR_MODELS[key] || [];

    if (strict) {
      const sorted = uniqSorted(curated);
      modelsCache.set(cacheKey, { at: now, data: sorted });
      return res.json({ success: true, data: sorted });
    }

    const encodedMake = encodeURIComponent(make);
    const resp = await fetch(`${VPIC_BASE}/getmodelsformake/${encodedMake}?format=json`);
    metrics.upstreamCalls += 1;
    metrics.estimatedCostEur += Number(process.env.CAR_API_COST_PER_CALL_EUR || 0);
    if (!resp.ok) {
      metrics.upstreamFailures += 1;
      // If vPIC is down, fall back to curated-only rather than 502 —
      // keeps the wizard usable for the curated makes (which is most
      // EU traffic) while observability surfaces the upstream failure.
      const sorted = uniqSorted(curated);
      modelsCache.set(cacheKey, { at: now, data: sorted });
      return res.json({ success: true, data: sorted, warning: { code: 'UPSTREAM_ERROR', message: `vPIC HTTP ${resp.status}` } });
    }

    const json = (await resp.json()) as { Results?: unknown };
    const results = Array.isArray(json.Results) ? (json.Results as VpicModelResult[]) : [];
    const upstream: Option[] = results
      .map((m) => String(m?.Model_Name || '').trim())
      .filter(Boolean)
      .map((name) => ({ value: name, label: name }));

    const merged = mergeCuratedFirst(curated, upstream);
    modelsCache.set(cacheKey, { at: now, data: merged });
    return res.json({ success: true, data: merged });
  } catch (e: unknown) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: errorMessage(e, 'Failed to load models') } });
  }
  });

  router.post('/suggest', async (req, res) => {
  const parsed = SuggestBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: parsed.error.issues[0]?.message || 'Invalid request body' } });
  }
  const make = String(parsed.data.make || '').trim();
  const model = String(parsed.data.model || '').trim();
  const trim = String(parsed.data.trim || '').trim();
  // VINs are alphanumeric and case-insensitive on the wire — normalise to
  // upper case so the local NDJSON record, the outbox envelope, and the
  // CarDog email all carry the same canonical form.
  const vin = String(parsed.data.vin || '').trim().toUpperCase();
  const note = String(parsed.data.note || '').trim();
  const source = String(parsed.data.source || '').trim();
  const publicSessionId = String(parsed.data.publicSessionId || '').trim();
  const policyId = String(parsed.data.policyId || '').trim();
  if (!make && !model) return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Provide make and/or model' } });

  await recordSuggestion({
    kind: 'vehicle_suggestion',
    make,
    makeKey: normalizeMakeKey(make),
    model,
    trim: trim || undefined,
    vin: vin || undefined,
    note: note || undefined,
    source: source || undefined,
    publicSessionId: publicSessionId || undefined,
    policyId: policyId || undefined,
    ua: String(req.headers['user-agent'] || ''),
    ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''),
  });

  // ABY-275 / ABY-274 — when both make AND model are provided, fire an
  // EMAIL.CARDOG_MODEL_SUGGESTION outbox event so Sam at CarDog (and
  // FacioMGA's uriel/yuval as cc) get notified that the catalog is
  // missing a row. The customer/underwriter has already been unblocked
  // upstream by the manual-entry UI; this email closes the loop with
  // CarDog so the next person doesn't hit the same gap.
  //
  // We outbox it (canonical envelope per ADR-0013) instead of calling
  // SendGrid synchronously inside the HTTP request because:
  //   1. the wizard's `suggestVehicle` is fire-and-forget and must
  //      never block the customer;
  //   2. the SMTP/SendGrid round-trip is an outbound-HTTP boundary
  //      that belongs in a worker, not an HTTP handler (per
  //      `events-and-projections.md` "Synchronous slow side effects in
  //      HTTP handlers ... Enqueue them.");
  //   3. retries / exhausted-event observability are handled by the
  //      relay + EMAIL.CARDOG_MODEL_SUGGESTION worker.
  if (make && model) {
    try {
      const envelope = buildDomainEvent({
        eventType: 'EMAIL.CARDOG_MODEL_SUGGESTION',
        aggregateType: 'POLICY',
        aggregateId: policyId || publicSessionId || `cardog-suggestion-${Date.now()}`,
        aggregateVersion: Date.now(),
        actorType: 'CUSTOMER',
        actorId: publicSessionId || 'public-wizard',
        reasonCode: 'CARDOG_CATALOG_GAP',
        data: {
          make,
          model,
          ...(trim ? { trim } : {}),
          ...(vin ? { vin } : {}),
          ...(note ? { note } : {}),
          ...(source ? { source } : {}),
          ...(publicSessionId ? { publicSessionId } : {}),
          ...(policyId ? { policyId } : {}),
        },
      });
      const outboxData: Prisma.OutboxUncheckedCreateInput = {
        operatingTenantId: getTenantConfig().id,
        eventType: envelope.eventType,
        aggregateId: envelope.aggregateId,
        payload: envelope as Prisma.InputJsonValue,
      };
      await tenantScopedPrisma.outbox.create({ data: outboxData });
    } catch (err) {
      // Suggestions must never break the quote / underwriting flow.
      // The local NDJSON file (recordSuggestion above) remains the
      // durable record for ops to recover from if Sam's email is
      // ever lost; this catch only guards against outbox/DB
      // transient failures.
      logger.warn({
        event: 'cardog_suggestion.outbox_enqueue_failed',
        err,
        make,
        model,
      }, 'cardog_suggestion.outbox_enqueue_failed');
    }
  }

  return res.json({ success: true });
  });

  router.use('/admin', authenticate, requireBO);

  router.get('/admin/metrics', async (_req, res) => {
  const admin = await loadVehicleApiAdmin();
  const totalCalls = metrics.makesCalls + metrics.modelsCalls;
  const successRate = metrics.upstreamCalls > 0 ? (metrics.upstreamCalls - metrics.upstreamFailures) / metrics.upstreamCalls : 1;
  return res.json({
    success: true,
    data: {
      payer: admin.payer,
      totalCalls,
      makesCalls: metrics.makesCalls,
      modelsCalls: metrics.modelsCalls,
      upstreamCalls: metrics.upstreamCalls,
      upstreamFailures: metrics.upstreamFailures,
      successRate,
      estimatedCostEur: Math.round(metrics.estimatedCostEur * 100) / 100,
      cache: {
        makesTtlMs: MAKES_TTL_MS,
        modelsTtlMs: MODELS_TTL_MS,
      },
    },
  });
  });

  router.post('/admin/payer', async (req, res) => {
  const parsed = AdminPayerBodySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'payer must be peter or insurer', details: parsed.error.flatten() },
    });
  }
  const payer = parsed.data.payer;
  await saveVehicleApiAdmin({ payer: payer as 'peter' | 'insurer' });
  return res.json({ success: true, data: { payer } });
  });
}

export function createPublicVehiclesRouter(deps: PublicVehiclesRouterDeps) {
  const router = express.Router();
  registerPublicVehiclesRoutes(router, deps);
  return router;
}

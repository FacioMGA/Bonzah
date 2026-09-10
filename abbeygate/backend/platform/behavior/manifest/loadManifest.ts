/**
 * Behavior Manifest loader.
 *
 * The manifest is the *only* place that maps raw outbox/domain events into
 * the semantic vocabulary the Trajectory layer reasons over. Add a new line
 * here, do nothing else, and the entire stack (events, embeddings,
 * direction classifier UX) absorbs the new behavior.
 *
 * The matching is intentionally tiny:
 *   - exact `eventType`
 *   - optional `to` (lifecycle status target) for STATUS_CHANGED-style events
 *
 * Anything more complex belongs in code, not data — it is a smell that the
 * underlying domain event isn't carrying the right shape yet.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ManifestMatch = {
  eventType: string;
  to?: string;
};

export type ManifestEntry = {
  match: ManifestMatch;
  behaviorType: string;
  template: string;
};

export type BehaviorManifest = {
  version: number;
  entityType: 'POLICY';
  entries: ManifestEntry[];
};

/**
 * Behavior-layer view of an outbox/job payload before the canonical
 * `DomainEventEnvelope` is confirmed. `eventType` is optional because
 * `job.data` is `unknown` at the worker boundary (ABBEYGATE-1Q).
 */
export type DomainEventLike = {
  eventType?: string;
  aggregateId?: string;
  aggregateType?: string;
  to?: string;
  data?: unknown;
};

type LooseEventFields = {
  eventType?: unknown;
  aggregateId?: unknown;
  aggregateType?: unknown;
  to?: unknown;
  data?: unknown;
};

export function readDomainEventLike(value: unknown): DomainEventLike | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as LooseEventFields;
  return {
    eventType: typeof rec.eventType === 'string' ? rec.eventType : undefined,
    aggregateId: typeof rec.aggregateId === 'string' ? rec.aggregateId : undefined,
    aggregateType: typeof rec.aggregateType === 'string' ? rec.aggregateType : undefined,
    to: typeof rec.to === 'string' ? rec.to : undefined,
    data: rec.data,
  };
}

let cached: BehaviorManifest | null = null;

function manifestPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, 'policyBehaviorManifest.json');
}

export function loadPolicyBehaviorManifest(): BehaviorManifest {
  if (cached) return cached;
  const raw = readFileSync(manifestPath(), 'utf8');
  const parsed = JSON.parse(raw) as BehaviorManifest;
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error('policyBehaviorManifest.json is malformed: missing entries[]');
  }
  cached = parsed;
  return parsed;
}

/**
 * Match an outbox event payload to a manifest entry.
 *
 * Returns `null` for unknown event types — the caller should treat that as
 * "not behavior-bearing" and skip it. We never invent canonical text for
 * events we do not understand; silence is safer than noise here.
 */
export function matchManifestEntry(event: DomainEventLike): ManifestEntry | null {
  const manifest = loadPolicyBehaviorManifest();
  for (const entry of manifest.entries) {
    if (entry.match.eventType !== event.eventType) continue;
    if (entry.match.to) {
      const to = String(event.to || '').trim().toUpperCase();
      if (to !== entry.match.to.toUpperCase()) continue;
    }
    return entry;
  }
  return null;
}

/**
 * Resolve the POLICY entityId an event targets, if any. Returns null when
 * the event isn't policy-bearing (e.g. RISK_TRANSACTION events without a
 * carried policyId).
 */
export function resolvePolicyEntityId(event: DomainEventLike): string | null {
  if (event.aggregateType === 'POLICY' || (!event.aggregateType && event.eventType?.startsWith('POLICY.'))) {
    return event.aggregateId?.trim() || null;
  }
  // Carried policyId in `data` — used by PAYMENT.* and RISK_TRANSACTION.*.
  const data = event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};
  const carried = String(data.policyId || '').trim();
  return carried || null;
}

/** Test-only: clear the in-memory cache. */
export function __resetManifestCacheForTests(): void {
  cached = null;
}

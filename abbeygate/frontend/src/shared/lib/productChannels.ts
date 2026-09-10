import { useEffect, useState } from 'react';
import { parseUser, isInternalRole } from '@/src/modules/auth/session';

/**
 * Frontend projection of the per-tenant product channel switches (ADR-0046).
 *
 * The backend is authoritative and enforces these gates at the session / rate /
 * checkout endpoints; this module reads `GET /api/public/product-channels` so
 * public surfaces can hide gated steps and show a referral completion. A
 * logged-in Back Office user bypasses every gate (mirrors the server bypass).
 */

type ProductChannel = {
  questions: boolean;
  quote: boolean;
  payment: boolean;
};

export type ProductChannelMap = Record<string, ProductChannel>;

const ALL_ON: ProductChannel = { questions: true, quote: true, payment: true };

let cache: ProductChannelMap | null = null;
let inflight: Promise<ProductChannelMap> | null = null;

/** True when the browser holds a logged-in Back Office (internal) session. */
export function isAdminSession(): boolean {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem('user_info') : null;
    if (!raw) return false;
    const user = parseUser(JSON.parse(raw));
    return isInternalRole(user?.role);
  } catch {
    return false;
  }
}

/** Fetch (and cache) the channel projection for the operating tenant. */
async function fetchProductChannels(): Promise<ProductChannelMap> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = fetch('/api/public/product-channels', { headers: { Accept: 'application/json' } })
    .then(async (res) => {
      const json = (await res.json().catch(() => null)) as { success?: boolean; data?: ProductChannelMap } | null;
      const data = json && json.success && json.data ? json.data : {};
      cache = data;
      return data;
    })
    .catch((): ProductChannelMap => ({}))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Resolve the effective channel for a product slug. Unknown slugs and the
 * loading window default to all-on so we never hide a step before we know;
 * admins always get all-on. The authoritative gate is server-side.
 */
function effectiveChannel(map: ProductChannelMap | null, slug: string): ProductChannel | null {
  if (isAdminSession()) return ALL_ON;
  if (!map) return null;
  return map[slug] ?? ALL_ON;
}

type UseProductChannelResult = {
  channel: ProductChannel | null;
  loading: boolean;
  isAdmin: boolean;
};

/** React hook: effective channel for a single product slug (admin-aware). */
export function useProductChannel(slug: string): UseProductChannelResult {
  const isAdmin = isAdminSession();
  const [map, setMap] = useState<ProductChannelMap | null>(cache);
  const [loading, setLoading] = useState<boolean>(!cache && !isAdmin);

  useEffect(() => {
    if (isAdmin) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(!cache);
    fetchProductChannels().then((next) => {
      if (cancelled) return;
      setMap(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, isAdmin]);

  return { channel: effectiveChannel(map, slug), loading, isAdmin };
}

/** React hook: the full effective channel map (admin-aware). */
export function useProductChannels(): { map: ProductChannelMap | null; loading: boolean; isAdmin: boolean } {
  const isAdmin = isAdminSession();
  const [map, setMap] = useState<ProductChannelMap | null>(cache);
  const [loading, setLoading] = useState<boolean>(!cache && !isAdmin);

  useEffect(() => {
    if (isAdmin) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(!cache);
    fetchProductChannels().then((next) => {
      if (cancelled) return;
      setMap(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  return { map, loading, isAdmin };
}

/**
 * Whether a product slug should be offered for online entry (questionnaire).
 * Admins always; otherwise requires `questions` ON. Defaults to true while the
 * map is still loading or the slug is unknown.
 */
export function isProductOnlineEntryAllowed(map: ProductChannelMap | null, slug: string, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  if (!map) return true;
  const channel = map[slug];
  if (!channel) return true;
  return channel.questions;
}

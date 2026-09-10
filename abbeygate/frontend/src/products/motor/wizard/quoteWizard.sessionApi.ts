import { buildPublicSessionUrl } from '@/src/shared/lib/wizard/buildPublicSessionUrl';
import type { PublicSessionApiResponse } from './quoteWizard.domain';

const publicSessionLoadInFlight = new Map<string, Promise<{ ok: boolean; json: PublicSessionApiResponse | null }>>();
const publicSessionRecent = new Map<string, { atMs: number; value: { ok: boolean; json: PublicSessionApiResponse | null } }>();
const PUBLIC_SESSION_RECENT_TTL_MS = 1500;

export async function fetchPublicSessionOnce(policyId: string): Promise<{ ok: boolean; json: PublicSessionApiResponse | null }> {
  const key = String(policyId || '').trim();
  if (!key) return { ok: false, json: null };

  const now = Date.now();
  const recent = publicSessionRecent.get(key);
  if (recent && now - recent.atMs <= PUBLIC_SESSION_RECENT_TTL_MS) {
    return recent.value;
  }

  const existing = publicSessionLoadInFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    const res = await fetch(buildPublicSessionUrl('motor', key));
    const json = (await res.json().catch(() => null)) as PublicSessionApiResponse | null;
    const value = { ok: res.ok, json };
    publicSessionRecent.set(key, { atMs: Date.now(), value });
    return value;
  })();

  publicSessionLoadInFlight.set(key, request);
  try {
    return await request;
  } finally {
    publicSessionLoadInFlight.delete(key);
  }
}

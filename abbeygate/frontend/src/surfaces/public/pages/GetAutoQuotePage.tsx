import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { logger } from '@/src/shared/lib/logger';
import { buildPublicSessionCreateUrl } from '@/src/shared/lib/wizard/buildPublicSessionUrl';

type CreateSessionResponse = {
  success?: boolean;
  data?: { publicSessionToken?: string; policyId?: string };
  error?: { message?: string } | string;
};

type SessionResult = { ok: boolean; json: CreateSessionResponse | null };

const createSessionInFlight = new Map<string, Promise<SessionResult>>();
const createSessionRecent = new Map<string, { atMs: number; value: SessionResult }>();
const CREATE_SESSION_RECENT_TTL_MS = 1500;

export function __resetMotorQuoteSessionCreateCacheForTests(): void {
  createSessionInFlight.clear();
  createSessionRecent.clear();
}

function normalizeVehicleTypeUrlValue(value: unknown): string {
  const raw = String(value || '').trim();
  const key = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (key === 'car' || key === 'motor') return 'Car';
  if (key === 'motorbike' || key === 'motorcycle' || key === 'bike') return 'Motorbike';
  if (key === 'motorcaravan' || key === 'motor caravan' || key === 'caravan' || key === 'motorhome') return 'Motorcaravan';
  if (key === 'van' || key === 'van to 3.5 tons' || key === 'van to 3 5 tons') return 'Van to 3.5 tons';
  return '';
}

function vehicleTypeFromUrl(): string {
  if (typeof window === 'undefined') return '';
  const value = String(new URL(window.location.href).searchParams.get('vehicleType') || '').trim();
  return normalizeVehicleTypeUrlValue(value);
}

async function createQuoteSessionOnce(vehicleType: string): Promise<SessionResult> {
  const key = `public-motor-session:create:${vehicleType || 'default'}`;
  const now = Date.now();
  const recent = createSessionRecent.get(key);
  if (recent && now - recent.atMs <= CREATE_SESSION_RECENT_TTL_MS) {
    return recent.value;
  }

  const existing = createSessionInFlight.get(key);
  if (existing) return await existing;

  const request = (async () => {
    const res = await fetch(buildPublicSessionCreateUrl('motor'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vehicleType ? { vehicleType } : {}),
    });
    const json = await res.json().catch(() => null);
    const value = { ok: res.ok, json };
    createSessionRecent.set(key, { atMs: Date.now(), value });
    return value;
  })();

  createSessionInFlight.set(key, request);
  try {
    return await request;
  } finally {
    createSessionInFlight.delete(key);
  }
}

export default function GetAutoQuotePage() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function go() {
      const requestedVehicleType = vehicleTypeFromUrl();
      const { ok, json } = await createQuoteSessionOnce(requestedVehicleType);
      const resOk = Boolean(ok);
      const errorMessage = typeof json?.error === 'string' ? json.error : json?.error?.message;
      if (!resOk || !json?.success) {
        throw new Error(errorMessage || 'Failed to create quote session');
      }

      // In production, public endpoints require the opaque `publicSessionToken` (not the UUID policyId).
      const publicId = json?.data?.publicSessionToken || json?.data?.policyId;
      if (!publicId) throw new Error('Missing public session id from session creation');

      if (!cancelled) {
        navigate(`/quote/${publicId}?product=motor&step=policy-holder`, { replace: true });
      }
    }

    go().catch((e) => {
      logger.error('[GetAutoQuote] Failed', e);
      // Fallback: keep the user on the page; they can refresh
    });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-canvas text-slate-700">
      <div className="ui-card ui-card-pad max-w-lg w-full text-center">
        <div className="text-sm font-black text-slate-900">Starting your quote…</div>
        <div className="text-xs text-slate-500 mt-2">Please wait</div>
      </div>
    </div>
  );
}

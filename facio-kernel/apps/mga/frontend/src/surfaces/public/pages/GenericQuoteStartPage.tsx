import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createSessionAdapter } from '@/src/shared/lib/wizard';
import {getSelectedTenant} from '@/src/shared/lib/tenant/runtimeProfile';
import { logger } from '@/src/shared/lib/logger';

/**
 * Generic starter page for any product's quote flow.
 *
 * Creates a public session via the shared session adapter and redirects to
 * `/quote/:publicId?product=<code>&step=<firstStep>`. The product-specific
 * wizard route adapter then takes over.
 *
 * Robustness notes:
 *   - React StrictMode (and React Fast Refresh) double-mounts the effect in
 *     development. Without a guard we fire two parallel POSTs and one can
 *     land a transient 500 under DB contention. We dedupe with a
 *     module-level single-flight cache keyed by productCode so the second
 *     mount reuses the first's in-flight promise.
 *   - Failures used to be swallowed into the logger, leaving users staring
 *     at a silent "Please wait" spinner. We now surface an explicit error
 *     message with a Try again button.
 */

type CreateResult = { ok: boolean; publicId: string | null; error?: string };
type CreateSeed = { quoteData?: { [key: string]: unknown }; vehicleType?: string };

// Module-level single-flight cache so StrictMode double-mounts don't cause
// duplicate session creates. Cleared when the request settles (success or
// failure) so a user retry can always re-attempt.
const inFlight = new Map<string, Promise<CreateResult>>();

function normalizeMotorVehicleTypeUrlValue(value: unknown): string {
  const raw = String(value || '').trim();
  const key = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (key === 'car' || key === 'motor') return 'Car';
  if (key === 'motorbike' || key === 'motorcycle' || key === 'bike') return 'Motorbike';
  if (key === 'motorcaravan' || key === 'motor caravan' || key === 'caravan' || key === 'motorhome') return 'Motorcaravan';
  if (key === 'van' || key === 'van to 3.5 tons' || key === 'van to 3 5 tons') return 'Van to 3.5 tons';
  return '';
}

function createSeedForProduct(productCode: string): CreateSeed | undefined {
  if (typeof window === 'undefined') return undefined;
  const code = String(productCode || '').toLowerCase().trim();
  const params = new URL(window.location.href).searchParams;
  if (code === 'motor') {
    const vehicleType = normalizeMotorVehicleTypeUrlValue(params.get('vehicleType'));
    return vehicleType ? { vehicleType } : undefined;
  }
  if (code === 'rental') {
    const stateCodes: Record<string, string> = { california: 'CA', colorado: 'CO', 'new york': 'NY' };
    const state = (value: string | null, fallback: string) => {
      const normalized = String(value || '').trim();
      return stateCodes[normalized.toLowerCase()] || (normalized.length === 2 ? normalized.toUpperCase() : fallback);
    };
    const pickupState = state(params.get('pickupState'), 'CO');
    const residenceState = state(params.get('residenceState'), 'CA');
    const tripStart = String(params.get('tripStart') || '').trim();
    const tripEnd = String(params.get('tripEnd') || '').trim();
    const pickupTime = String(params.get('pickupTime') || '10:00').trim();
    const dropoffTime = String(params.get('dropoffTime') || '10:00').trim();
    const driverAge = Math.max(21, Number(params.get('driverAge') || 35));
    if (!tripStart || !tripEnd) return undefined;
    return {
      quoteData: {
        programId: 'BONZAH-US-FOUNDATION-2026',
        channel: 'WEB',
        effectiveDate: tripStart,
        risk: {
          pickup: { country: 'US', state: pickupState, location: String(params.get('pickupLocation') || '').trim() },
          residence: { country: 'US', state: residenceState },
          rentalStart: `${tripStart}T${pickupTime}:00Z`,
          rentalEnd: `${tripEnd}T${dropoffTime}:00Z`,
          driver: { age: driverAge, licenceValid: true, additionalDriversListed: false },
          rentalUse: 'PERSONAL',
        },
        coverages: ['CDW'],
        source: { channel: String(params.get('source') || 'bonzah-direct'), partnerReference: String(params.get('partnerReference') || '') },
      },
    };
  }
  if (code !== 'health') return undefined;
  const plan = String(params.get('plan') || '').trim().toLowerCase();
  if (plan !== 'immigration') return undefined;
  return {
    quoteData: {
      plan: {
        code: 'immigration',
        label: 'Britt Immigration Health',
      },
    },
  };
}

function entryIntentFromUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const intent = String(new URL(window.location.href).searchParams.get('intent') || '').trim();
  return intent || undefined;
}

export function makeQuoteStartPage(productCode: string, firstStep: string) {
  const adapter = createSessionAdapter({ productCode });

  function requestCreate(seed?: CreateSeed): Promise<CreateResult> {
    const key = `${productCode}:${JSON.stringify(seed || {})}`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = adapter.create(seed)
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, promise);
    return promise;
  }

  return function QuoteStartPage() {
    const navigate = useNavigate();
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          setErrorMessage(null);
          const seed = createSeedForProduct(productCode);
          const { ok, publicId, error } = await requestCreate(seed);
          if (cancelled) return;
          if (!ok || !publicId) throw new Error(error || 'Failed to create session');
          const resolvedStep = productCode === 'rental' && !seed ? 'rental-search' : firstStep;
          const redirectParams = new URLSearchParams({ product: productCode, step: resolvedStep });
          const selectedTenant=getSelectedTenant();if(selectedTenant)redirectParams.set('workspace',selectedTenant.tenantSlug);
          const entryIntent = entryIntentFromUrl();
          if (entryIntent) redirectParams.set('intent', entryIntent);
          navigate(`/quote/${publicId}?${redirectParams.toString()}`, { replace: true });
        } catch (e) {
          logger.error(`[QuoteStart:${productCode}] failed`, e);
          if (!cancelled) {
            const message = e instanceof Error ? e.message : 'Failed to start your quote.';
            setErrorMessage(message);
          }
        }
      })();
      return () => { cancelled = true; };
    }, [navigate, attempt]);

    // Declared before any early return so the hook order stays stable
    // across renders (react-hooks/rules-of-hooks). Only consumed by the
    // error branch below.
    const handleRetry = useCallback(() => {
      for (const key of inFlight.keys()) {
        if (key.startsWith(`${productCode}:`)) inFlight.delete(key);
      }
      setAttempt((n) => n + 1);
    }, []);

    if (errorMessage) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-brand-canvas text-slate-700 px-6">
          <div className="ui-card ui-card-pad max-w-lg w-full text-center">
            <div className="text-sm font-black text-slate-900">We couldn't start your {productCode.toLowerCase()} quote</div>
            <div className="text-xs text-slate-500 mt-2">{errorMessage}</div>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-5 inline-flex items-center justify-center rounded-xl bg-brand-primary px-5 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:opacity-90"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-canvas text-slate-700">
        <div className="ui-card ui-card-pad max-w-lg w-full text-center">
          <div className="text-sm font-black text-slate-900">Starting your {productCode.toLowerCase()} quote…</div>
          <div className="text-xs text-slate-500 mt-2">Please wait</div>
        </div>
      </div>
    );
  };
}

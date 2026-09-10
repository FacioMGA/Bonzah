import { useEffect, useRef } from 'react';
import type { TravelAddonSelection } from './travelAddons';

// Args interface is intentionally module-private — the hook is the
// public surface. Promoting this to an exported type would only be
// noise on the ts-prune ledger until a real external consumer needs
// to spread/extend it.
interface UseTravelAddonAutoRateArgs {
  /**
   * The currently-selected addons map. The caller (TravelQuoteWizard)
   * is responsible for subscribing to RHF form changes via
   * `form.watch('addons')` so React re-renders whenever this value
   * changes — the hook itself stays RHF-free.
   */
  addons: TravelAddonSelection | undefined;
  /**
   * Live re-rates only fire AFTER the first quote has materialised;
   * pass `null` until the wizard has loaded or produced a quote.
   */
  quoteResponse: unknown;
  /** Invoked once the customer's addon selection settles. */
  runRate: () => Promise<boolean | void>;
  /** Debounce window in milliseconds. Defaults to 300ms. */
  debounceMs?: number;
}

/**
 * ABY-261 — Travel wizard "live re-rate on addon toggle" debouncer.
 *
 * Watches the current addons selection and invokes the supplied
 * `runRate` callback once the customer has stopped changing it for
 * `debounceMs` (default 300ms). Step 5's sidebar reads
 * `quoteResponse.primaryOption.annualPremium`, so the rate has to
 * fire the moment the selection changes — not when the customer
 * clicks Continue, which is too late and was the original ABY-261
 * customer complaint ("UI is stale, showing wrong premium").
 *
 * Why this is a hook (and not inlined into TravelQuoteWizard):
 *
 * The first attempt at this fix kept the code inline in
 * `TravelQuoteWizard` and wrapped the addons-key stringification in
 * `useMemo([form.watch('addons')])`. RHF mutates the `addons`
 * sub-object IN PLACE on `setValue('addons.<key>', …)`, so the
 * watched value's identity stayed stable across toggles, the memo
 * cached forever, the dependent effect never re-ran, and the
 * customer-facing Step 5 sidebar froze on the no-addon total while
 * "Added" lit up beside each addon — exactly Effie's report on
 * ABOLV1000101. Extracting into a hook (and decoupling it from RHF)
 * lets us pin the contract with a dedicated test
 * (`useTravelAddonAutoRate.test.tsx`) that fails the instant anybody
 * reintroduces a memo, an identity check, or any other ref-stability
 * assumption on the addons value.
 *
 * Contract guarantees:
 *
 *   1. The first non-null `quoteResponse` snapshots the current
 *      addons key without rating, so initial mount never fires a
 *      redundant second rate.
 *   2. Toggling an addon recomputes the key (recomputed inline every
 *      render — no memo), and the effect schedules a single
 *      trailing `runRate` call after the debounce window.
 *   3. Rapid toggles (e.g. business on → off → on) collapse into one
 *      trailing rate via the cleanup function cancelling the pending
 *      timer.
 *   4. Identical-value writes (the addons map is structurally
 *      unchanged) do NOT trigger a rate — the stringified key is
 *      unchanged.
 *   5. Concurrent rates are harmless: every rate persists its own
 *      fresh `quoteResponse` server-side, and the key stamped into
 *      the ref is the one we sent, so the next "did the customer
 *      change anything since the last rate I scheduled?" check stays
 *      accurate.
 *
 * Billing-integrity safety net lives at the CardCorp boundary
 * (`backend/modules/payments/app/cardcorpCheckoutService.ts` →
 * `ratePolicyAndPersist`) which ALWAYS re-rates immediately before
 * creating the checkout, so even a UI race can never charge a number
 * the customer did not see.
 */
export function useTravelAddonAutoRate(args: UseTravelAddonAutoRateArgs): void {
  const { addons, quoteResponse, runRate } = args;
  const debounceMs = args.debounceMs ?? 300;

  // Recompute inline on every render. JSON.stringify on a tiny object
  // is microseconds; this is deliberately NOT memoised — see the
  // docblock for the ref-stability foot-gun this avoids.
  const addonsKey = JSON.stringify(addons || {});

  const lastRatedAddonsKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!quoteResponse) return;
    if (lastRatedAddonsKeyRef.current === null) {
      lastRatedAddonsKeyRef.current = addonsKey;
      return;
    }
    if (lastRatedAddonsKeyRef.current === addonsKey) return;
    const keyAtSchedule = addonsKey;
    const handle = window.setTimeout(() => {
      lastRatedAddonsKeyRef.current = keyAtSchedule;
      void runRate();
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [addonsKey, quoteResponse, runRate, debounceMs]);
}

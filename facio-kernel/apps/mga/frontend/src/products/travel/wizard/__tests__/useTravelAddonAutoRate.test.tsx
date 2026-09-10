/* @vitest-environment happy-dom */
/**
 * ABY-261 regression — Travel wizard live re-rate on addon toggle.
 *
 * This test exists because of a real bug that shipped to UAT: the
 * first fix attempt wrapped the addons-key stringification in
 * `useMemo([form.watch('addons')])`. RHF mutates the `addons`
 * sub-object IN PLACE on `setValue('addons.<key>', …)`, so the
 * watched value's identity stayed stable across toggles, the memo
 * cached forever, the dependent effect never re-ran, and the
 * customer-facing Step 5 sidebar froze on the no-addon total while
 * "Added" lit up beside each addon — exactly Effie's report on
 * ABOLV1000101.
 *
 * Three assertions are intentional and pinned together:
 *
 *   1. A real addons-shape change DOES trigger `runRate` after the
 *      debounce. Failure here means the ref-stability foot-gun has
 *      returned (someone reintroduced `useMemo`/`React.memo`/an
 *      identity shortcut on the addons value).
 *
 *   2. Rapid toggles collapse into a single trailing rate. Failure
 *      here means the debounce cleanup is missing and we are
 *      hammering the server with one rate per keystroke.
 *
 *   3. A no-op render (same addons object, equal-by-value) does NOT
 *      trigger `runRate`. Failure here means a stale equality check
 *      would re-rate forever — wasted server work and a visible
 *      "Updating…" flicker on the sidebar for the user.
 *
 * The hook is the canonical location for this logic (extracted out
 * of the wizard for exactly this reason); the wizard's own
 * production code calls it directly, so anything that passes this
 * test passes for the user too. If someone inlines the watcher back
 * into the wizard, they have to inline this test alongside it, by
 * hand — that is the contract.
 *
 * Note that the hook is intentionally RHF-free (the wizard owns the
 * `form.watch('addons')` subscription and passes the value in), so
 * this test does not have to set up a React Hook Form — passing the
 * `addons` map as a prop and re-rendering with a new map mirrors
 * exactly what the wizard does.
 */
import { useState } from 'react';
import { render, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTravelAddonAutoRate } from '../useTravelAddonAutoRate';
import type { TravelAddonSelection } from '../travelAddons';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  vi.useRealTimers();
});

const EMPTY_ADDONS: TravelAddonSelection = {
  winterSports: false,
  businessCover: false,
  golfCover: false,
  terrorism: false,
  sportsEquipment: false,
  wedding: false,
  gadget: false,
};

interface HarnessProps {
  onRate: () => Promise<boolean>;
  exposeSetter: (setter: (next: TravelAddonSelection) => void) => void;
  initialAddons?: TravelAddonSelection;
  /** Pinned at 50ms so the suite is fast — production uses 300ms. */
  debounceMs?: number;
}

function Harness({ onRate, exposeSetter, initialAddons, debounceMs = 50 }: HarnessProps) {
  const [addons, setAddons] = useState<TravelAddonSelection>(initialAddons ?? EMPTY_ADDONS);
  // A non-null quoteResponse mirrors the wizard's gate: live re-rates
  // only fire AFTER the first quote has materialised (otherwise there
  // is nothing for the sidebar to be wrong about).
  const quoteResponse = { primaryOption: { annualPremium: 100 } };
  useTravelAddonAutoRate({ addons, quoteResponse, runRate: onRate, debounceMs });
  exposeSetter(setAddons);
  return null;
}

/**
 * Drive the debounce timer + flush microtasks (effect callbacks,
 * mock resolutions) so the assertion that follows can see the
 * trailing runRate. The pair has to be inside `act` so React
 * processes the scheduled work.
 */
async function advanceAndFlush(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe('useTravelAddonAutoRate — ABY-261 contract pins', () => {
  it('fires runRate exactly once after a real addon change settles inside the debounce window', async () => {
    const runRate = vi.fn().mockResolvedValue(true);
    let setAddons: (next: TravelAddonSelection) => void = () => {};

    render(<Harness onRate={runRate} exposeSetter={(s) => { setAddons = s; }} />);

    // Initial mount must NOT rate — the hook's first-quoteResponse
    // snapshot exists precisely to avoid a redundant boot-time rate.
    expect(runRate).not.toHaveBeenCalled();

    await act(async () => {
      setAddons({ ...EMPTY_ADDONS, golfCover: true });
    });
    await advanceAndFlush(100);

    expect(runRate, 'addon change did not trigger the debounced rate — has the useMemo/ref-stability foot-gun returned?')
      .toHaveBeenCalledTimes(1);
  });

  it('collapses rapid toggles into a single trailing-edge rate', async () => {
    const runRate = vi.fn().mockResolvedValue(true);
    let setAddons: (next: TravelAddonSelection) => void = () => {};

    render(<Harness onRate={runRate} exposeSetter={(s) => { setAddons = s; }} />);

    // Multiple rapid changes inside a single act so React batches them.
    await act(async () => {
      setAddons({ ...EMPTY_ADDONS, golfCover: true });
      setAddons({ ...EMPTY_ADDONS, golfCover: true, terrorism: true });
      setAddons({ ...EMPTY_ADDONS, golfCover: true, terrorism: true, sportsEquipment: true });
      setAddons({ ...EMPTY_ADDONS, terrorism: true, sportsEquipment: true });
    });
    await advanceAndFlush(100);

    expect(runRate, 'rapid changes should collapse into one trailing rate, not fan out into N')
      .toHaveBeenCalledTimes(1);
  });

  it('does NOT fire runRate for a re-render whose addons map is structurally identical', async () => {
    const runRate = vi.fn().mockResolvedValue(true);
    let setAddons: (next: TravelAddonSelection) => void = () => {};

    render(<Harness onRate={runRate} exposeSetter={(s) => { setAddons = s; }} />);

    await act(async () => {
      // Brand-new object reference but identical values — this is the
      // SAME shape the wizard sees when RHF re-emits the addons
      // object on an unrelated form change (e.g. proposer.firstName)
      // and should NOT cost a rate round-trip.
      setAddons({ ...EMPTY_ADDONS });
    });
    await advanceAndFlush(100);

    expect(runRate, 'a re-render that did not actually change the addons selection should never re-rate')
      .not.toHaveBeenCalled();
  });
});

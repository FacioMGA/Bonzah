import { describe, expect, it } from 'vitest';
import { ADDON_KEYS, loadBritTravelRates } from '../data/loader.js';

/**
 * Add-on data is JSON-driven per Andy 2026-05-16 (Updated BRIT Travel
 * Rates Excel, Sept 2025 active-sale). These tests pin the
 * canonical add-on values and the per-trip-type rule shape.
 */

describe('travel add-on data — Sept 2025 active-sale (Andy 2026-05-16)', () => {
  const addons = loadBritTravelRates().addons;
  it('loads addons block as part of the canonical rates payload', () => {
    const data = loadBritTravelRates();
    expect(data.addons).toBeDefined();
    expect(Object.keys(data.addons).sort()).toEqual([...ADDON_KEYS].sort());
  });

  it('Winter Sports — single-trip 100% load, multi-trip €50 per traveller', () => {
    const winter = addons.winterSports;
    expect(winter.singleTrip).toEqual({ kind: 'loadPercent', value: 1.0 });
    expect(winter.multiTrip).toEqual({ kind: 'perTraveller', value: 50 });
  });

  it('Business Cover — €20 per traveller (single + multi)', () => {
    const a = addons.businessCover;
    expect(a.singleTrip).toEqual({ kind: 'perTraveller', value: 20 });
    expect(a.multiTrip).toEqual({ kind: 'perTraveller', value: 20 });
  });

  it('Golf Cover — €10 per traveller (single + multi)', () => {
    const a = addons.golfCover;
    expect(a.singleTrip).toEqual({ kind: 'perTraveller', value: 10 });
    expect(a.multiTrip).toEqual({ kind: 'perTraveller', value: 10 });
  });

  it('Terrorism — €10 per traveller (single + multi)', () => {
    const a = addons.terrorism;
    expect(a.singleTrip).toEqual({ kind: 'perTraveller', value: 10 });
    expect(a.multiTrip).toEqual({ kind: 'perTraveller', value: 10 });
  });

  it('Sports / Cycle Equipment — €25 per traveller (single + multi)', () => {
    // Updated from previous 10% load to flat €25 per traveller.
    const a = addons.sportsEquipment;
    expect(a.singleTrip).toEqual({ kind: 'perTraveller', value: 25 });
    expect(a.multiTrip).toEqual({ kind: 'perTraveller', value: 25 });
  });

  it('Wedding — €20 per traveller (single + multi)', () => {
    // Updated from previous 15% load to flat €20 per traveller.
    const a = addons.wedding;
    expect(a.singleTrip).toEqual({ kind: 'perTraveller', value: 20 });
    expect(a.multiTrip).toEqual({ kind: 'perTraveller', value: 20 });
  });

  it('Gadget — single-trip €20 per traveller, multi-trip €40 per traveller', () => {
    // Updated from previous 10% load to per-trip-type flat fees.
    const a = addons.gadget;
    expect(a.singleTrip).toEqual({ kind: 'perTraveller', value: 20 });
    expect(a.multiTrip).toEqual({ kind: 'perTraveller', value: 40 });
  });
});

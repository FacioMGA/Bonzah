/**
 * ABY-278 — Marker.io report (Uriel, 2026-05-25): the public quote picker
 * at `/quote/start` (rendered by `frontend/src/surfaces/public/router.tsx`
 * → `QuoteProductPickerPage`) and the BO quote-entry tile (rendered by
 * `frontend/src/surfaces/client/components/ClientQuoteEntryPanel.tsx`)
 * both project `manifest.theme.segmentLabel` directly into the customer-
 * facing chip. The chip read "Health" while the rest of the manifest
 * (`displayName: 'Immigration Medical Insurance'`, `buildPrimary: () =>
 * 'Immigration Medical Insurance'`, the wizard hero "Your Immigration
 * Medical Cover", the policy-card subtitle "… · Immigration Medical")
 * already used the canonical product name.
 *
 * This test pins the canonical segmentLabel as "Immigration" so a future
 * refactor cannot regress to "Health" without a deliberate, traceable
 * test edit.
 */
import { describe, expect, it } from 'vitest';
import { healthManifest } from '../manifest';

describe('health manifest — theme.segmentLabel (ABY-278)', () => {
  it('uses "Immigration" so the public picker chip matches the canonical product name', () => {
    expect(healthManifest.theme.segmentLabel).toBe('Immigration');
  });

  it('keeps the long-form displayName unchanged (no surface drift)', () => {
    expect(healthManifest.displayName).toBe('Immigration Medical Insurance');
  });
});

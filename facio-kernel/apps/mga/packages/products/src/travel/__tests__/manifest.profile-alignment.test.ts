/**
 * Travel manifest ↔ travelValidationProfile alignment.
 *
 * Pins the resolution of two pre-consolidation bugs that were rooted in
 * silent drift between `travelManifest` and `travelValidationProfile`.
 *
 * Bug #2 — manifest references unknown profile paths
 * ----------------------------------------------------
 *   On save in the BO underwriting tab the policy form raised "ghost"
 *   required-field errors:
 *     • Medical notice acknowledgement: You must accept to continue
 *     • How to Claim / Complain / Privacy reviewed: You must accept to continue
 *     • Personal data consent: You must accept to continue
 *     • Contract consent: You must accept to continue
 *   …even when the wizard had already submitted those declarations.
 *
 *   Root cause: the manifest's `declarations` section listed the legacy
 *   names (`medicalConditionsNotice` / `dataConsent` / `paymentConsent`)
 *   while the Lloyd's-approved `travelValidationProfile` already
 *   validated the new names (`medicalNotice` / `howToClaimReview` /
 *   `personalDataConsent` / `contractConsent` / `contractAgreement`).
 *   The wizard emitted the new names, the BO tab read the manifest and
 *   asked the runner about the old names — runner could not find them
 *   on the saved policy snapshot, so the BO tab raised "missing
 *   required field" against fields that no longer existed.
 *
 *   This test enforces the inverse direction of
 *   `validation/__tests__/profile.canonical.test.ts` (which pins the
 *   profile's declaration shape): every required manifest path **and**
 *   every `requiredForUw` path **must** exist as a key in
 *   `travelValidationProfile.fields`. Adding a manifest path the
 *   profile does not validate fails CI before merge.
 *
 * Bug #1 — `trip.planType` was labeled "Plan"
 * --------------------------------------------
 *   The questionnaire already uses "Plan" to mean the Silver / Gold /
 *   Platinum tier (`quote.selectedPlan`). Reusing "Plan" for
 *   `trip.planType` (Single Trip vs Annual Multi-Trip) confused both
 *   the BO underwriting tab and the wizard — the rate snapshot modal
 *   showed two rows both labeled "Plan" with different values. The fix
 *   relabels `trip.planType` to "Trip type" everywhere it surfaces in
 *   the manifest while keeping `quote.selectedPlan` labeled "Plan".
 *   This test pins both halves of the rename.
 *
 * Scope
 * -----
 * Backend manifest only. The frontend manifest mirror (`frontend/src/
 * products/travel/manifest.ts`) carries the same paths and labels and
 * is consumed directly by the wizard's render layer; its alignment is
 * exercised end-to-end by the wizard step tests. Phase 4 (manifest
 * unification 6 → 3) will collapse FE+BE into a single manifest
 * source — at that point this test continues to pin the canonical
 * path automatically.
 */

import { describe, expect, it } from 'vitest';
import { TRAVEL_DESTINATION_AREAS } from '../destinations.js';
import { travelManifest } from '../manifest.js';
import { travelValidationProfile } from '../profile.js';

describe('travel manifest aligns with travelValidationProfile (Bug #2)', () => {
  const profilePaths = new Set(Object.keys(travelValidationProfile.fields));
  const manifestPaths = new Set(
    travelManifest.questionnaire.sections.flatMap((section) => section.fields.map((field) => field.path)),
  );

  it('every required questionnaire field path is registered on the validation profile', () => {
    const orphans: Array<{ path: string; where: string }> = [];

    for (const section of travelManifest.questionnaire.sections) {
      for (const field of section.fields) {
        if (!field.required) continue;
        if (!profilePaths.has(field.path)) {
          orphans.push({ path: field.path, where: `questionnaire.sections[${section.id}].fields` });
        }
      }
    }

    for (const r of travelManifest.riskModelHints.requiredForUw) {
      if (!profilePaths.has(r.path)) {
        orphans.push({ path: r.path, where: 'riskModelHints.requiredForUw' });
      }
    }

    expect(orphans).toEqual([]);
  });

  it('renders every required profile field that can block BO underwriting', () => {
    const missing = Object.entries(travelValidationProfile.fields)
      .filter(([, field]) => field.required === true && field.audience !== 'customer')
      .map(([path]) => path)
      .filter((path) => !manifestPaths.has(path));

    expect(missing).toEqual([]);
  });

  it('renders every lifecycle-stage field visible to BO underwriting', () => {
    const stageFields = [
      ...travelValidationProfile.stages.bind.fields,
      ...travelValidationProfile.stages.issuance.fields,
    ];
    const missing = Array.from(new Set(stageFields))
      .filter((path) => travelValidationProfile.fields[path]?.audience !== 'customer')
      .filter((path) => !manifestPaths.has(path));

    expect(missing).toEqual([]);
  });

  it('declarations section pins the Lloyd\'s-approved 5-path set in order', () => {
    const declarations = travelManifest.questionnaire.sections.find((s) => s.id === 'declarations');
    expect(declarations).toBeDefined();
    const paths = (declarations?.fields ?? []).map((f) => f.path);
    expect(paths).toEqual([
      'declarations.medicalNotice',
      'declarations.howToClaimReview',
      'declarations.personalDataConsent',
      'declarations.contractConsent',
      'declarations.contractAgreement',
    ]);
  });
});

describe('travel manifest disambiguates trip.planType from quote.selectedPlan (Bug #1)', () => {
  it('trip.planType is labeled "Trip type" in every manifest surface that exposes it', () => {
    const insuredField = travelManifest.insuredObject.fields.find((f) => f.path === 'trip.planType');
    expect(insuredField, 'insuredObject.fields[trip.planType]').toBeDefined();
    expect(insuredField?.label).toBe('Trip type');

    const tripDetails = travelManifest.questionnaire.sections.find((s) => s.id === 'trip-details');
    const sectionField = tripDetails?.fields.find((f) => f.path === 'trip.planType');
    expect(sectionField, 'questionnaire.sections[trip-details].fields[trip.planType]').toBeDefined();
    expect(sectionField?.label).toBe('Trip type');

    const requiredEntry = travelManifest.riskModelHints.requiredForUw.find((r) => r.path === 'trip.planType');
    expect(requiredEntry, 'riskModelHints.requiredForUw[trip.planType]').toBeDefined();
    expect(requiredEntry?.label).toBe('Trip type');

    const ratingEntry = travelManifest.riskModelHints.ratingInputs.find((r) => r.path === 'trip.planType');
    expect(ratingEntry, 'riskModelHints.ratingInputs[trip.planType]').toBeDefined();
    expect(ratingEntry?.label).toBe('Trip type');
  });

  it('quote.selectedPlan keeps the label "Plan" (Silver/Gold/Platinum tier — intentionally distinct)', () => {
    const tierEntry = travelManifest.riskModelHints.ratingInputs.find((r) => r.path === 'quote.selectedPlan');
    expect(tierEntry, 'riskModelHints.ratingInputs[quote.selectedPlan]').toBeDefined();
    expect(tierEntry?.label).toBe('Plan');

    const tierSection = travelManifest.questionnaire.sections.find((s) => s.id === 'quote');
    const tierField = tierSection?.fields.find((f) => f.path === 'quote.selectedPlan');
    expect(tierField, 'questionnaire.sections[quote].fields[quote.selectedPlan]').toBeDefined();
    expect(tierField?.label).toBe('Plan');
  });

  it('trip.destinations exposes the three canonical territory choices', () => {
    const expectedOptions = TRAVEL_DESTINATION_AREAS.map(({ value, label }) => ({ value, label }));
    const insuredField = travelManifest.insuredObject.fields.find((f) => f.path === 'trip.destinations');
    const tripDetails = travelManifest.questionnaire.sections.find((s) => s.id === 'trip-details');
    const sectionField = tripDetails?.fields.find((f) => f.path === 'trip.destinations');

    expect(insuredField?.options).toEqual(expectedOptions);
    expect(sectionField?.options).toEqual(expectedOptions);
  });
});

/**
 * Wizard ↔ rate-API contract test.
 *
 * Background (ABY-106): the customer wizard's per-step Zod tree
 * (`Step1Schema` / `Step2Schema` / `Step3Schema` in `../schemas/`) and
 * the canonical `ValidationProfile.stages.quote` field set
 * (`MOTOR_QUOTE_READY_FIELDS`, generated from the profile metadata) are
 * BOTH consulted on the rate path:
 *
 *   - Wizard "ready to rate?" check: previously called the local Zod
 *     schemas directly. Now (this commit) calls
 *     `validateForContext({ stage: { kind: 'stage', id: 'quote' } })`,
 *     i.e. the SAME canonical runner the backend uses — same source of
 *     truth, no parallel definition.
 *   - Backend rate API: calls `validateDraftQuote({ mode: 'quote' })`
 *     in `backend/modules/quotes/app/validatorImpl.ts`, which delegates
 *     to `validateForContext({ stage: 'quote', actor: 'server' })`.
 *
 * Drift between those two consumer paths produced ABY-106: the wizard
 * cleared all per-step refinements, the rate API rejected with
 * `INVALID_QUOTE_DATA` listing every required field, and the customer
 * was stuck.
 *
 * This test pins the invariant: if a customer fills the wizard such
 * that every per-step Zod refinement passes, then the canonical
 * `validateForContext({ stage: 'quote', actor: 'customer' })` MUST
 * also pass. The test fails the moment the per-step Zod tree diverges
 * from the canonical profile's `stages.quote.fields` set, so future
 * silent drift cannot reach `main`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ValidationRegistry, validateForContext } from '@facio/validation/frontend';
import { motorValidationProfile } from '../profile.js';
import {
  validateWizardDrivingHistoryStep,
  validateWizardPolicyHolderStep,
  validateWizardVehicleCoverStep,
} from '../schemas/index.js';

beforeAll(() => {
  // The runner throws on unregistered profiles (Wave-5 fail-loud). The FE
  // adapter normally registers products via `frontend/src/products/.../
  // register.ts` at module load; here we register motor explicitly so the
  // test stays isolated from the FE bundle wiring.
  ValidationRegistry.register(motorValidationProfile);
});

/**
 * Minimum data set that satisfies every per-step wizard refinement.
 *
 * Crafted to mirror what the wizard's RHF `setValue` would produce after
 * the customer has clicked Next on policy-holder, driving-history, and
 * vehicle-cover with no errors. Field names use the canonical
 * `proposer.*` / flat keys exactly as the profile declares them.
 */
const FULLY_FILLED_MOTOR_FIXTURE: Record<string, unknown> = {
  proposer: {
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: '1990-01-01',
    email: 'jane@example.com',
    phone: '+35799123456',
    nationality: 'Cyprus',
    occupation: 'Engineer',
    whereDidYouHear: 'Google',
    bestTimeToCall: 'Anytime',
    privacyPolicyAccepted: true,
    address: {
      line1: '123 Long Street',
      city: 'Limassol',
      province: 'Limassol',
      postcode: '3020',
      country: 'Cyprus',
    },
  },

  // Step 2 — driving history.
  licenseYears: 5,
  licenseType: 'Full',
  licenseIssuedIn: 'Cyprus',
  hasClaims: false,
  hasConvictions: false,
  // ABY-232 / ADR-0025: `driverRestriction` is canonical and required
  // from quote stage onward. POLICYHOLDER_ONLY is the no-additional-
  // drivers shape (equivalent to the pre-ABY-232 `hasAdditionalDrivers === false`).
  driverRestriction: 'POLICYHOLDER_ONLY',
  hasAdditionalDrivers: false,
  ncb: '5+ Years',

  // Step 3 — vehicle + cover.
  vehicleLocation: 'Cyprus',
  countryOfRegistration: 'Cyprus',
  registrationNumber: 'ABC123',
  vin: '',
  coverRequired: 'Comprehensive',
  vehicleType: 'Car',
  make: 'Toyota',
  model: 'Corolla',
  cabrio: 'No',
  parking: 'Drive',
  fuelType: 'Petrol',
  kmsPerYear: '10,000',
  year: 2020,
  numberOfSeats: 5,
  modified: false,
  engineSize: 1800,
  vehicleValue: 15000,
  vehicleUse: 'social',
  infoTrueAndAccurate: true,
  fairProcessingAccepted: true,
  motorcycleRidersNamed: true,
  additionalDrivers: [],
  // `renewalDate` must be within 45 days of today (per `validateWizard-
  // VehicleCoverStep`'s refinement). Stamp it 7 days out so the fixture
  // is always inside the window even when the test is replayed
  // tomorrow morning.
  renewalDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
};

describe('motor wizard ↔ rate-API contract (ABY-106)', () => {
  it('the fixture satisfies every per-step wizard refinement', () => {
    expect(validateWizardPolicyHolderStep(FULLY_FILLED_MOTOR_FIXTURE)).toEqual({});
    expect(validateWizardDrivingHistoryStep(FULLY_FILLED_MOTOR_FIXTURE)).toEqual({});
    expect(validateWizardVehicleCoverStep(FULLY_FILLED_MOTOR_FIXTURE)).toEqual({});
  });

  it('the same fixture satisfies the canonical stage:quote validation (customer)', () => {
    // SPINE: this is the EXACT call the wizard's pre-rate gate now makes
    // (`useQuoteWizardController.rateQuote`). If the per-step refinements
    // accept the data above but this call returns errors, the customer
    // would still hit `INVALID_QUOTE_DATA` from the rate API — i.e.
    // ABY-106 has reappeared. Failing this assertion forces whoever
    // adds a new required field at quote stage to ALSO add the matching
    // refinement / wizard control, instead of silently shifting the
    // contract under everyone.
    const errors = validateForContext({
      productCode: 'MOTOR',
      stage: { kind: 'stage', id: 'quote' },
      actor: 'customer',
      data: FULLY_FILLED_MOTOR_FIXTURE,
    });
    expect(errors).toEqual({});
  });

  it('the same fixture satisfies the canonical stage:quote validation (server)', () => {
    // The backend rate API uses `actor: 'server'`. Per
    // `validateForContext`'s actor-stage union (any actor's
    // `requiredAtByActor` entry counts for `server`), the server-side
    // required set is a superset of the customer-side set. We assert
    // BOTH sides accept the fixture so the wizard's "ready" verdict
    // matches what the rate API will see.
    const errors = validateForContext({
      productCode: 'MOTOR',
      stage: { kind: 'stage', id: 'quote' },
      actor: 'server',
      data: FULLY_FILLED_MOTOR_FIXTURE,
    });
    expect(errors).toEqual({});
  });

  it('proves the gate trips when a canonical-quote-required field is missing', () => {
    // Sanity: removing one canonical-quote-required field MUST surface
    // a per-field error from `validateForContext`. Without this, the
    // gate could be silently disabled (always returning `{}`) and the
    // contract test above would still pass.
    const broken: Record<string, unknown> = JSON.parse(JSON.stringify(FULLY_FILLED_MOTOR_FIXTURE));
    (broken.proposer as Record<string, unknown>).firstName = '';
    const errors = validateForContext({
      productCode: 'MOTOR',
      stage: { kind: 'stage', id: 'quote' },
      actor: 'customer',
      data: broken,
    });
    expect(errors['proposer.firstName']).toBeTruthy();
  });
});

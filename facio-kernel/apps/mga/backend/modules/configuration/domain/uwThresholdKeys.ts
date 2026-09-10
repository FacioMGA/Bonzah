/**
 * Hand-maintained mirror of the `MotorUwConfig.thresholds` key set.
 *
 * The canonical source lives in
 * `backend/products/motor/__fixtures__/motorUw.ts`
 * (`MOTOR_UW_CONFIG_FIXTURE.thresholds`). Importing that fixture from
 * production code outside the per-product engine zone is forbidden by
 * `tools/quality/check-product-engine-contract.mjs` (per the
 * canonical-ownership "Premium leaf" / leaf-isolation Lock G posture
 * extended to UW automation).
 *
 * Parity with the canonical set is enforced by a test under
 * `backend/modules/configuration/__tests__/uwThresholdKeys.parity.test.ts`
 * — test files are exempt from the product-engine-contract guard, so the
 * test imports the canonical set and asserts equality. When a new
 * threshold lands in `MotorUwConfig.thresholds`, the parity test fails
 * and forces this list to update — there is no silent drift path.
 */

export const KNOWN_MOTOR_UW_THRESHOLD_KEYS = new Set<string>([
    'declineVehicleValueOver',
    'declineGarageTotalValueOver',
    'declineClaimsCountOver5Years',
    'declineFaultClaimOver',
    'declineLicenceYearsUnder',
    'declineAddedDriverAgeUnder',
    'declineMotorcycleRiderAgeUnder',
    'declineMotorcycleOverCcRequiresNcdCc',
    'referralVehicleValueOver',
    'referralFaultClaimOver',
    'referralClaimsCountAtLeast',
    'referralClaimsTotalUnder',
    'referralAddedDriverAgeMin',
    'referralAddedDriverAgeMax',
    'referralMotorcaravanValueOver',
    'referralMotorcaravanKmsOver',
    'referralProposerAgeUnder',
    'referralStpAgeUnder',
    'referralStpLicenceYearsAtMost',
    'referralSeatsOver',
    'referralClassicVehicleValueOver',
    'referralSeriousTechnicalConvictionsAtLeast',
] as const);

export const KNOWN_MOTOR_UW_REFERRAL_FLAG_KEYS = new Set<string>([
    'referElectricVehicles',
    'referHybridVehicles',
    'referMotorcycle',
    'referMotorcaravan',
] as const);

/**
 * Historical Motor underwriting configuration used only by tests and local
 * development seeds. Live execution must obtain this component from the
 * mapped, published ProgrammeDefinition.
 */
export const MOTOR_UW_CONFIG_FIXTURE = {
  allowedRiskCountries: ['Cyprus', 'Portugal', 'Spain'],
  allowedVehicleUses: ['Private', 'SD&P', 'Class 1'],
  supportedVehicleTypeTokens: ['car', '4x4', 'mpv', 'motorbike', 'motorcycle', 'van', 'pickup', 'motorcaravan', 'motorhome', 'caravan', 'classic'],
  motorcycleAllowedVehicleUses: ['SD&P', 'Private'],
  motorcycleAllowedCoverRequired: ['Comprehensive'],
  motorcycleDisallowedDriverRestrictions: ['ANY_DRIVER_25_PLUS', 'ANY_DRIVER_40_PLUS'],
  referralFlags: {
    referElectricVehicles: true,
    referHybridVehicles: true,
    referMotorcycle: true,
    referMotorcaravan: true,
  },
  thresholds: {
    declineVehicleValueOver: 250_000,
    declineGarageTotalValueOver: 250_000,
    declineClaimsCountOver5Years: 3,
    declineFaultClaimOver: 100_000,
    declineLicenceYearsUnder: 1,
    declineAddedDriverAgeUnder: 21,
    declineMotorcycleRiderAgeUnder: 25,
    declineMotorcycleOverCcRequiresNcdCc: 200,
    referralVehicleValueOver: 80_000,
    referralFaultClaimOver: 50_000,
    referralClaimsCountAtLeast: 2,
    referralClaimsTotalUnder: 50_000,
    referralAddedDriverAgeMin: 22,
    referralAddedDriverAgeMax: 24,
    referralMotorcaravanValueOver: 30_000,
    referralMotorcaravanKmsOver: 30_000,
    referralProposerAgeUnder: 25,
    referralStpAgeUnder: 30,
    referralStpLicenceYearsAtMost: 2,
    referralSeatsOver: 15,
    referralClassicVehicleValueOver: 60_000,
    referralSeriousTechnicalConvictionsAtLeast: 2,
  },
};

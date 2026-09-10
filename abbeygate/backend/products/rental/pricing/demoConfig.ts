import type { RentalCoverageCode, RentalVehicleClass, RentalRepairProfile, RentalPowertrain } from '@facio/products';

export const BONZAH_DEMO_RULES = {
  version: 'bonzah-rental-foundation@2.0.0',
  effectiveDate: '2026-09-07',
  expiresInMinutes: 30,
  dataset: {
    version: 'bonzah-us-state-season-2026.1',
    geographicResolution: 'STATE_SEASON' as const,
    sources: {
      roadRisk: { name: 'NHTSA_FARS_FHWA_VMT' as const, version: 'FARS-2024_FHWA-VMT-2024', methodology: 'FATAL_CRASH_SEVERITY_PROXY' as const },
      weather: { name: 'NOAA_STORM_EVENTS' as const, version: 'NOAA-SED-1996-2025-v1' },
      theft: { name: 'NHTSA_VEHICLE_THEFT' as const, version: 'NHTSA-THEFT-2024-v1' },
    },
  },
  cdwBaseDailyByPickupState: { CO: 20, CA: 24, DEFAULT: 22 },
  rcliDailyByPickupState: { CO: 12, CA: 15, DEFAULT: 13 },
  sliDailyByPickupState: { CO: 9, CA: 11, DEFAULT: 10 },
  paiPeiDaily: 6,
  insuranceServiceFee: { amount: 4.95, label: 'Insurance service fee' },
  declaredValueFactors: [
    { max: 25_000, factor: 0.9, label: 'Up to $25,000' },
    { max: 40_000, factor: 1, label: '$25,001–$40,000' },
    { max: 60_000, factor: 1.15, label: '$40,001–$60,000' },
  ],
  repairFactors: { low: 0.9, standard: 1, high: 1.2 } satisfies Record<RentalRepairProfile, number>,
  classFactors: { compact: 0.95, sedan: 1, suv: 1.1 } satisfies Record<RentalVehicleClass, number>,
  powertrainFactors: { combustion: 1, hybrid: 1, ev: 1.1 } satisfies Record<RentalPowertrain, number>,
  roadRiskFactorsByState: { CA: 1.08, CO: 0.96, NY: 0.92 },
  seasonalWeatherFactorsByState: {
    CA: { WINTER: 1.02, SPRING: 0.98, SUMMER: 1, AUTUMN: 1.04 },
    CO: { WINTER: 1.12, SPRING: 1.04, SUMMER: 0.96, AUTUMN: 1 },
    NY: { WINTER: 1.1, SPRING: 1, SUMMER: 0.97, AUTUMN: 1.03 },
  },
  theftFactorsByVehicle: {
    'toyota|corolla': 0.98,
    'toyota|rav4': 1.02,
    'tesla|model 3': 0.92,
    'porsche|911 carrera': 1.2,
  },
  theftFallbackByClass: { compact: 0.98, sedan: 1, suv: 1.06 } satisfies Record<RentalVehicleClass, number>,
  rentalUseFactors: { PERSONAL: 1, COMMERCIAL: 1.35, RIDESHARE_OR_DELIVERY: 1.6 },
  multiplierFloor: 0.8,
  multiplierCap: 2,
  coverages: {
    CDW: { label: 'Collision Damage Waiver (CDW)', limit: 'Up to $35,000 damage', deductible: 'Up to $1,000', exclusions: 'Covers rental-vehicle damage from an accident with another vehicle. Excludes medical, PIP, UM/UIM, misuse, theft, vandalism, single-car accidents, prohibited use, cars for hire and delivery use.' },
    RCLI: { label: "Renter's Contingent Liability Insurance (RCLI)", limit: 'State minimum bodily injury and property damage', deductible: '$0', exclusions: 'Covers third-party injury and property damage when the renter is at fault. Does not cover the rental vehicle or occupants where prohibited; excludes medical, PIP, UM/UIM, commercial, cars-for-hire and delivery use.' },
    SLI: { label: 'Supplemental Liability Insurance (SLI)', limit: 'Up to $100,000 per person / $500,000 total / $10,000 property damage', deductible: '$0', exclusions: 'Excess liability coverage that requires RCLI. Does not cover rental-vehicle damage; excludes medical, PIP, UM/UIM, commercial, cars-for-hire and delivery use.' },
    PAI_PEI: { label: 'Personal Accident / Effects Protection (PAI/PEI)', limit: 'Renter life $50,000 · Passenger life $5,000 · Medical $1,000 · Effects $500', deductible: 'Not stated', exclusions: 'Covers accidental life, medical expenses and personal effects. It does not cover rental-vehicle damage.' },
  } satisfies Record<RentalCoverageCode, { label: string; limit: string; deductible: string; exclusions: string }>,
} as const;

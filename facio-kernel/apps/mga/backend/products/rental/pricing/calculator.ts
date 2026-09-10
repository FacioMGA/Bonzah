import { RENTAL_PROTECTION_PACKAGES, type RentalCoverageCode, type RentalCoverageDiscoveryRequest, type RentalCoverageDiscoveryResponse, type RentalCoveragePrice, type RentalDiscoveredCoverage, type RentalPricePreviewRequest, type RentalProtectionPackageCode, type RentalQuoteRequest, type RentalQuoteStatus, type RentalRatingFactor, type RentalRatingSourceSnapshot } from '@facio/products';
import { BONZAH_DEMO_RULES } from './demoConfig.js';

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const stateRate = (rates: Record<string, number>, state: string) => rates[state.toUpperCase()] ?? rates.DEFAULT;
type Season = 'WINTER' | 'SPRING' | 'SUMMER' | 'AUTUMN';
const seasonFor = (timestamp: number): Season => {
  const month = new Date(timestamp).getUTCMonth() + 1;
  if (month <= 2 || month === 12) return 'WINTER';
  if (month <= 5) return 'SPRING';
  if (month <= 8) return 'SUMMER';
  return 'AUTUMN';
};
const recordNumber = (record: object, key: string) => (record as Record<string, number>)[key];

export class RentalRatingError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export function calculateRentalRating(request: RentalQuoteRequest) {
  const start = Date.parse(request.risk.rentalStart);
  const end = Date.parse(request.risk.rentalEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new RentalRatingError('INVALID_RENTAL_PERIOD', 'Return must be after pickup.');
  const chargedPeriods = Math.ceil((end - start) / 86_400_000);
  if (chargedPeriods > 30) throw new RentalRatingError('RENTAL_PERIOD_TOO_LONG', 'The demo supports rental periods up to 30 days.');
  if (request.risk.driver.age < 21) throw new RentalRatingError('DRIVER_AGE', 'Drivers under 21 are not eligible in this demo.');
  if (!request.risk.driver.licenceValid) throw new RentalRatingError('LICENCE_INVALID', 'A valid driving licence is required.');
  if (request.coverages.includes('SLI') && !request.coverages.includes('RCLI')) throw new RentalRatingError('SLI_REQUIRES_RCLI', 'SLI requires RCLI.');
  const selectedPackage = request.packageCode ? RENTAL_PROTECTION_PACKAGES[request.packageCode] : undefined;
  if (selectedPackage && (selectedPackage.coverages.length !== request.coverages.length || selectedPackage.coverages.some((code) => !request.coverages.includes(code)))) {
    throw new RentalRatingError('PACKAGE_COVERAGE_MISMATCH', 'The selected package must use its configured coverages.');
  }

  const vehicle = request.risk.vehicle;
  const porsche = vehicle.make.toLowerCase() === 'porsche' && vehicle.model.toLowerCase().includes('911');
  const highValue = vehicle.declaredValue > 60_000;
  const state = request.risk.pickup.state.toUpperCase();
  const season = seasonFor(start);
  const roadRisk = recordNumber(BONZAH_DEMO_RULES.roadRiskFactorsByState, state);
  const weatherBySeason = (BONZAH_DEMO_RULES.seasonalWeatherFactorsByState as Record<string, Record<Season, number>>)[state];
  const weatherRisk = weatherBySeason?.[season];
  const environmentUnavailable = !Number.isFinite(roadRisk) || !Number.isFinite(weatherRisk);
  const referred = !porsche && (highValue || vehicle.model.toLowerCase().includes('trim pending') || environmentUnavailable);
  const excludedUse = request.risk.rentalUse !== 'PERSONAL';
  const status: RentalQuoteStatus = excludedUse || porsche ? 'DECLINED' : referred ? 'REFERRED' : 'QUOTED';
  const valueBand = BONZAH_DEMO_RULES.declaredValueFactors.find((band) => vehicle.declaredValue <= band.max);
  const valueFactor = valueBand?.factor ?? 1.15;
  const vehicleKey = `${vehicle.make.trim().toLowerCase()}|${vehicle.model.trim().toLowerCase()}`;
  const exactTheftFactor = recordNumber(BONZAH_DEMO_RULES.theftFactorsByVehicle, vehicleKey);
  const usedTheftFallback = !Number.isFinite(exactTheftFactor);
  const theftFactor = usedTheftFallback ? BONZAH_DEMO_RULES.theftFallbackByClass[vehicle.class] : exactTheftFactor;
  const vehicleFactors = {
    declaredValue: valueFactor,
    repairProfile: BONZAH_DEMO_RULES.repairFactors[vehicle.repairProfile],
    vehicleClass: BONZAH_DEMO_RULES.classFactors[vehicle.class],
    powertrain: BONZAH_DEMO_RULES.powertrainFactors[vehicle.powertrain],
    theft: theftFactor,
  };
  const rawMultiplier = Object.values(vehicleFactors).reduce((value, factor) => value * factor, 1);
  const vehicleMultiplier = Math.min(BONZAH_DEMO_RULES.multiplierCap, Math.max(BONZAH_DEMO_RULES.multiplierFloor, rawMultiplier));
  const useFactor = BONZAH_DEMO_RULES.rentalUseFactors[request.risk.rentalUse];
  const environmentMultiplier = (roadRisk || 1) * (weatherRisk || 1) * useFactor;
  const baseRates: Record<RentalCoverageCode, number> = {
    CDW: stateRate(BONZAH_DEMO_RULES.cdwBaseDailyByPickupState, request.risk.pickup.state),
    RCLI: stateRate(BONZAH_DEMO_RULES.rcliDailyByPickupState, request.risk.pickup.state),
    SLI: stateRate(BONZAH_DEMO_RULES.sliDailyByPickupState, request.risk.pickup.state),
    PAI_PEI: BONZAH_DEMO_RULES.paiPeiDaily,
  };
  const allCoverageCodes: RentalCoverageCode[] = ['CDW', 'RCLI', 'SLI', 'PAI_PEI'];
  const coveragePrices: RentalCoveragePrice[] = allCoverageCodes.map((code) => {
    const daily = code === 'CDW'
      ? money(baseRates.CDW * vehicleMultiplier * environmentMultiplier)
      : code === 'RCLI' || code === 'SLI'
        ? money(baseRates[code] * environmentMultiplier)
        : baseRates[code];
    const config = BONZAH_DEMO_RULES.coverages[code];
    return { code, label: config.label, selected: request.coverages.includes(code), dailyPrice: daily, tripPrice: money(daily * chargedPeriods), limit: config.limit, deductible: config.deductible, description: config.exclusions };
  });
  const subtotal = status === 'QUOTED' ? money(coveragePrices.filter((coverage) => coverage.selected).reduce((sum, coverage) => sum + coverage.tripPrice, 0)) : 0;
  const feeRule = BONZAH_DEMO_RULES.insuranceServiceFee;
  const fees = status === 'QUOTED' ? feeRule.amount : 0;
  const feeComponents = fees ? [{ code: 'INSURANCE_SERVICE_FEE' as const, label: feeRule.label, amount: fees }] : [];
  const ratingSource: RentalRatingSourceSnapshot = {
    datasetVersion: BONZAH_DEMO_RULES.dataset.version,
    effectiveDate: BONZAH_DEMO_RULES.effectiveDate,
    geographicResolution: BONZAH_DEMO_RULES.dataset.geographicResolution,
    sources: BONZAH_DEMO_RULES.dataset.sources,
    fallbacks: usedTheftFallback ? [{ factor: 'theft', from: vehicleKey, to: `class:${vehicle.class}`, reason: 'No approved exact-model theft factor was available.' }] : [],
  };
  const factors: RentalRatingFactor[] = [
    { code: 'DECLARED_VALUE', label: 'Vehicle value', value: valueFactor, appliesTo: ['CDW'], explanation: 'The replacement value changes the expected size of a rental-vehicle damage loss.' },
    { code: 'REPAIR_PROFILE', label: 'Repair cost', value: vehicleFactors.repairProfile, appliesTo: ['CDW'], explanation: 'Parts, labour and specialist repair requirements affect expected repair cost.' },
    { code: 'VEHICLE_CLASS', label: 'Vehicle class', value: vehicleFactors.vehicleClass, appliesTo: ['CDW'], explanation: 'Vehicle size and class affect typical damage cost.' },
    { code: 'POWERTRAIN', label: 'Powertrain', value: vehicleFactors.powertrain, appliesTo: ['CDW'], explanation: 'Powertrain-specific components can affect repair complexity.' },
    { code: 'THEFT', label: 'Vehicle theft exposure', value: theftFactor, appliesTo: ['CDW'], explanation: usedTheftFallback ? `An approved ${vehicle.class} class fallback was used.` : 'The approved make/model theft index was used.', sourceVersion: BONZAH_DEMO_RULES.dataset.sources.theft.version },
    { code: 'ROAD_RISK', label: 'Pickup-state road risk', value: roadRisk || 1, appliesTo: ['CDW', 'RCLI', 'SLI'], explanation: 'A fatal-crash severity proxy normalised by state vehicle miles travelled; it is not an all-crash frequency measure.', sourceVersion: BONZAH_DEMO_RULES.dataset.sources.roadRisk.version },
    { code: 'SEASONAL_WEATHER', label: `${season.toLowerCase()} weather exposure`, value: weatherRisk || 1, appliesTo: ['CDW', 'RCLI', 'SLI'], explanation: 'Historical severe-weather exposure for the pickup state and rental season.', sourceVersion: BONZAH_DEMO_RULES.dataset.sources.weather.version },
    { code: 'RENTAL_USE', label: 'Rental use', value: useFactor, appliesTo: ['CDW', 'RCLI', 'SLI'], explanation: request.risk.rentalUse === 'PERSONAL' ? 'Personal use is within automatic eligibility.' : 'Commercial, rideshare and delivery use is outside automatic eligibility.' },
  ];
  return {
    status, chargedPeriods, vehicleMultiplier: money(vehicleMultiplier), factors, ratingSource, coveragePrices,
    subtotal, fees, feeComponents, tax: 0, total: money(subtotal + fees),
    eligibilityExplanation: excludedUse ? 'Commercial, rideshare, and delivery use are not eligible.' : porsche ? 'This vehicle is outside the configured eligibility rules.' : environmentUnavailable ? 'The pickup state does not have an active approved environmental dataset.' : referred ? 'This vehicle needs review because its value or trim exceeds automatic authority.' : 'This vehicle is eligible under the current foundation rules.',
    internalRuleReferences: excludedUse ? ['RENTAL_USE.EXCLUDED'] : porsche ? ['VEHICLE.EXCLUDED.PORSCHE_911'] : environmentUnavailable ? ['ENVIRONMENT.DATASET_UNAVAILABLE.REFER'] : referred ? ['VEHICLE.HIGH_VALUE.REFER'] : ['VEHICLE.AUTO_ACCEPT'],
    warnings: ['Foundation pricing must be actuarially and carrier approved before live sale.', ...(request.risk.driver.additionalDriversListed ? ['Additional drivers must be listed on the rental agreement.'] : [])],
    referralRequirements: environmentUnavailable ? ['Activate approved state road-risk and seasonal-weather data.'] : referred ? ['Confirm exact trim and declared vehicle value.'] : [],
    package: selectedPackage ? { code: request.packageCode!, label: selectedPackage.label, coverages: selectedPackage.coverages } : undefined,
  };
}

/** Price-only preview deliberately has no quote identity, eligibility decision, or bind token. */
export function calculateRentalPricePreview(request: RentalPricePreviewRequest) {
  const rating = calculateRentalRating({
    programId: 'BONZAH-US-DEMO-2026', channel: 'WEB', effectiveDate: BONZAH_DEMO_RULES.effectiveDate,
    risk: { pickup: request.pickup, residence: { country: 'US', state: request.pickup.state }, rentalStart: request.rentalStart, rentalEnd: request.rentalEnd,
      driver: { age: 25, licenceValid: true, additionalDriversListed: false }, rentalUse: 'PERSONAL', vehicle: request.vehicle },
    coverages: request.coverages,
  });
  return { chargedPeriods: rating.chargedPeriods, vehicleMultiplier: rating.vehicleMultiplier, factors: rating.factors, ratingSource: rating.ratingSource, coveragePrices: rating.coveragePrices, subtotal: rating.subtotal, fees: rating.fees, feeComponents: rating.feeComponents, tax: rating.tax, total: rating.total, currency: 'USD' as const };
}

/**
 * Pre-quote coverage discovery.
 *
 * Deliberately has no quote identity, expiry or bind token: it answers what a
 * renter may buy before they have chosen anything. Unlike `calculateRentalRating`
 * it never throws on an ineligible risk — an ineligible renter is an answer the
 * caller has to render, not an error. The vehicle is optional; without one the
 * renter-and-trip gates still resolve but no price is produced, which is what
 * lets a distribution partner ask "what is available here" before a car is picked.
 *
 * Eligibility and prices are resolved here, in the kernel, so a distribution
 * surface never reproduces them in frontend code.
 */
export function discoverRentalCoverages(request: RentalCoverageDiscoveryRequest): RentalCoverageDiscoveryResponse {
  const meta = BONZAH_DEMO_RULES.coverages;
  const codes = ['CDW', 'RCLI', 'SLI', 'PAI_PEI'] as const;
  const requiresByCode: Partial<Record<RentalCoverageCode, RentalCoverageCode[]>> = { SLI: ['RCLI'] };

  const base = (code: RentalCoverageCode, available: boolean, unavailableReason: string | null, daily: number | null, periods: number | null): RentalDiscoveredCoverage => ({
    code,
    label: meta[code].label,
    available,
    unavailableReason,
    requires: requiresByCode[code] ?? [],
    limit: meta[code].limit,
    deductible: meta[code].deductible,
    description: meta[code].exclusions,
    indicativeDailyPrice: daily,
    indicativeTripPrice: daily !== null && periods !== null ? money(daily * periods) : null,
  });

  const ineligible = (explanation: string, ruleReference: string): RentalCoverageDiscoveryResponse => ({
    eligibility: { status: 'DECLINED', explanation, ruleReferences: [ruleReference], referralRequirements: [] },
    chargedPeriods: null,
    coverages: codes.map((code) => base(code, false, explanation, null, null)),
    packages: Object.entries(RENTAL_PROTECTION_PACKAGES).map(([code, pack]) => ({ code: code as RentalProtectionPackageCode, label: pack.label, description: pack.description, coverages: pack.coverages, available: false })),
    ratingSource: null,
    fees: 0,
    feeComponents: [],
    currency: 'USD',
    ruleVersion: BONZAH_DEMO_RULES.version,
    warnings: [],
    demoStatus: 'DEMO BUILD',
  });

  // Trip and renter gates resolve without a vehicle.
  const start = Date.parse(request.rentalStart);
  const end = Date.parse(request.rentalEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return ineligible('Return must be after pickup.', 'RENTAL_PERIOD.INVALID');
  const chargedPeriods = Math.max(1, Math.ceil((end - start) / 86_400_000));
  if (chargedPeriods > 30)
    return ineligible('The demo supports rental periods up to 30 days.', 'RENTAL_PERIOD.TOO_LONG');
  if (request.driver.age < 21)
    return ineligible('Drivers under 21 are not eligible in this demo.', 'DRIVER.AGE');
  if (!request.driver.licenceValid)
    return ineligible('A valid driving licence is required.', 'DRIVER.LICENCE_INVALID');
  if (request.rentalUse !== 'PERSONAL')
    return ineligible('Commercial, rideshare, and delivery use are not eligible.', 'RENTAL_USE.EXCLUDED');

  // Without a vehicle the catalogue is available but unpriced.
  if (!request.vehicle) {
    return {
      eligibility: { status: 'QUOTED', explanation: 'The renter and rental period are eligible. Provide a vehicle for pricing.', ruleReferences: ['RENTER.ELIGIBLE'], referralRequirements: [] },
      chargedPeriods,
      coverages: codes.map((code) => base(code, true, null, null, null)),
      packages: Object.entries(RENTAL_PROTECTION_PACKAGES).map(([code, pack]) => ({ code: code as RentalProtectionPackageCode, label: pack.label, description: pack.description, coverages: pack.coverages, available: true })),
      ratingSource: null,
      fees: 0,
      feeComponents: [],
      currency: 'USD',
      ruleVersion: BONZAH_DEMO_RULES.version,
      warnings: ['Prices require a vehicle. Foundation pricing must be actuarially and carrier approved before live sale.'],
      demoStatus: 'DEMO BUILD',
    };
  }

  // With a vehicle, reuse the canonical engine so discovery can never disagree
  // with the quote that follows it. All four coverages are priced so the caller
  // can render the full catalogue, not only a pre-made selection.
  const rating = calculateRentalRating({
    programId: 'BONZAH-US-DEMO-2026',
    channel: 'API',
    effectiveDate: BONZAH_DEMO_RULES.effectiveDate,
    risk: {
      pickup: request.pickup,
      residence: request.residence ?? { country: 'US', state: request.pickup.state },
      rentalStart: request.rentalStart,
      rentalEnd: request.rentalEnd,
      driver: { age: request.driver.age, licenceValid: request.driver.licenceValid, additionalDriversListed: false },
      rentalUse: request.rentalUse,
      vehicle: request.vehicle,
    },
    coverages: [...codes],
  });

  const quotable = rating.status !== 'DECLINED';
  const priced = new Map(rating.coveragePrices.map((coverage) => [coverage.code, coverage]));

  return {
    eligibility: {
      status: rating.status,
      explanation: rating.eligibilityExplanation,
      ruleReferences: rating.internalRuleReferences,
      referralRequirements: rating.referralRequirements,
    },
    chargedPeriods: rating.chargedPeriods,
    coverages: codes.map((code) => {
      const price = priced.get(code);
      return base(code, quotable, quotable ? null : rating.eligibilityExplanation, quotable && price ? price.dailyPrice : null, quotable ? rating.chargedPeriods : null);
    }),
    packages: Object.entries(RENTAL_PROTECTION_PACKAGES).map(([code, pack]) => ({ code: code as RentalProtectionPackageCode, label: pack.label, description: pack.description, coverages: pack.coverages, available: quotable })),
    ratingSource: quotable ? rating.ratingSource : null,
    fees: quotable ? rating.fees : 0,
    feeComponents: quotable ? rating.feeComponents : [],
    currency: 'USD',
    ruleVersion: BONZAH_DEMO_RULES.version,
    warnings: rating.warnings,
    demoStatus: 'DEMO BUILD',
  };
}

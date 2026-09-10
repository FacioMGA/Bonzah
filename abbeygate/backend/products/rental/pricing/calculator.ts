import { RENTAL_PROTECTION_PACKAGES, type RentalCoverageCode, type RentalCoveragePrice, type RentalPricePreviewRequest, type RentalQuoteRequest, type RentalQuoteStatus, type RentalRatingFactor, type RentalRatingSourceSnapshot } from '@facio/products';
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

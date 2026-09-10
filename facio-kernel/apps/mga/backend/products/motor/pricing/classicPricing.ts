import type { QuoteData } from '../../../platform/types/autoInsurance.js';
import type {
  ClassicCarRates,
  ClassicRateGroup,
  ClassicMileageBand,
  ClassicExcessAgeBand,
  ClassicVehicleRow,
} from './data/classic-car-rates.schema.js';

export type { ClassicRateGroup, ClassicMileageBand, ClassicExcessAgeBand } from './data/classic-car-rates.schema.js';
/**
 * Pre-externalization name. Now an alias for `ClassicRateGroup` (the value
 * actually used to index rate matrices). The raw data column has a wider
 * domain — see `ClassicVehicleGroup` in the schema for the full set and
 * KNOWN-ISSUE-1 for why the two differ.
 */
export type ClassicVehicleGroup = ClassicRateGroup;
export type ClassicGroupMatchType = 'exact' | 'make-year-cc-nearest' | 'fallback-5plus';

export type ClassicPricingContext = {
  vehicleGroup: ClassicVehicleGroup;
  groupMatchType: ClassicGroupMatchType;
  mileageBand: ClassicMileageBand;
  ageBand: ClassicExcessAgeBand;
  basePremium: number;
  policyExcess: number;
};

function normalize(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function modelMatches(lhs: string, rhs: string): boolean {
  if (!lhs || !rhs) return false;
  return lhs.includes(rhs) || rhs.includes(lhs);
}

function mileageBandFromKms(kmsPerYear: number): ClassicMileageBand {
  if (kmsPerYear <= 1500) return '0-1500';
  if (kmsPerYear <= 3000) return '1501-3000';
  return '3001-5000';
}

function ageBandFromAge(age: number): ClassicExcessAgeBand {
  return age <= 20 ? '10-20' : '20+';
}

export function resolveClassicVehicleGroup(input: {
  make: unknown;
  model: unknown;
  year: unknown;
  engineCc: unknown;
}, rates: ClassicCarRates): { vehicleGroup: ClassicVehicleGroup; groupMatchType: ClassicGroupMatchType } {
  const make = normalize(input.make);
  const model = normalize(input.model);
  const year = Number(input.year) || 0;
  const engineCc = Number(input.engineCc) || 0;

  const vehicleGroups = rates.vehicleGroups;

  const exactCandidates = vehicleGroups.filter((row: ClassicVehicleRow) =>
    normalize(row.make) === make &&
    year >= Number(row.fromYear) &&
    year <= Number(row.toYear) &&
    modelMatches(normalize(row.model), model)
  );
  if (exactCandidates.length > 0) {
    return { vehicleGroup: String(exactCandidates[0].group) as ClassicVehicleGroup, groupMatchType: 'exact' };
  }

  const makeYearCandidates = vehicleGroups.filter((row: ClassicVehicleRow) =>
    normalize(row.make) === make &&
    year >= Number(row.fromYear) &&
    year <= Number(row.toYear)
  );
  if (makeYearCandidates.length > 0) {
    const nearest = [...makeYearCandidates].sort((a: ClassicVehicleRow, b: ClassicVehicleRow) => {
      const aDistance = Math.abs(Number(a.engineCc) - engineCc);
      const bDistance = Math.abs(Number(b.engineCc) - engineCc);
      return aDistance - bDistance;
    })[0];
    return { vehicleGroup: String(nearest.group) as ClassicVehicleGroup, groupMatchType: 'make-year-cc-nearest' };
  }

  return { vehicleGroup: '5+', groupMatchType: 'fallback-5plus' };
}

export function resolveClassicPricingContext(args: {
  quoteData: QuoteData;
  age: number;
  annualKms: number;
}, rates: ClassicCarRates): ClassicPricingContext {
  const groupResult = resolveClassicVehicleGroup({
    make: args.quoteData.make,
    model: args.quoteData.model,
    year: args.quoteData.year,
    engineCc: args.quoteData.engineSize,
  }, rates);
  const mileageBand = mileageBandFromKms(Number(args.annualKms) || 0);
  const ageBand = ageBandFromAge(Number(args.age) || 30);
  // Cast to Record<string, number> intentionally — see KNOWN-ISSUE-1 in
  // `./data/classic-car-rates.schema.ts`. Rate matrices only
  // have rows for groups '1'…'5'/'5+', but vehicleGroups data contains
  // '6'…'10' and 'NQ'. Lookups for those groups currently return undefined
  // → NaN, which is the pre-externalization behavior. Fix is a follow-up.
  const premiumRow = rates.premiumByMileageBand[mileageBand] as Record<string, number>;
  const excessRow = rates.policyExcessByAgeBand[ageBand] as Record<string, number>;
  const basePremium = Number(premiumRow[groupResult.vehicleGroup]);
  const policyExcess = Number(excessRow[groupResult.vehicleGroup]);

  return {
    vehicleGroup: groupResult.vehicleGroup,
    groupMatchType: groupResult.groupMatchType,
    mileageBand,
    ageBand,
    basePremium,
    policyExcess,
  };
}

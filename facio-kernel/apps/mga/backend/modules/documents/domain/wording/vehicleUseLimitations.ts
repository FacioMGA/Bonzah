export type VehicleUseLimitations = {
  useText: string;
  excludingText: string;
};

/**
 * Official "Limitations as to use" wording variants keyed by QuoteData.vehicleUse.
 *
 * Today these are hard-coded. Next step (as discussed) is to back this by a
 * versioned wording table/service that can be selected per program/binder and
 * referenced by endorsements/coverages/questionnaire.
 */
const VEHICLE_USE_LIMITATIONS: Record<string, VehicleUseLimitations> = {
  // 1) Private Use (SDP)
  'SD&P': {
    useText:
      'Use for social, domestic and pleasure purposes and for the carriage of the Insured’s own goods in connection with the business of the Insured.',
    excludingText:
      'Excluding the carriage of passengers or goods for hire or reward, competitions, racing, pacemaking, use in any contest, reliability or speed trial or use for any purpose in connection with the Motor Trade.',
  },

  // 2) Commercial – Own Business Use (No Employees Driving)
  'Class 1': {
    useText:
      'Use for social, domestic and pleasure purposes and for business use in connection with the Insured’s own business, including the carriage of the Insured’s own goods.',
    excludingText:
      'Excluding the carriage of passengers or goods for hire or reward, use by employees or third parties, competitions, racing, pacemaking, use in any contest, reliability or speed trial or use for any purpose in connection with the Motor Trade.',
  },

  // 3) Commercial – Business Use Including Employees
  'Class 2': {
    useText:
      'Use for social, domestic and pleasure purposes and for business use in connection with the Insured’s business, including the carriage of the Insured’s own goods, by the Policyholder and authorised employees.',
    excludingText:
      'Excluding the carriage of passengers or goods for hire or reward, competitions, racing, pacemaking, use in any contest, reliability or speed trial or use for any purpose in connection with the Motor Trade.',
  },

  // 4) Commercial – Business Use Including Haulage (Own Goods Only)
  'Class 3': {
    useText:
      'Use for social, domestic and pleasure purposes and for business use in connection with the Insured’s business, including the carriage and haulage of the Insured’s own goods by the Policyholder and authorised drivers.',
    excludingText:
      'Excluding the carriage of passengers or goods for hire or reward, carriage of goods for third parties, competitions, racing, pacemaking, use in any contest, reliability or speed trial or use for any purpose in connection with the Motor Trade, car hire, taxi services or public transport.',
  },
};

export function resolveVehicleUseLimitations(vehicleUseRaw: unknown): VehicleUseLimitations {
  const key = String(vehicleUseRaw ?? '').trim();
  return VEHICLE_USE_LIMITATIONS[key] || VEHICLE_USE_LIMITATIONS['SD&P'];
}


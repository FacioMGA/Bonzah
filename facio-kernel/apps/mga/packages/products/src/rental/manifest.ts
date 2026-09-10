import type { ProductManifest } from '../types.js';

type JsonObject = { [k: string]: unknown };

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

export const rentalManifest: ProductManifest = {
  productType: 'RENTAL',
  displayName: 'Rental Vehicle Protection',
  insuredObject: {
    kind: 'rental-vehicle',
    cardinality: 'one',
    label: { singular: 'Rental vehicle', plural: 'Rental vehicles' },
    fields: [
      { path: 'risk.vehicle.year', label: 'Year', type: 'number', required: true },
      { path: 'risk.vehicle.make', label: 'Make', type: 'text', required: true },
      { path: 'risk.vehicle.model', label: 'Model', type: 'text', required: true },
      { path: 'risk.vehicle.class', label: 'Vehicle class', type: 'select', required: true },
      {
        path: 'risk.vehicle.declaredValue',
        label: 'Declared value',
        type: 'currency',
        required: true,
      },
    ],
  },
  questionnaire: {
    sections: [
      {
        id: 'rental-search',
        title: 'Rental details',
        order: 1,
        fields: [
          { path: 'risk.pickup.state', label: 'Pickup state', type: 'text', required: true },
          { path: 'risk.residence.state', label: 'Residence state', type: 'text', required: true },
          { path: 'risk.rentalStart', label: 'Pickup date and time', type: 'text', required: true },
          { path: 'risk.rentalEnd', label: 'Return date and time', type: 'text', required: true },
          { path: 'risk.driver.age', label: 'Driver age', type: 'number', required: true, min: 21 },
        ],
      },
      {
        id: 'vehicle',
        title: 'Rental vehicle',
        order: 2,
        fields: [
          { path: 'risk.vehicle.year', label: 'Year', type: 'number', required: true },
          { path: 'risk.vehicle.make', label: 'Make', type: 'text', required: true },
          { path: 'risk.vehicle.model', label: 'Model', type: 'text', required: true },
          { path: 'risk.vehicle.class', label: 'Vehicle class', type: 'text', required: true },
          {
            path: 'risk.vehicle.declaredValue',
            label: 'Declared value',
            type: 'currency',
            required: true,
          },
          {
            path: 'risk.vehicle.repairProfile',
            label: 'Repair-cost profile',
            type: 'text',
            required: true,
          },
          { path: 'risk.vehicle.powertrain', label: 'Powertrain', type: 'text', required: true },
        ],
      },
      {
        id: 'protection',
        title: 'Bonzah protection',
        order: 3,
        fields: [
          { path: 'coverages', label: 'Selected coverages', type: 'multiselect', required: true },
        ],
      },
    ],
  },
  summaryFields: {
    titlePaths: ['risk.vehicle.make', 'risk.vehicle.model'],
    subtitlePaths: ['risk.pickup.state', 'risk.rentalStart', 'risk.rentalEnd'],
    insuredValuePath: 'risk.vehicle.declaredValue',
    buildTitle: (data) => {
      const vehicle = asRecord(asRecord(data.risk).vehicle);
      return (
        [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Rental vehicle'
      );
    },
  },
  listColumns: {
    insured: {
      primaryPaths: ['risk.vehicle.make', 'risk.vehicle.model'],
      secondaryPaths: ['risk.vehicle.class'],
    },
    coverage: { primaryPaths: ['coverages'], secondaryPaths: ['risk.pickup.state'] },
  },
  coverageCatalog: [
    {
      code: 'CDW',
      label: 'Collision Damage Waiver',
      description: 'Primary rental-vehicle collision damage protection.',
      scope: 'POLICY',
      group: 'damage',
    },
    {
      code: 'RCLI',
      label: "Renter's Contingent Liability Insurance",
      description: 'Primary state-minimum liability protection.',
      scope: 'POLICY',
      group: 'liability',
    },
    {
      code: 'SLI',
      label: 'Supplemental Liability Insurance',
      description: 'Additional liability protection; requires RCLI.',
      scope: 'POLICY',
      group: 'liability',
    },
    {
      code: 'PAI_PEI',
      label: 'Personal Accident / Personal Effects',
      description: 'Accident medical and personal-effects protection.',
      scope: 'POLICY',
      group: 'personal',
    },
  ],
  uwConfigSchema: {
    groups: [
      {
        id: 'vehicle-rating',
        title: 'Vehicle-aware demo rating',
        fields: [
          {
            path: 'rating.maxVehicleMultiplier',
            label: 'Maximum vehicle multiplier',
            type: 'number',
          },
          { path: 'rating.referralValue', label: 'Referral value', type: 'currency' },
        ],
      },
    ],
  },
  documentTypes: {
    RENTAL_CDW_CERTIFICATE_PDF: 'Collision Damage Waiver certificate',
    RENTAL_RCLI_CERTIFICATE_PDF: "Renter's Contingent Liability certificate",
    RENTAL_SLI_CERTIFICATE_PDF: 'Supplemental Liability certificate',
    RENTAL_PAI_PEI_CERTIFICATE_PDF: 'Personal Accident / Personal Effects certificate',
  },
  riskModelHints: {
    requiredForUw: [
      { path: 'risk.pickup.state', label: 'Pickup state' },
      { path: 'risk.vehicle.declaredValue', label: 'Declared value' },
      { path: 'risk.vehicle.repairProfile', label: 'Repair-cost profile' },
    ],
    referralFlags: [],
    ratingInputs: [
      { path: 'risk.vehicle.declaredValue', label: 'Declared value', format: 'currency' },
      { path: 'risk.vehicle.class', label: 'Vehicle class', format: 'text' },
      { path: 'risk.vehicle.powertrain', label: 'Powertrain', format: 'text' },
    ],
  },
  rules: { batchRules: { minUnits: 0 } },
  theme: { iconKey: 'car-front', segmentLabel: 'Rental Protection' },
};

import type { ValidationProfile } from '@facio/validation';

const quoteFields = [
  'risk.pickup.state',
  'risk.residence.state',
  'risk.rentalStart',
  'risk.rentalEnd',
  'risk.driver.age',
  'risk.driver.licenceValid',
  'risk.vehicle.year',
  'risk.vehicle.make',
  'risk.vehicle.model',
  'risk.vehicle.class',
  'risk.vehicle.declaredValue',
  'risk.vehicle.repairProfile',
  'risk.vehicle.powertrain',
  'coverages',
];

export const rentalValidationProfile: ValidationProfile = {
  productCode: 'RENTAL',
  fields: {
    'risk.pickup.state': { path: 'risk.pickup.state', rule: 'nonEmptyString', required: true, label: 'Pickup state' },
    'risk.residence.state': { path: 'risk.residence.state', rule: 'nonEmptyString', required: true, label: 'Residence state' },
    'risk.rentalStart': { path: 'risk.rentalStart', rule: 'nonEmptyString', required: true, label: 'Rental start' },
    'risk.rentalEnd': { path: 'risk.rentalEnd', rule: 'nonEmptyString', required: true, label: 'Rental end' },
    'risk.driver.age': { path: 'risk.driver.age', rule: 'nonNegativeMoney', required: true, label: 'Driver age' },
    'risk.driver.licenceValid': { path: 'risk.driver.licenceValid', rule: 'bool', required: true, label: 'Valid licence' },
    'risk.vehicle.year': { path: 'risk.vehicle.year', rule: 'nonNegativeMoney', required: true, label: 'Vehicle year' },
    'risk.vehicle.make': { path: 'risk.vehicle.make', rule: 'nonEmptyString', required: true, label: 'Vehicle make' },
    'risk.vehicle.model': { path: 'risk.vehicle.model', rule: 'nonEmptyString', required: true, label: 'Vehicle model' },
    'risk.vehicle.class': { path: 'risk.vehicle.class', rule: 'oneOf:compact|sedan|suv', required: true, label: 'Vehicle class' },
    'risk.vehicle.declaredValue': { path: 'risk.vehicle.declaredValue', rule: 'positiveMoney', required: true, label: 'Declared value' },
    'risk.vehicle.repairProfile': { path: 'risk.vehicle.repairProfile', rule: 'oneOf:low|standard|high', required: true, label: 'Repair-cost profile' },
    'risk.vehicle.powertrain': { path: 'risk.vehicle.powertrain', rule: 'oneOf:combustion|hybrid|ev', required: true, label: 'Powertrain' },
    coverages: { path: 'coverages', required: true, label: 'Selected coverages' },
  },
  steps: [
    { id: 'rental-search', fields: quoteFields.slice(0, 6) },
    { id: 'vehicle', fields: quoteFields.slice(6, 13) },
    { id: 'protection', fields: ['coverages'] },
  ],
  stages: {
    pricing: { fields: quoteFields },
    quote: { fields: quoteFields },
    bind: { fields: quoteFields },
    issuance: { fields: quoteFields },
  },
};

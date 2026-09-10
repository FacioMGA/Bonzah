import type { ProductGoldenFixtures } from '../../modules/policy/domain/productContracts.js';
import type { RentalQuoteRequest } from '@facio/products';

export { summitVehicles } from './summitVehicles.js';

export const goldenRentalQuote: RentalQuoteRequest = {
  programId: 'BONZAH-US-FOUNDATION-2026', channel: 'WEB', effectiveDate: '2026-09-07',
  risk: {
    pickup: { country: 'US', location: 'Denver International Airport', state: 'CO' },
    residence: { country: 'US', state: 'CA' },
    rentalStart: '2026-09-18T10:00:00-06:00', rentalEnd: '2026-09-22T10:00:00-06:00',
    driver: { age: 35, licenceValid: true, additionalDriversListed: false }, rentalUse: 'PERSONAL',
    vehicle: { id: 'rav4', year: 2025, make: 'Toyota', model: 'RAV4', class: 'suv', declaredValue: 31_500, repairProfile: 'standard', powertrain: 'hybrid' },
  },
  coverages: ['CDW', 'RCLI', 'SLI', 'PAI_PEI'],
};

export const rentalGoldenFixtures: ProductGoldenFixtures = { minimumValid: goldenRentalQuote, minimumIssuable: goldenRentalQuote };

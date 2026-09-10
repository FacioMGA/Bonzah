import type { ProductGoldenFixtures } from '../../modules/policy/domain/productContracts.js';
import type { RentalQuoteRequest, SummitVehicle } from '@facio/products';

export const summitVehicles: SummitVehicle[] = [
  { id: 'corolla', name: 'City smart', category: 'Compact', year: 2025, make: 'Toyota', model: 'Corolla', class: 'compact', seats: 5, bags: 2, powertrain: 'combustion', repairProfile: 'low', declaredValue: 24_000, dailyRentalPrice: 48, availability: 'AVAILABLE', accent: '#70b7a5' },
  { id: 'rav4', name: 'Mountain ready', category: 'SUV', year: 2025, make: 'Toyota', model: 'RAV4', class: 'suv', seats: 5, bags: 4, powertrain: 'hybrid', repairProfile: 'standard', declaredValue: 31_500, dailyRentalPrice: 69, availability: 'AVAILABLE', accent: '#e67e4a' },
  { id: 'model-3', name: 'Electric drive', category: 'Premium sedan', year: 2025, make: 'Tesla', model: 'Model 3', class: 'sedan', seats: 5, bags: 3, powertrain: 'ev', repairProfile: 'high', declaredValue: 47_500, dailyRentalPrice: 82, availability: 'AVAILABLE', accent: '#6778bf' },
  { id: 'porsche-911', name: 'Performance', category: 'Sports', year: 2025, make: 'Porsche', model: '911 Carrera', class: 'sedan', seats: 4, bags: 1, powertrain: 'combustion', repairProfile: 'high', declaredValue: 128_000, dailyRentalPrice: 260, availability: 'AVAILABLE', accent: '#cf5b55' },
  { id: 'ambiguous-luxury', name: 'Luxury — exact trim pending', category: 'Luxury SUV', year: 2025, make: 'Apex', model: 'Touring — trim pending', class: 'suv', seats: 5, bags: 4, powertrain: 'hybrid', repairProfile: 'high', declaredValue: 72_000, dailyRentalPrice: 145, availability: 'AVAILABLE', accent: '#9876aa' },
];

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

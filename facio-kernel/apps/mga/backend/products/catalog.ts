import type { IProductAdapter } from '../modules/policy/domain/productContracts.js';
import { BusinessProductAdapter } from './business/BusinessProductAdapter.js';
import { HealthProductAdapter } from './health/HealthProductAdapter.js';
import { HomeProductAdapter } from './home/HomeProductAdapter.js';
import { MotorProductAdapter } from './motor/MotorProductAdapter.js';
import { OpenMarketProductAdapter } from './open-market/OpenMarketProductAdapter.js';
import { TravelProductAdapter } from './travel/TravelProductAdapter.js';
import { CommercialProductAdapter } from './commercial/CommercialProductAdapter.js';
import { RentalProductAdapter } from './rental/RentalProductAdapter.js';

export function buildProductCatalog(): IProductAdapter[] {
  return [
    new MotorProductAdapter(),
    new HomeProductAdapter(),
    new TravelProductAdapter(),
    new HealthProductAdapter(),
    new BusinessProductAdapter(),
    new OpenMarketProductAdapter(),
    new CommercialProductAdapter(),
    new RentalProductAdapter(),
  ];
}

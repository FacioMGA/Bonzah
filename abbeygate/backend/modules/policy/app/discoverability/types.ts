export type ProductDiscoverabilityInput = {
  productType: string;
  status: string;
  inceptionDate: Date | null;
  expiryDate: Date | null;
  quoteData: unknown;
  quoteResponse: unknown;
  vehicleInfo: unknown;
  policyHolder: {
    name: string | null;
    address: string | null;
    contact?: unknown;
  } | null;
};

export type ProductDiscoverabilityProjection = {
  insuredName: string;
  insuredDisplay: string;
  vehicleDisplay: string | null;
  policyholderDisplay: string | null;
  policyholderEmail: string | null;
  policyholderPhone: string | null;
  coverageStart: Date | null;
  coverageEnd: Date | null;
  vehicleSearch: string | null;
  address: string | null;
  segment: string | null;
  totalPremium: number;
  renewalDate: Date | null;
  quoteExpiryDate: Date | null;
};

export type ProductDiscoverabilityAdapter = (
  input: ProductDiscoverabilityInput,
) => ProductDiscoverabilityProjection;


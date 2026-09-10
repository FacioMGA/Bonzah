import type { QuoteData } from '../../../platform/types/autoInsurance.js';

export function buildVehicleInfoFromQuoteData(quoteData: Partial<QuoteData>) {
  return {
    vehicleLocation: quoteData?.vehicleLocation,
    coverRequired: quoteData?.coverRequired,
    renewalDate: quoteData?.renewalDate,
    vehicleType: quoteData?.vehicleType,
    make: quoteData?.make,
    model: quoteData?.model,
    cabrio: quoteData?.cabrio,
    fuelType: quoteData?.fuelType,
    kmsPerYear: quoteData?.kmsPerYear,
    year: quoteData?.year,
    countryOfRegistration: quoteData?.countryOfRegistration,
    numberOfSeats: quoteData?.numberOfSeats,
    modified: quoteData?.modified,
    modificationsDetails: quoteData?.modificationsDetails,
    parking: quoteData?.parking,
    parkingOther: quoteData?.parkingOther,
    engineSize: quoteData?.engineSize,
    vehicleValue: quoteData?.vehicleValue,
    ncb: quoteData?.ncb,
    protectNCB: quoteData?.protectNCB,
    vehicleUse: quoteData?.vehicleUse,
    businessUseDetails: quoteData?.businessUseDetails,
    requiredExcess: quoteData?.requiredExcess,
    ncdProofUpload: quoteData.ncdProofUpload,
  };
}

export function buildDriverInfoFromQuoteData(quoteData: Partial<QuoteData>) {
  const driverRestriction = quoteData?.driverRestriction;
  // ABY-232: named-drivers list is only meaningful when the
  // coverage restriction is NAMED_DRIVERS. For POLICYHOLDER_ONLY and
  // the two open modes the array must be empty in persisted policy
  // data — otherwise stale rows from a basis switch end up in the
  // certificate / claims FNOL picker.
  const isNamedMode = driverRestriction === 'NAMED_DRIVERS' || driverRestriction === undefined;
  const rawAdditionalDrivers: Array<{
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    licenseYears: string;
    email: string;
    telephone: string;
  }> = Array.isArray((quoteData as Record<string, unknown>)?.additionalDrivers)
    ? ((quoteData as Record<string, unknown>).additionalDrivers as unknown[])
      .map((row) => (row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : {}))
      .map((row) => ({
        firstName: String(row.firstName || ''),
        lastName: String(row.lastName || ''),
        dateOfBirth: String(row.dateOfBirth || ''),
        licenseYears: String(row.licenseYears ?? ''),
        email: String(row.email || ''),
        telephone: String(row.telephone || ''),
      }))
    : [];
  const additionalDrivers = isNamedMode ? rawAdditionalDrivers : [];
  return {
    licenseYears: quoteData?.licenseYears,
    licenseType: quoteData?.licenseType,
    licenseIssuedIn: quoteData?.licenseIssuedIn,
    hasClaims: quoteData?.hasClaims,
    claimsDetails: quoteData?.claimsDetails,
    hasConvictions: quoteData?.hasConvictions,
    convictionsDetails: quoteData?.convictionsDetails,
    driverRestriction,
    hasAdditionalDrivers: isNamedMode ? quoteData?.hasAdditionalDrivers : false,
    otherDriversClaims: quoteData?.otherDriversClaims,
    otherDriversClaimsDetails: quoteData?.otherDriversClaimsDetails,
    otherDriversConvictions: quoteData?.otherDriversConvictions,
    otherDriversConvictionsDetails: quoteData?.otherDriversConvictionsDetails,
    additionalDrivers,
    namedDrivers: additionalDrivers,
  };
}

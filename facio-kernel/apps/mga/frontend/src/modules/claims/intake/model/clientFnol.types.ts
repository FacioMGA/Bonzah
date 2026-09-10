/**
 * clientFnol.types — All FNOL domain types
 *
 * Single source of truth for FNOL form shapes, DTOs, and domain value types.
 * No logic. No imports. Pure types.
 */

// ── Core form types ──

export type UploadItem = { name: string; url: string; filename?: string };

export type PolicySummary = { id?: string; policyId?: string; quoteData?: Record<string, unknown> };

export type FnolForm = {
  driverId: string;
  driverContactPhone: string;
  driverContactEmail: string;
  unauthorizedDriverFirstName: string;
  unauthorizedDriverLastName: string;
  unauthorizedDriverDateOfBirth: string;
  unauthorizedDriverPhone: string;
  unauthorizedDriverEmail: string;
  incidentDate: string;
  incidentTime: string;
  location: string;
  city: string;
  country: string;
  incidentType: 'collision' | 'damage_parked' | 'theft' | 'vandalism' | 'weather' | 'windscreen' | 'other';
  description: string;
  thirdPartyInvolved: '' | 'yes' | 'no';
  thirdPartyCounts: {
    another_car: number;
    pedestrian: number;
    property: number;
  };
  thirdPartyAnotherCars: Array<{
    fullName: string;
    telephone: string;
    plate: string;
    make: string;
    model: string;
    insurerName: string;
  }>;
  thirdPartyPedestrians: Array<{ fullName: string; telephone: string }>;
  thirdPartyProperties: Array<{ fullName: string; telephone: string }>;
  policeInvolved: '' | 'yes' | 'no';
  policeReportNumber: string;
  policeStation: string;
  driverHasPermission: '' | 'yes' | 'no';
  driverLicenseYearsHeld: string;
  driverLicenseIssuedCountry: string;
  carDrivable: '' | 'yes' | 'no';
  injuriesReported: '' | 'yes' | 'no';
  declarationAccepted: boolean;
};

// ── Domain value types (moved from helpers) ──

export type NamedDriver = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  dateOfBirth?: string;
};

export type ClaimsContractDto = {
  version: number;
  productType: string;
  fnol: {
    incidentTypes: Array<{ id: string; label: string; thirdPartyStep?: boolean }>;
    thirdPartyKinds: Array<{ id: string; label: string }>;
    rules?: {
      minDescriptionLength?: number;
      requiresThirdPartyFor?: string[];
      requiresPoliceFor?: string[];
      allowedCountries?: string[];
    };
  };
};

export type FnolFieldErrors = Partial<Record<
  | 'description'
  | 'incidentDate'
  | 'location'
  | 'city'
  | 'country'
  | 'driverId'
  | 'driverContactPhone'
  | 'driverContactEmail'
  | 'unauthorizedDriverFirstName'
  | 'unauthorizedDriverLastName'
  | 'unauthorizedDriverDateOfBirth'
  | 'unauthorizedDriverPhone'
  | 'unauthorizedDriverEmail'
  | 'thirdPartyInvolved'
  | 'thirdPartyKinds'
  | 'thirdPartyAnotherCarDetails'
  | 'thirdPartyPedestrianDetails'
  | 'thirdPartyPropertyDetails'
  | 'policeInvolved'
  | 'policeReportNumber'
  | 'policeStation'
  | 'driverHasPermission'
  | 'driverLicenseYearsHeld'
  | 'driverLicenseIssuedCountry'
  | 'carDrivable'
  | 'injuriesReported'
  ,
  string
>>;

// ── Shared constant ──

export const ANOTHER_DRIVER_ID = '__another_driver__';

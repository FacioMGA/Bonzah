import { isPossiblePhoneNumber } from 'react-phone-number-input';
import { EMAIL_REGEX } from '@facio/validation';
import { MOTOR_CANONICAL_FIELD_PATHS } from '@facio/products';

const canonicalMotorFieldPaths = new Set<string>(MOTOR_CANONICAL_FIELD_PATHS);

export type DriverDraftLike = {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  licenseYears?: number | string;
  email?: string;
  telephone?: string;
};

export type DriverFieldErrors = {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  licenseYears?: string;
  email?: string;
  telephone?: string;
};

export function ageFromDateOfBirth(dateOfBirth: string): number | null {
  const raw = String(dateOfBirth || '').trim();
  if (!raw) return null;
  const dob = new Date(raw);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  const age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  const actualAge = monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate()) ? age - 1 : age;
  return Number.isFinite(actualAge) ? actualAge : null;
}

export function youngestAgeFromDrivers(drivers: DriverDraftLike[]): number | null {
  const ages = (Array.isArray(drivers) ? drivers : [])
    .map((d) => ageFromDateOfBirth(String(d?.dateOfBirth || '')))
    .filter((age): age is number => Number.isFinite(age as number) && (age as number) >= 0);
  if (!ages.length) return null;
  return Math.min(...ages);
}

const LEGACY_SLUG_TO_PATH: Record<string, string> = {
  'insured.first_name': 'proposer.firstName',
  'insured.last_name': 'proposer.lastName',
  'insured.email': 'proposer.email',
  'insured.phone': 'proposer.phone',
  'vehicle.make': 'make',
  'vehicle.model': 'model',
  'vehicle.fuel_type': 'fuelType',
  'vehicle.use': 'vehicleUse',
  'vehicle.registration': 'registrationNumber',
  'vehicle.registrationnumber': 'registrationNumber',
  'vehicle.vin': 'vin',
  'insured.nif': 'proposer.nif',
  'policyholder.nif': 'proposer.nif',
  'policyholder.taxid': 'proposer.nif',
  'insured.date_of_birth': 'proposer.dateOfBirth',
  'insured.address_line': 'proposer.address.line1',
  'insured.city': 'proposer.address.city',
  'insured.postcode': 'proposer.address.postcode',
  'insured.post_code': 'proposer.address.postcode',
  'proposer.occupation': 'proposer.occupation',
  'proposer.wheredidyouhear': 'proposer.whereDidYouHear',
  'driver.license_issued_in': 'licenseIssuedIn',
  'driver.license_years': 'licenseYears',
};

export function issueFieldKeyFromSlug(slug: string): string | null {
  const raw = String(slug || '').trim();
  if (!raw) return null;
  // 1. Canonical manifest path (incl. nested `additionalDrivers.0.licenseYears`).
  //    Match the bare path against the canonical set, AND accept any
  //    array-indexed path whose un-indexed root is canonical (so
  //    `additionalDrivers.0.licenseYears` identity-maps just like
  //    `additionalDrivers.licenseYears` would).
  if (canonicalMotorFieldPaths.has(raw)) return raw;
  if (raw.startsWith('additionalDrivers.')) {
    const rest = raw.replace(/^additionalDrivers\.\d+\./, '');
    if (rest === 'firstName' || rest === 'lastName' || rest === 'dateOfBirth' || rest === 'licenseYears' || rest === 'email' || rest === 'telephone') {
      return raw;
    }
  }
  // 2. Legacy snake_case slug map (BO-only paths and pre-Phase-6k slugs).
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_');
  return LEGACY_SLUG_TO_PATH[normalized] || null;
}

export function validateDriverDraft(driver: DriverDraftLike, opts?: { requireCore?: boolean }): DriverFieldErrors {
  const requireCore = opts?.requireCore !== false;
  const errors: DriverFieldErrors = {};
  const firstName = String(driver.firstName || '').trim();
  const lastName = String(driver.lastName || '').trim();
  const dateOfBirth = String(driver.dateOfBirth || '').trim();
  const licenseYearsRaw = String(driver.licenseYears ?? '').trim();
  const email = String(driver.email || '').trim();
  const telephone = String(driver.telephone || '').trim();

  if (requireCore || firstName) {
    if (firstName.length < 2) errors.firstName = 'First name must be at least 2 characters.';
  }
  if (requireCore || lastName) {
    if (lastName.length < 2) errors.lastName = 'Last name must be at least 2 characters.';
  }
  if (requireCore || dateOfBirth) {
    if (!dateOfBirth) {
      errors.dateOfBirth = 'Date of birth is required.';
    } else {
      const dob = new Date(dateOfBirth);
      if (Number.isNaN(dob.getTime())) {
        errors.dateOfBirth = 'Please enter a valid date of birth.';
      } else {
        const today = new Date();
        const age = today.getFullYear() - dob.getFullYear();
        const monthDiff = today.getMonth() - dob.getMonth();
        const actualAge = monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate()) ? age - 1 : age;
        if (actualAge < 17) errors.dateOfBirth = 'Driver must be at least 17 years old.';
      }
    }
  }
  if (requireCore || licenseYearsRaw) {
    if (!licenseYearsRaw) {
      errors.licenseYears = 'Licence years is required.';
    } else {
      const years = Number(licenseYearsRaw);
      if (!Number.isFinite(years) || years < 0) {
        errors.licenseYears = 'Please select valid licence years.';
      } else if (years > 60) {
        errors.licenseYears = 'Please select valid licence years.';
      } else {
        const age = ageFromDateOfBirth(dateOfBirth);
        if (age !== null && age - years < 17) {
          errors.licenseYears = 'Licence years cannot exceed driving age since 17.';
        }
      }
    }
  }
  if (email && !EMAIL_REGEX.test(email)) {
    errors.email = 'Please enter a valid email address.';
  }
  if (telephone) {
    const digits = telephone.replace(/\D/g, '');
    if (digits.length > 15 || telephone.length > 20) {
      errors.telephone = 'Phone number is too long.';
    } else if (!isPossiblePhoneNumber(telephone)) {
      errors.telephone = 'Please enter a valid phone number.';
    }
  }
  return errors;
}

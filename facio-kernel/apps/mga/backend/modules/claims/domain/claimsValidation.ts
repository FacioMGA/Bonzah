import { z } from 'zod';
import type { ClaimFormPackage } from './claimFormPackage.js';
import type { ClaimsContract } from './claimsContract.js';

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};

const asString = (value: unknown): string => String(value ?? '').trim();

function ageFromDate(dateValue: string): number | null {
  const dob = new Date(asString(dateValue));
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  const age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  return monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate()) ? age - 1 : age;
}

function isDateInPast(value: string): boolean {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) && ts < Date.now();
}

function validateTextRule(validationRuleRaw: string, text: string): string | null {
  const rule = asString(validationRuleRaw).toLowerCase();
  if (!rule || !text) return null;
  if (rule.includes('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return 'Please enter a valid email address.';
  if ((rule.includes('phone') || rule.includes('e.164')) && !/^\+?[0-9()\-.\s]{7,}$/.test(text)) {
    return 'Please enter a valid phone number.';
  }
  if (rule.includes('past') && !isDateInPast(text)) return 'Date must be in the past.';
  const minLenMatch = rule.match(/min(?:imum)?(?:\s+length)?\s*[:=]?\s*(\d+)/i);
  if (minLenMatch) {
    const minLen = Number(minLenMatch[1]);
    if (Number.isFinite(minLen) && text.length < minLen) {
      return `Please enter at least ${minLen} characters.`;
    }
  }
  return null;
}

export type MotorDriverRestrictionForFnol =
  | 'POLICYHOLDER_ONLY'
  | 'NAMED_DRIVERS'
  | 'ANY_DRIVER_25_PLUS'
  | 'ANY_DRIVER_40_PLUS'
  | null;

function openDriverMinAge(restriction: MotorDriverRestrictionForFnol): number | null {
  if (restriction === 'ANY_DRIVER_25_PLUS') return 25;
  if (restriction === 'ANY_DRIVER_40_PLUS') return 40;
  return null;
}

export function validateGuidedFnolForm(args: {
  form: unknown;
  contract: ClaimsContract;
  policyId: string;
  namedDrivers: Array<{ id: string; name: string }>;
  /**
   * ABY-232 / ADR-0025: when the policy is on an open-driver
   * restriction (`ANY_DRIVER_25_PLUS` / `ANY_DRIVER_40_PLUS`) the
   * driver picker no longer requires a match against `namedDrivers`.
   * Instead the form must declare the driver's DOB and the FNOL
   * validator enforces the age threshold server-side.
   */
  driverRestriction?: MotorDriverRestrictionForFnol;
}): {
  valid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const form = asRecord(args.form);
  const incident = asRecord(form.incident);
  const driver = asRecord(form.driver);
  const thirdParty = asRecord(form.thirdParty);
  const police = asRecord(form.police);
  const triage = asRecord(form.triage);

  const incidentType = asString(incident.type);
  const incidentConfig = (args.contract.fnol.incidentTypes || []).find((x) => x.id === incidentType) || null;
  const rules = args.contract.fnol.rules;
  const incidentTypes = new Set((args.contract.fnol.incidentTypes || []).map((x) => x.id));
  if (!incidentType || !incidentTypes.has(incidentType)) {
    errors['incident.type'] = 'Please select a valid incident type.';
  }

  const description = asString(incident.description);
  const minDescriptionLength = Number(rules.minDescriptionLength || 10);
  if (description.length < minDescriptionLength) {
    errors['incident.description'] = `Please provide at least ${minDescriptionLength} characters describing the incident.`;
  }
  const incidentDateRaw = asString(incident.date);
  if (!incidentDateRaw) {
    errors['incident.date'] = 'Incident date is required.';
  } else {
    const incidentDate = new Date(`${incidentDateRaw}T00:00:00`);
    if (Number.isNaN(incidentDate.getTime()) || incidentDate.getTime() > Date.now()) {
      errors['incident.date'] = 'Incident date cannot be in the future.';
    }
  }
  if (asString(incident.location).length < 2) errors['incident.location'] = 'Please enter incident location.';
  if (asString(incident.city).length < 2) errors['incident.city'] = 'Please enter incident city.';
  if (asString(incident.country).length < 2) errors['incident.country'] = 'Please enter incident country.';

  const driverId = asString(driver.id);
  const driverKind = asString(driver.kind).toLowerCase();
  if (!args.policyId) errors['policyId'] = 'Policy is required.';
  if (!driverId) errors['driver.id'] = 'Please select the driver.';
  const minAuthorisedAge = openDriverMinAge(args.driverRestriction ?? null);

  // ABY-232 / ADR-0025: when the policy is on an open-driver
  // restriction every "other driver" must still be authorised by
  // the age band declared on the certificate. Run the named-driver
  // / unauthorised branches as before and then layer the open-mode
  // age check on top so callers cannot bypass it by picking
  // `kind === 'unauthorized'`.
  if (driverKind === 'unauthorized') {
    if (asString(driver.name).length < 2) errors['driver.name'] = 'Unauthorized driver name is required.';
    const age = ageFromDate(asString(driver.dateOfBirth));
    if (age === null || age < 18 || age > 85) {
      errors['driver.dateOfBirth'] = 'Unauthorized driver date of birth must be valid (18-85).';
    } else if (minAuthorisedAge !== null && age < minAuthorisedAge) {
      errors['driver.dateOfBirth'] = `This policy only authorises drivers aged ${minAuthorisedAge} or over. Declared age: ${age}.`;
    } else if (minAuthorisedAge !== null && age > 70) {
      errors['driver.dateOfBirth'] = 'This policy only authorises drivers aged up to 70.';
    }
    if (typeof driver.permissionConfirmed !== 'boolean') {
      errors['driver.hasPermission'] = 'Please confirm whether the driver had permission.';
    }
  } else if (driverKind === 'any-authorised-driver') {
    // ABY-232 / ADR-0025: explicit open-driver kind. The FNOL form
    // must declare the driver's name and DOB; we verify the age
    // range matches the policy's restriction.
    if (asString(driver.name).length < 2) errors['driver.name'] = 'Driver name is required.';
    const age = ageFromDate(asString(driver.dateOfBirth));
    if (age === null || age < 18 || age > 100) {
      errors['driver.dateOfBirth'] = 'Driver date of birth must be valid.';
    } else if (minAuthorisedAge !== null && age < minAuthorisedAge) {
      errors['driver.dateOfBirth'] = `This policy only authorises drivers aged ${minAuthorisedAge} or over. Declared age: ${age}.`;
    } else if (age > 70) {
      errors['driver.dateOfBirth'] = 'This policy only authorises drivers aged up to 70.';
    }
  } else {
    const allowed = args.namedDrivers.some((d) => String(d.id) === driverId);
    if (!allowed) errors['driver.id'] = 'Selected driver is not allowed on this policy.';
  }

  const requiresThirdParty = incidentConfig
    ? Boolean(incidentConfig.thirdPartyStep)
    : (rules.requiresThirdPartyFor || []).includes(incidentType);
  const thirdPartyInvolved = asString(thirdParty.involved).toLowerCase();
  if (requiresThirdParty && !['yes', 'no'].includes(thirdPartyInvolved)) {
    errors['thirdParty.involved'] = 'Please choose whether a third party was involved.';
  }
  if (requiresThirdParty && thirdPartyInvolved === 'yes') {
    const counts = asRecord(thirdParty.counts);
    const derivedKinds = Object.entries(counts)
      .filter(([, count]) => Number(count) > 0)
      .map(([kind]) => kind);
    const kinds = Array.isArray(thirdParty.kinds) && thirdParty.kinds.length ? thirdParty.kinds : derivedKinds;
    if (!Array.isArray(kinds) || kinds.length === 0) {
      errors['thirdParty.kinds'] = 'Please select at least one third party type.';
    }
    const anotherCars = Array.isArray(thirdParty.anotherCars) ? thirdParty.anotherCars.map(asRecord) : [];
    const pedestrians = Array.isArray(thirdParty.pedestrians) ? thirdParty.pedestrians.map(asRecord) : [];
    const properties = Array.isArray(thirdParty.properties) ? thirdParty.properties.map(asRecord) : [];
    if (kinds.includes('another_car')) {
      const invalid = anotherCars.length === 0
        || anotherCars.find((car) => asString(car.fullName).length < 2 || asString(car.insurerName).length < 2);
      if (invalid) {
        errors['thirdParty.anotherCars'] = 'Please complete Another car third party details.';
      }
    }
    if (kinds.includes('pedestrian')) {
      const invalid = pedestrians.find((person) => asString(person.fullName).length < 2);
      if (invalid) errors['thirdParty.pedestrians'] = 'Please complete Pedestrian third party details.';
    }
    if (kinds.includes('property')) {
      const invalid = properties.find((person) => asString(person.fullName).length < 2);
      if (invalid) errors['thirdParty.properties'] = 'Please complete Property third party details.';
    }
  }

  const requiresPolice = (rules.requiresPoliceFor || []).includes(incidentType);
  const policeInvolved = police.involved === true || asString(police.involved).toLowerCase() === 'yes';
  if (requiresPolice && !policeInvolved) {
    errors['police.involved'] = 'Police involvement is required for this incident type.';
  }
  if (requiresPolice && policeInvolved && !asString(police.reportNumber)) {
    errors['police.reportNumber'] = 'Please provide police report number.';
  }

  const carDrivable = asString(triage.carDrivable).toLowerCase();
  if (!['yes', 'no', 'true', 'false'].includes(carDrivable)) {
    errors['triage.carDrivable'] = 'Please confirm whether the car is drivable.';
  }
  const injuries = asString(triage.injuriesReported).toLowerCase();
  if (!['yes', 'no', 'true', 'false'].includes(injuries)) {
    errors['triage.injuriesReported'] = 'Please confirm whether injuries were reported.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateClaimFormResponses(args: {
  claimFormPackage: ClaimFormPackage;
  responses: unknown;
}): {
  valid: boolean;
  errors: Record<string, string>;
  normalizedResponses: Record<string, unknown>;
} {
  const errors: Record<string, string> = {};
  const responseRecordSchema = z.record(z.string(), z.unknown());
  const parsed = responseRecordSchema.safeParse(args.responses ?? {});
  const normalizedResponses = parsed.success ? parsed.data : {};
  if (!parsed.success) {
    return { valid: false, errors: { _root: 'Invalid response payload.' }, normalizedResponses: {} };
  }

  for (const field of args.claimFormPackage.fields || []) {
    const value = normalizedResponses[field.fieldId];
    const text = asString(value);
    if (field.required && (field.type === 'checkbox' ? !Boolean(value) : !text)) {
      errors[field.fieldId] = `${field.label} is required.`;
      continue;
    }
    if (!text && field.type !== 'checkbox') continue;
    const ruleError = validateTextRule(String(field.validation || ''), text);
    if (ruleError) {
      errors[field.fieldId] = ruleError;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    normalizedResponses,
  };
}


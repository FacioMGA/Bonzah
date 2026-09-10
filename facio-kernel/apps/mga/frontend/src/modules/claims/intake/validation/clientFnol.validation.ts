/**
 * clientFnol.validation — Pure validation logic
 *
 * No React. No state. No effects. No UI.
 * Owns: eligibility computation, phone/email/DOB validation, incident date checks.
 */
import { isPossiblePhoneNumber } from 'react-phone-number-input';
import { EMAIL_REGEX } from '@facio/validation';
import type { FnolForm, ClaimsContractDto, NamedDriver, FnolFieldErrors } from '../model/clientFnol.types';
import { ANOTHER_DRIVER_ID } from '../model/clientFnol.types';

// ── Atomic validators ──

export function hasPhoneShapeError(raw: string): string | null {
    const value = String(raw || '').trim();
    if (!value) return null;
    const digits = value.replace(/\D/g, '');
    if (digits.length > 15 || value.length > 20) return 'Phone number is too long';
    if (!isPossiblePhoneNumber(value)) return 'Please enter a valid phone number';
    return null;
}

export function ageFromDate(dateValue: string): number | null {
    const dob = new Date(String(dateValue || '').trim());
    if (Number.isNaN(dob.getTime())) return null;
    const today = new Date();
    const age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    return monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate()) ? age - 1 : age;
}

export function validateAnotherDriverDob(value: string): string | undefined {
    const raw = String(value || '').trim();
    if (!raw) return 'Please enter your date of birth';
    const age = ageFromDate(raw);
    if (age === null) return 'Please enter your date of birth';
    if (age < 18) return 'You must be at least 18 to buy this insurance';
    if (age > 85) return 'Please contact us directly for cover';
    return undefined;
}

export function isFnolIncidentDateValid(incidentDate: string, now = new Date()): boolean {
    if (!incidentDate) return false;
    const selected = new Date(`${incidentDate}T00:00:00`);
    if (Number.isNaN(selected.getTime())) return false;
    const cutoff = new Date(now);
    cutoff.setHours(23, 59, 59, 999);
    return selected.getTime() <= cutoff.getTime();
}

// ── Eligibility (main validator) ──

export function computeFnolEligibility(args: {
    policyId: string;
    namedDrivers: NamedDriver[];
    form: FnolForm;
    contract?: ClaimsContractDto | null;
}): {
    canContinueStep1: boolean;
    canContinueStep2: boolean;
    canContinueStep3: boolean;
    canContinueStep4: boolean;
    canContinueStep5: boolean;
    canSubmit: boolean;
    hasValidNamedDriver: boolean;
    descriptionTrimmed: string;
    incidentDateValid: boolean;
    fieldErrors: FnolFieldErrors;
} {
    const { policyId, namedDrivers, form, contract } = args;
    const fieldErrors: FnolFieldErrors = {};
    const contractRules = contract?.fnol?.rules || {};
    const minDescriptionLength = Number(contractRules.minDescriptionLength || 10);
    const requiresThirdPartyFor = Array.isArray(contractRules.requiresThirdPartyFor) ? contractRules.requiresThirdPartyFor : ['collision'];
    const requiresPoliceFor = Array.isArray(contractRules.requiresPoliceFor) ? contractRules.requiresPoliceFor : ['theft', 'hit_and_run'];
    const incidentConfig = Array.isArray(contract?.fnol?.incidentTypes)
        ? contract?.fnol?.incidentTypes.find((x) => x.id === String(form.incidentType || ''))
        : null;
    const incidentDateValid = isFnolIncidentDateValid(String(form.incidentDate || ''));
    if (!incidentDateValid) fieldErrors.incidentDate = 'Incident date cannot be in the future.';

    const hasValidNamedDriver = Boolean(form.driverId && namedDrivers.some((d) => d.id === form.driverId));
    const isAnotherDriver = String(form.driverId || '') === ANOTHER_DRIVER_ID;
    if (!form.driverId) fieldErrors.driverId = 'Please select a driver';
    if (!isAnotherDriver && !hasValidNamedDriver) fieldErrors.driverId = 'Selected driver is not on this policy';
    if (isAnotherDriver) {
        const firstName = String(form.unauthorizedDriverFirstName || '').trim();
        const lastName = String(form.unauthorizedDriverLastName || '').trim();
        if (firstName.length < 2) fieldErrors.unauthorizedDriverFirstName = 'Please enter your first name (min 2 characters)';
        if (firstName.length > 50) fieldErrors.unauthorizedDriverFirstName = 'First name must be less than 50 characters';
        if (lastName.length < 2) fieldErrors.unauthorizedDriverLastName = 'Please enter your last name (min 2 characters)';
        if (lastName.length > 50) fieldErrors.unauthorizedDriverLastName = 'Last name must be less than 50 characters';
        const dobErr = validateAnotherDriverDob(String(form.unauthorizedDriverDateOfBirth || ''));
        if (dobErr) fieldErrors.unauthorizedDriverDateOfBirth = dobErr;
        if (!['yes', 'no'].includes(String(form.driverHasPermission || '').toLowerCase())) {
            fieldErrors.driverHasPermission = 'Please confirm whether the driver had permission';
        }
        const licenseYearsRaw = String(form.driverLicenseYearsHeld || '').trim();
        if (licenseYearsRaw) {
            const years = Number(licenseYearsRaw);
            if (!Number.isFinite(years) || years < 0 || years > 80) {
                fieldErrors.driverLicenseYearsHeld = 'Please enter valid license years held';
            }
        }
        if (String(form.driverLicenseIssuedCountry || '').trim().length > 0 && String(form.driverLicenseIssuedCountry || '').trim().length < 2) {
            fieldErrors.driverLicenseIssuedCountry = 'Please enter valid license issued country';
        }
    }

    const hasValidAnotherDriver =
        isAnotherDriver &&
        !fieldErrors.unauthorizedDriverFirstName &&
        !fieldErrors.unauthorizedDriverLastName &&
        !fieldErrors.unauthorizedDriverDateOfBirth;
    const selectedDriverReady = isAnotherDriver ? hasValidAnotherDriver : hasValidNamedDriver;

    const contactPhoneField = isAnotherDriver ? 'unauthorizedDriverPhone' : 'driverContactPhone';
    const contactEmailField = isAnotherDriver ? 'unauthorizedDriverEmail' : 'driverContactEmail';
    const contactPhone = String(isAnotherDriver ? form.unauthorizedDriverPhone : form.driverContactPhone || '').trim();
    const contactEmail = String(isAnotherDriver ? form.unauthorizedDriverEmail : form.driverContactEmail || '').trim();
    const contactPhoneErr = hasPhoneShapeError(contactPhone);
    if (contactPhoneErr) fieldErrors[contactPhoneField] = contactPhoneErr;
    if (contactEmail && !EMAIL_REGEX.test(contactEmail)) fieldErrors[contactEmailField] = 'Please enter a valid email address';

    const validContactPhone = !fieldErrors[contactPhoneField];
    const validContactEmail = !fieldErrors[contactEmailField];

    const descriptionTrimmed = String(form.description || '').trim();
    if (descriptionTrimmed.length < minDescriptionLength) {
        fieldErrors.description = `Please provide at least ${minDescriptionLength} characters describing the incident`;
    }
    if (!String(form.location || '').trim()) fieldErrors.location = 'Please enter incident location';
    if (String(form.city || '').trim().length < 2) fieldErrors.city = 'Please enter your city';
    if (String(form.country || '').trim().length < 2) fieldErrors.country = 'Please enter country';
    const canContinueStep1 = Boolean(
        form.incidentType
    );
    const canContinueStep2 = Boolean(
        incidentDateValid &&
        String(form.location || '').trim() &&
        String(form.city || '').trim().length >= 2 &&
        String(form.country || '').trim().length >= 2 &&
        !fieldErrors.country
    );
    const canContinueStep3 = Boolean(policyId && selectedDriverReady && validContactPhone && validContactEmail);
    const requiresThirdParty = incidentConfig
        ? Boolean(incidentConfig.thirdPartyStep)
        : requiresThirdPartyFor.includes(String(form.incidentType || ''));
    const thirdPartyAnswered = !requiresThirdParty || ['yes', 'no'].includes(String(form.thirdPartyInvolved || '').toLowerCase());
    let thirdPartyDetailsValid = true;
    if (requiresThirdParty && !thirdPartyAnswered) {
        fieldErrors.thirdPartyInvolved = 'Please choose whether a third party was involved';
    }
    if (requiresThirdParty && String(form.thirdPartyInvolved || '').toLowerCase() === 'yes') {
        const counts = form.thirdPartyCounts || { another_car: 0, pedestrian: 0, property: 0 };
        const selectedKinds = Object.entries(counts)
            .filter(([, n]) => Number(n) > 0)
            .map(([k]) => k);
        if (selectedKinds.length === 0) {
            fieldErrors.thirdPartyKinds = 'Please select at least one third party type';
            thirdPartyDetailsValid = false;
        }
        for (let i = 0; i < Number(counts.another_car || 0); i += 1) {
            const car = form.thirdPartyAnotherCars[i] || { fullName: '', telephone: '', plate: '', make: '', model: '', insurerName: '' };
            const fullName = String(car.fullName || '').trim();
            const phone = String(car.telephone || '').trim();
            const insurer = String(car.insurerName || '').trim();
            const plate = String(car.plate || '').trim();
            const make = String(car.make || '').trim();
            const model = String(car.model || '').trim();
            if (fullName.length < 2 || insurer.length < 2 || (!plate && !(make && model)) || (plate && plate.length < 3)) {
                fieldErrors.thirdPartyAnotherCarDetails = 'Complete all required Another car details.';
                thirdPartyDetailsValid = false;
                break;
            }
            const phoneErr = hasPhoneShapeError(phone);
            if (phoneErr) {
                fieldErrors.thirdPartyAnotherCarDetails = phoneErr;
                thirdPartyDetailsValid = false;
                break;
            }
        }
        for (let i = 0; i < Number(counts.pedestrian || 0); i += 1) {
            const person = form.thirdPartyPedestrians[i] || { fullName: '', telephone: '' };
            const fullName = String(person.fullName || '').trim();
            const phone = String(person.telephone || '').trim();
            if (fullName.length < 2) {
                fieldErrors.thirdPartyPedestrianDetails = 'Complete all required Pedestrian details.';
                thirdPartyDetailsValid = false;
                break;
            }
            const phoneErr = hasPhoneShapeError(phone);
            if (phoneErr) {
                fieldErrors.thirdPartyPedestrianDetails = phoneErr;
                thirdPartyDetailsValid = false;
                break;
            }
        }
        for (let i = 0; i < Number(counts.property || 0); i += 1) {
            const property = form.thirdPartyProperties[i] || { fullName: '', telephone: '' };
            const fullName = String(property.fullName || '').trim();
            const phone = String(property.telephone || '').trim();
            if (fullName.length < 2) {
                fieldErrors.thirdPartyPropertyDetails = 'Complete all required Property details.';
                thirdPartyDetailsValid = false;
                break;
            }
            const phoneErr = hasPhoneShapeError(phone);
            if (phoneErr) {
                fieldErrors.thirdPartyPropertyDetails = phoneErr;
                thirdPartyDetailsValid = false;
                break;
            }
        }
    }
    const requiresPoliceRef =
        requiresPoliceFor.includes(String(form.incidentType || ''));
    if (requiresPoliceRef && !['yes', 'no'].includes(String(form.policeInvolved || '').toLowerCase())) {
        fieldErrors.policeInvolved = 'Please confirm whether police were involved';
    }
    if (requiresPoliceRef && String(form.policeInvolved || '').toLowerCase() !== 'yes') {
        fieldErrors.policeInvolved = 'Police involvement is required for theft / hit-and-run claims';
    }
    if (
        requiresPoliceRef &&
        String(form.policeInvolved || '').toLowerCase() === 'yes' &&
        !String(form.policeReportNumber || '').trim()
    ) {
        fieldErrors.policeReportNumber = 'Please provide police report number';
    }
    const policeValidationOk = !fieldErrors.policeInvolved && !fieldErrors.policeReportNumber;
    if (!['yes', 'no'].includes(String(form.carDrivable || '').toLowerCase())) {
        fieldErrors.carDrivable = 'Please confirm whether the car is drivable';
    }
    if (!['yes', 'no'].includes(String(form.injuriesReported || '').toLowerCase())) {
        fieldErrors.injuriesReported = 'Please confirm whether injuries were reported';
    }
    const canContinueStep4 = Boolean(
        thirdPartyAnswered &&
        thirdPartyDetailsValid &&
        policeValidationOk &&
        !fieldErrors.carDrivable &&
        !fieldErrors.injuriesReported
    );
    const canContinueStep5 = Boolean(
        descriptionTrimmed.length >= minDescriptionLength &&
        !fieldErrors.description
    );
    const canSubmit =
        canContinueStep1 &&
        canContinueStep2 &&
        canContinueStep3 &&
        canContinueStep4 &&
        canContinueStep5 &&
        selectedDriverReady &&
        !fieldErrors.description &&
        !fieldErrors.driverHasPermission &&
        !fieldErrors.driverLicenseYearsHeld &&
        !fieldErrors.driverLicenseIssuedCountry &&
        form.declarationAccepted;

    return {
        canContinueStep1,
        canContinueStep2,
        canContinueStep3,
        canContinueStep4,
        canContinueStep5,
        canSubmit,
        hasValidNamedDriver,
        descriptionTrimmed,
        incidentDateValid,
        fieldErrors,
    };
}

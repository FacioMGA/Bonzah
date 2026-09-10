/**
 * clientFnol.submit — Pure submit payload construction + incident config
 *
 * No React hooks. No state. No side effects.
 * Owns: FNOL payload shaping, incident card definitions, driver display names.
 */
import React from 'react';
import { CarFront, CarTaxiFront, FileText, ShieldAlert } from 'lucide-react';
import type { FnolForm, NamedDriver } from '../model/clientFnol.types';
import { ANOTHER_DRIVER_ID } from '../model/clientFnol.types';
import type { FnolUploadBuckets } from '../views/clientFnol.sections';

// ── Incident card config ──

export const FALLBACK_INCIDENT_CARDS: Array<{ id: FnolForm['incidentType']; label: string; icon: React.ReactNode; blurb: string }> = [
    { id: 'collision', label: 'Collision', icon: React.createElement(CarFront, { className: 'h-5 w-5' }), blurb: 'Another vehicle or road-user involved.' },
    { id: 'theft', label: 'Theft', icon: React.createElement(ShieldAlert, { className: 'h-5 w-5' }), blurb: 'Stolen vehicle, keys, or attempted theft.' },
    { id: 'damage_parked', label: 'Damage while parked', icon: React.createElement(CarTaxiFront, { className: 'h-5 w-5' }), blurb: 'Vehicle damaged while unattended.' },
    { id: 'windscreen', label: 'Windscreen', icon: React.createElement(CarFront, { className: 'h-5 w-5' }), blurb: 'Glass chip, crack, or replacement required.' },
    { id: 'weather', label: 'Weather', icon: React.createElement(CarFront, { className: 'h-5 w-5' }), blurb: 'Hail, flood, storm, or weather damage.' },
    { id: 'vandalism', label: 'Vandalism', icon: React.createElement(FileText, { className: 'h-5 w-5' }), blurb: 'Intentional damage by unknown/known third party.' },
    { id: 'other', label: 'Other', icon: React.createElement(FileText, { className: 'h-5 w-5' }), blurb: 'Anything outside the standard scenarios.' },
];

// ── Payload builder ──

/**
 * Build the canonical FNOL submit payload.
 *
 * `spine/v2` Wave 5: emits ONE shape, matching the backend's
 * `CanonicalIntakeSchema` (`backend/modules/claims/domain/intakeCanonical.ts`).
 * Pre-Wave 5 this builder returned a `{ fnolPayload, finalForm }` pair —
 * the first carried flat aliases (`incidentDate`, `description`,
 * `lossLocation`) over a nested `fnol.incident.*` shape, the second
 * mirrored the data again at top level. The BE then accepted both
 * via a 60-line alias-resolution function, which was the drift surface
 * the reviewer flagged.
 *
 * The new contract:
 *   - One payload, top-level `{ incident, driver, thirdParty, police,
 *     triage, evidence, declarationAccepted, schemaVersion, mode }`.
 *   - All three FE submit endpoints (`submitFnol`, `submitFnolFinal`,
 *     `submitPublicFnol`) send `{ form: intake }`.
 *   - Backend normalize pass becomes a thin schema parse — no aliases.
 */
export function buildFnolSubmitPayload(args: {
    form: FnolForm;
    descriptionTrimmed: string;
    selectedDriver: NamedDriver | null;
    selectedThirdPartyKinds: string[];
    uploads: FnolUploadBuckets;
}) {
    const { form, descriptionTrimmed, selectedDriver, selectedThirdPartyKinds, uploads } = args;
    const driverDisplayName = form.driverId === ANOTHER_DRIVER_ID
        ? [form.unauthorizedDriverFirstName, form.unauthorizedDriverLastName].filter(Boolean).join(' ').trim() || 'Unauthorized driver'
        : (selectedDriver?.name || 'Unknown');
    const claimContactPhone =
        form.driverId === ANOTHER_DRIVER_ID ? form.unauthorizedDriverPhone : form.driverContactPhone;
    const claimContactEmail =
        form.driverId === ANOTHER_DRIVER_ID ? form.unauthorizedDriverEmail : form.driverContactEmail;

    const intake = {
        schemaVersion: 2,
        mode: 'guided_incident_flow',
        incident: {
            type: form.incidentType,
            date: form.incidentDate,
            time: form.incidentTime || null,
            location: {
                address: form.location || null,
                city: form.city || null,
                country: form.country || null,
            },
            description: descriptionTrimmed,
        },
        driver: {
            id: form.driverId,
            kind: form.driverId === ANOTHER_DRIVER_ID ? 'unauthorized' : 'named',
            name: driverDisplayName || null,
            dateOfBirth: form.driverId === ANOTHER_DRIVER_ID ? (form.unauthorizedDriverDateOfBirth || null) : (selectedDriver?.dateOfBirth || null),
            hasPermission: form.driverId === ANOTHER_DRIVER_ID ? form.driverHasPermission === 'yes' : true,
            contact: {
                phone: claimContactPhone || selectedDriver?.phone || null,
                email: claimContactEmail || selectedDriver?.email || null,
            },
            license: {
                yearsHeld: form.driverLicenseYearsHeld ? Number(form.driverLicenseYearsHeld) : null,
                issuedCountry: form.driverLicenseIssuedCountry || null,
            },
        },
        thirdParty: {
            involved: form.thirdPartyInvolved === 'yes',
            counts: {
                anotherCar: form.thirdPartyCounts.another_car,
                pedestrian: form.thirdPartyCounts.pedestrian,
                property: form.thirdPartyCounts.property,
            },
            kinds: selectedThirdPartyKinds,
            anotherCars: form.thirdPartyInvolved === 'yes' ? form.thirdPartyAnotherCars.slice(0, form.thirdPartyCounts.another_car) : [],
            pedestrians: form.thirdPartyInvolved === 'yes' ? form.thirdPartyPedestrians.slice(0, form.thirdPartyCounts.pedestrian) : [],
            properties: form.thirdPartyInvolved === 'yes' ? form.thirdPartyProperties.slice(0, form.thirdPartyCounts.property) : [],
        },
        police: {
            involved: form.policeInvolved === 'yes',
            reportNumber: form.policeReportNumber || null,
            station: form.policeStation || null,
        },
        triage: {
            carDrivable: form.carDrivable === 'yes' ? true : form.carDrivable === 'no' ? false : null,
            needTow: false,
            injuriesReported: form.injuriesReported === 'yes' ? true : form.injuriesReported === 'no' ? false : null,
        },
        evidence: {
            accidentLocation: uploads.accidentLocation.map((u) => u.filename || u.url).filter(Boolean),
            vehicleDamage: uploads.vehicleDamage.map((u) => u.filename || u.url).filter(Boolean),
            policeReport: uploads.policeReport.map((u) => u.filename || u.url).filter(Boolean),
            drivingLicence: uploads.drivingLicence.map((u) => u.filename || u.url).filter(Boolean),
            vehicleRegistrationCertificate: uploads.vehicleRegistrationCertificate.map((u) => u.filename || u.url).filter(Boolean),
        },
        declarationAccepted: form.declarationAccepted,
    };

    return { intake, driverDisplayName };
}

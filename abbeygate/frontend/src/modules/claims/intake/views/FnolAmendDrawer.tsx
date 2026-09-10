import { Card, Select, Toast } from '@/src/shared/ui';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { WizardInput as Input } from '@/src/shared/ui';
import AddressAutocomplete from '@/src/shared/components/AddressAutocomplete';
import { claimsApiClient as api } from '@/src/modules/claims/api/claimsApiClient';
import { policyCrudApiClient } from '@/src/modules/policies/api/policyCrudApiClient';
import { documentsApiClient } from '@/src/modules/policies/api/documentsApiClient';
import type { Worksheet } from '@/src/modules/claims/case/model/worksheetTypes';
import type { ClaimsContractDto, NamedDriver, FnolForm, FnolFieldErrors } from '../model/clientFnol.types';
import { clampE164Phone, formatFnolDateForDisplay, normalizeFnolUploadItems } from '../views/clientFnol.helpers';
import { computeFnolEligibility } from '../validation/clientFnol.validation';
import { resolveFnolGuidedRules } from '../validation/clientFnol.rules';
import { extractNamedDriversForPolicy } from '../model/clientFnol.model';
import { ClientFormField, StepFourThirdPartyServices, StepReviewSection, StepSixDescriptionEvidence, type FnolUploadBuckets } from '../views/clientFnol.sections';
import { PhoneInputField } from '@/src/shared/ui';
import { REGION_CONFIG } from '@/src/shared/config/region';
import { asRecord } from '@/src/shared/lib/record';
import { useFnolGuidedFlowCore } from '../hooks/useFnolGuidedFlowCore';
import { buildFnolSubmitPayload } from '../actions/clientFnol.submit';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  worksheet: Worksheet;
  fallbackSnapshot: Record<string, unknown>;
  busy: boolean;
  forceGuidedManual?: boolean;
  onSubmitAmend: (fnol: Record<string, unknown>, changes: Array<{ path: string; from: unknown; to: unknown }>) => Promise<void> | void;
};
const ANOTHER_DRIVER_ID = '__another_driver__';

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => asRecord(acc)[segment], source);
}

function readText(source: Record<string, unknown>, paths: string[]): string {
  for (const path of paths) {
    const text = String(readPath(source, path) ?? '').trim();
    if (text) return text;
  }
  return '';
}

function readYesNo(source: Record<string, unknown>, paths: string[]): '' | 'yes' | 'no' {
  for (const path of paths) {
    const value = readPath(source, path);
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    const text = String(value ?? '').trim().toLowerCase();
    if (text === 'yes' || text === 'true') return 'yes';
    if (text === 'no' || text === 'false') return 'no';
  }
  return '';
}

function toUploadItems(value: unknown): FnolUploadBuckets[keyof FnolUploadBuckets] {
  return normalizeFnolUploadItems(value);
}

function snapshotUploadValues(snapshot: Record<string, unknown>, key: keyof FnolUploadBuckets): unknown[] {
  const aliasByKey: Record<keyof FnolUploadBuckets, string[]> = {
    accidentLocation: ['accidentLocation'],
    vehicleDamage: ['vehicleDamage', 'vehicleDamageDetails'],
    policeReport: ['policeReport', 'policeReportDetails'],
    drivingLicence: ['drivingLicence'],
    vehicleRegistrationCertificate: ['vehicleRegistrationCertificate'],
  };
  const paths = [
    ...aliasByKey[key].map((alias) => `uploads.${alias}`),
    ...aliasByKey[key].map((alias) => `evidence.${alias}`),
  ];
  return paths.flatMap((path) => (Array.isArray(readPath(snapshot, path)) ? (readPath(snapshot, path) as unknown[]) : []));
}

function createDefaultFnolForm(): FnolForm {
  return {
    driverId: '',
    driverContactPhone: '',
    driverContactEmail: '',
    unauthorizedDriverFirstName: '',
    unauthorizedDriverLastName: '',
    unauthorizedDriverDateOfBirth: '',
    unauthorizedDriverPhone: '',
    unauthorizedDriverEmail: '',
    incidentDate: new Date().toISOString().slice(0, 10),
    incidentTime: '',
    location: '',
    city: '',
    country: 'Cyprus',
    incidentType: 'collision',
    description: '',
    thirdPartyInvolved: '',
    thirdPartyCounts: { another_car: 0, pedestrian: 0, property: 0 },
    thirdPartyAnotherCars: [],
    thirdPartyPedestrians: [],
    thirdPartyProperties: [],
    policeInvolved: '',
    policeReportNumber: '',
    policeStation: '',
    driverHasPermission: '',
    driverLicenseYearsHeld: '',
    driverLicenseIssuedCountry: '',
    carDrivable: '',
    injuriesReported: '',
    declarationAccepted: false,
  };
}

function hydrateGuidedForm(snapshot: Record<string, unknown>): FnolForm {
  const defaults = createDefaultFnolForm();
  const driverName = readText(snapshot, ['driver.name']);
  const [firstName, ...rest] = driverName.split('').filter(Boolean);
  const counts = asRecord(readPath(snapshot, 'thirdParty.counts'));
  return {
    ...defaults,
    incidentType: readText(snapshot, ['incident.type']) as FnolForm['incidentType'] || defaults.incidentType,
    incidentDate: readText(snapshot, ['incident.date']) || defaults.incidentDate,
    incidentTime: readText(snapshot, ['incident.time']),
    location: readText(snapshot, ['incident.location.address', 'incident.location']),
    city: readText(snapshot, ['incident.location.city', 'incident.city']),
    country: readText(snapshot, ['incident.location.country', 'incident.country']) || defaults.country,
    description: readText(snapshot, ['incident.description', 'description', 'narrative']),
    driverId: readText(snapshot, ['driver.id']),
    driverContactPhone: readText(snapshot, ['driver.contact.phone', 'driver.phone']),
    driverContactEmail: readText(snapshot, ['driver.contact.email', 'driver.email']),
    unauthorizedDriverFirstName: firstName || '',
    unauthorizedDriverLastName: rest.join(''),
    unauthorizedDriverDateOfBirth: readText(snapshot, ['driver.dateOfBirth']),
    unauthorizedDriverPhone: readText(snapshot, ['driver.contact.phone', 'driver.phone']),
    unauthorizedDriverEmail: readText(snapshot, ['driver.contact.email', 'driver.email']),
    thirdPartyInvolved: readYesNo(snapshot, ['thirdParty.involved']),
    thirdPartyCounts: {
      another_car: Number(counts.anotherCar ?? 0) || 0,
      pedestrian: Number(counts.pedestrian ?? 0) || 0,
      property: Number(counts.property ?? 0) || 0,
    },
    thirdPartyAnotherCars: asArray(readPath(snapshot, 'thirdParty.anotherCars')),
    thirdPartyPedestrians: asArray(readPath(snapshot, 'thirdParty.pedestrians')),
    thirdPartyProperties: asArray(readPath(snapshot, 'thirdParty.properties')),
    policeInvolved: readYesNo(snapshot, ['police.involved']),
    policeReportNumber: readText(snapshot, ['police.reportNumber']),
    policeStation: readText(snapshot, ['police.station']),
    driverHasPermission: readYesNo(snapshot, ['driver.hasPermission']),
    driverLicenseYearsHeld: readText(snapshot, ['driver.license.yearsHeld', 'driver.licenseYears']),
    driverLicenseIssuedCountry: readText(snapshot, ['driver.license.issuedCountry', 'driver.licenseIssuedIn']),
    carDrivable: readYesNo(snapshot, ['triage.carDrivable']),
    injuriesReported: readYesNo(snapshot, ['triage.injuriesReported']),
    declarationAccepted: Boolean(readPath(snapshot, 'declarationAccepted')),
  };
}

export function FnolAmendDrawer({ isOpen, onClose, worksheet, fallbackSnapshot, busy, forceGuidedManual = false, onSubmitAmend }: Props) {
  const baseSnapshot = useMemo(
    () => ((worksheet.intake?.fnol as Record<string, unknown>) || fallbackSnapshot || {}),
    [worksheet.intake?.fnol, fallbackSnapshot],
  );
  const [acknowledgedReconfirmRisk, setAcknowledgedReconfirmRisk] = useState(false);

  const isConfirmedIntake = worksheet.intake?.status === 'FNOL_CONFIRMED';
  const blockedByReconfirmGuard = isConfirmedIntake && !acknowledgedReconfirmRisk;
  const hasMeaningfulValue = (value: unknown): boolean => {
    if (value == null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item));
    if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some((item) => hasMeaningfulValue(item));
    return false;
  };
  const isManualEntry = forceGuidedManual || !hasMeaningfulValue(baseSnapshot);
  const useGuidedIntakeFlow = !blockedByReconfirmGuard;

  const defaultPhoneCountry =
    REGION_CONFIG.defaultRegionCode === 'US' ? 'US' :
      REGION_CONFIG.defaultRegionCode === 'GB' ? 'GB' :
        REGION_CONFIG.defaultRegionCode === 'CY' ? 'CY' :
          REGION_CONFIG.defaultRegionCode === 'PT' ? 'PT' :
            REGION_CONFIG.defaultRegionCode === 'ES' ? 'ES' :
              undefined;
  const phoneInputClass = (hasError: boolean) =>
    `w-full text-[15px] ${hasError ? 'border-red-500/70 ring-4 ring-red-500/10' : ''} [&_.PhoneInputInput]:bg-transparent [&_.PhoneInputInput]:outline-none [&_.PhoneInputInput]:flex-1 [&_.PhoneInputInput]:min-w-0 [&_.PhoneInputInput]:w-0 [&_.PhoneInputInput]:border-0 [&_.PhoneInputInput]:shadow-none [&_.PhoneInputInput]:ring-0 [&_.PhoneInputInput]:font-semibold [&_.PhoneInputInput]:text-slate-700 [&_.PhoneInputCountry]:mr-2 [&_.PhoneInputCountry]:shrink-0 [&_.PhoneInputCountrySelect]:bg-transparent [&_.PhoneInputCountrySelect]:border-0 [&_.PhoneInputCountrySelect]:shadow-none [&_.PhoneInputCountrySelect]:outline-none [&_.PhoneInputCountrySelect]:ring-0`;
  const [claimsContract, setClaimsContract] = useState<ClaimsContractDto | null>(null);
  const [policyData, setPolicyData] = useState<Record<string, unknown> | null>(null);
  const [namedDrivers, setNamedDrivers] = useState<NamedDriver[]>([]);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSaving, setManualSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [uploads, setUploads] = useState<FnolUploadBuckets>({
    accidentLocation: [],
    vehicleDamage: [],
    policeReport: [],
    drivingLicence: [],
    vehicleRegistrationCertificate: [],
  });
  const [manualForm, setManualFormState] = useState<FnolForm>({
    ...createDefaultFnolForm(),
  });

  useEffect(() => {
    if (!isOpen || !useGuidedIntakeFlow) return;
    setManualFormState(hydrateGuidedForm(baseSnapshot));
    setUploads({
      accidentLocation: toUploadItems(snapshotUploadValues(baseSnapshot, 'accidentLocation')),
      vehicleDamage: toUploadItems(snapshotUploadValues(baseSnapshot, 'vehicleDamage')),
      policeReport: toUploadItems(snapshotUploadValues(baseSnapshot, 'policeReport')),
      drivingLicence: toUploadItems(snapshotUploadValues(baseSnapshot, 'drivingLicence')),
      vehicleRegistrationCertificate: toUploadItems(snapshotUploadValues(baseSnapshot, 'vehicleRegistrationCertificate')),
    });
  }, [isOpen, useGuidedIntakeFlow, baseSnapshot]);

  const selectedDriver = useMemo(
    () => namedDrivers.find((d) => d.id === manualForm.driverId) || null,
    [namedDrivers, manualForm.driverId],
  );
  const eligibility = useMemo(
    () => computeFnolEligibility({
      policyId: String(worksheet.policyId || ''),
      namedDrivers,
      form: manualForm,
      contract: claimsContract,
    }),
    [worksheet.policyId, namedDrivers, manualForm, claimsContract],
  );
  const guidedRules = useMemo(
    () => resolveFnolGuidedRules({ contract: claimsContract, incidentType: manualForm.incidentType }),
    [claimsContract, manualForm.incidentType],
  );
  const {
    step,
    setStep,
    nextStep,
    prevStep,
    setShowValidationErrors,
    setChangedFields,
    setFormTracked: setManualForm,
    visibleFieldErrors,
  } = useFnolGuidedFlowCore({
    totalSteps: 6,
    canContinueByStep: {
      1: eligibility.canContinueStep1,
      2: eligibility.canContinueStep2,
      3: eligibility.canContinueStep3,
      4: eligibility.canContinueStep4,
      5: eligibility.canContinueStep5,
    },
    computedFieldErrors: eligibility.fieldErrors as Record<string, string | undefined>,
    groupedFieldSources: {
      thirdPartyKinds: ['thirdPartyCounts'],
      thirdPartyAnotherCarDetails: ['thirdPartyAnotherCars', 'thirdPartyCounts'],
      thirdPartyPedestrianDetails: ['thirdPartyPedestrians', 'thirdPartyCounts'],
      thirdPartyPropertyDetails: ['thirdPartyProperties', 'thirdPartyCounts'],
    },
    formState: manualForm,
    setFormState: setManualFormState,
  });
  const fieldErrors = visibleFieldErrors as FnolFieldErrors;

  useEffect(() => {
    if (isOpen) {
      setAcknowledgedReconfirmRisk(false);
      setStep(1);
      setManualError(null);
      setShowValidationErrors(false);
      setChangedFields({});
    }
  }, [isOpen, setChangedFields, setShowValidationErrors, setStep]);

  useEffect(() => {
    if (!isOpen || !useGuidedIntakeFlow || !worksheet.policyId) return;
    (async () => {
      const [policyRes, contractRes] = await Promise.all([
        policyCrudApiClient.getPolicy(String(worksheet.policyId)),
        api.getPolicyClaimsContract(String(worksheet.policyId)),
      ]);
      if (policyRes.success && policyRes.data) {
        setPolicyData(policyRes.data);
        const drivers = extractNamedDriversForPolicy(policyRes.data);
        setNamedDrivers(drivers);
        if (drivers[0]) {
          setManualForm((prev) => ({
            ...prev,
            driverId: prev.driverId || drivers[0].id,
            driverContactPhone: prev.driverContactPhone || clampE164Phone(drivers[0].phone || ''),
            driverContactEmail: prev.driverContactEmail || String(drivers[0].email || ''),
          }));
        }
      }
      if (contractRes.success && contractRes.data) {
        setClaimsContract(contractRes.data.contract || null);
      }
    })().catch(() => undefined);
  }, [isOpen, setManualForm, useGuidedIntakeFlow, worksheet.policyId]);

  const upload = async (bucket: keyof FnolUploadBuckets, file: File) => {
    setManualError(null);
    try {
      const res = await documentsApiClient.uploadPublicDocument(file);
      if (!res.success || !res.data) throw new Error(res.error?.message || 'Upload failed');
      const url = String((res.data as { url?: string }).url || '');
      const filename = (res.data as { filename?: string }).filename;
      setUploads((prev) => ({ ...prev, [bucket]: [...prev[bucket], { name: file.name, url, filename }] }));
    } catch (e) {
      setManualError((e as Error).message || `Failed to upload ${file.name}`);
    }
  };
  const uploadMany = async (bucket: keyof FnolUploadBuckets, files: File[]) => {
    for (const f of files) await upload(bucket, f);
  };
  const buildManualFnolPayload = (): Record<string, unknown> => {
    // ABY-305 / ABY-301: emit the canonical `CanonicalIntakeSchema` shape via
    // the single shared builder. Pre-fix this drawer used a parallel inline
    // implementation that sent `incident.location` as a plain string with
    // `incident.city` / `incident.country` as siblings; backend
    // `normalizeCanonicalIntake` rejected that with
    // `expected object, received string` on `incident.location`. One canonical
    // owner per concept (`contract-spine`) — both BO and customer-portal go
    // through `buildFnolSubmitPayload`.
    const selectedThirdPartyKinds = Object.entries(manualForm.thirdPartyCounts || {})
      .filter(([, n]) => Number(n) > 0)
      .map(([k]) => k);
    const { intake } = buildFnolSubmitPayload({
      form: manualForm,
      descriptionTrimmed: eligibility.descriptionTrimmed,
      selectedDriver,
      selectedThirdPartyKinds,
      uploads,
    });
    return intake as unknown as Record<string, unknown>;
  };

  const persistManualDraft = async (): Promise<boolean> => {
    setManualSaving(true);
    setManualError(null);
    try {
      await onSubmitAmend(buildManualFnolPayload(), []);
      return true;
    } catch (e) {
      setManualError((e as Error).message || 'Failed to save manual response');
      return false;
    } finally {
      setManualSaving(false);
    }
  };

  const submitManualResponse = async () => {
    if (!eligibility.canSubmit) {
      setShowValidationErrors(true);
      return;
    }
    await persistManualDraft();
  };

  const saveAndContinueLater = async () => {
    const saved = await persistManualDraft();
    if (saved) {
      setToastMessage('Draft saved. You can continue later.');
      setShowToast(true);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isManualEntry ? 'Record manual response' : (isConfirmedIntake ? 'Edit confirmed intake' : 'Edit intake details')}
      maxWidth="max-w-4xl"
    >
      <div className="space-y-4">
        <Toast
          message={toastMessage}
          isVisible={showToast}
          onClose={() => setShowToast(false)}
          type="success"
          duration={2200}
        />
        {useGuidedIntakeFlow ? (
          <div className="space-y-4">
            {manualError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">{manualError}</div>
            ) : null}
            <Card className="border-none p-4">
              <div className="text-xs font-black uppercase tracking-widest text-slate-400">Step {step} of 6</div>
              <div className="mt-2 w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-brand-primary transition-all" style={{ width: `${(step / 6) * 100}%` }} />
              </div>
            </Card>
            {step === 1 ? (
              <section className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
                <h3 className="text-xl font-black text-slate-900">What happened?</h3>
                <ClientFormField label="Incident type" required error={undefined}>
                  <Select value={manualForm.incidentType} onChange={(e) => setManualForm((p) => ({ ...p, incidentType: e.target.value as FnolForm['incidentType'] }))}>
                    {(claimsContract?.fnol?.incidentTypes || [
                      { id: 'collision', label: 'Collision' }, { id: 'theft', label: 'Theft' }, { id: 'damage_parked', label: 'Damage while parked' },
                      { id: 'windscreen', label: 'Windscreen' }, { id: 'weather', label: 'Weather' }, { id: 'vandalism', label: 'Vandalism' }, { id: 'other', label: 'Other' },
                    ]).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </Select>
                </ClientFormField>
              </section>
            ) : null}
            {step === 2 ? (
              <section className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
                <h3 className="text-xl font-black text-slate-900">When and where did it happen?</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <ClientFormField label="Date" required error={fieldErrors.incidentDate}>
                    <Input type="date" value={manualForm.incidentDate} onValueChange={(next) => setManualForm((p) => ({ ...p, incidentDate: next }))} />
                  </ClientFormField>
                  <ClientFormField label="Time (optional)">
                    <Input type="time" value={manualForm.incidentTime} onChange={(e) => setManualForm((p) => ({ ...p, incidentTime: e.target.value }))} />
                  </ClientFormField>
                  <ClientFormField label="Location" required error={fieldErrors.location}>
                    <AddressAutocomplete
                      value={manualForm.location}
                      onChange={(val) => setManualForm((p) => ({ ...p, location: val }))}
                      onAddressSelect={(addr) => {
                        setManualForm((p) => ({
                          ...p,
                          location: addr.address || p.location,
                          city: addr.city || p.city,
                          country: addr.country || p.country,
                        }));
                      }}
                      placeholder="Search address or place"
                      inputVariant="ui"
                      className={`!h-controlLg !py-0 text-[15px] !bg-slate-50/50 ${fieldErrors.location ? 'border-red-500/70 !important ring-4 ring-red-500/10' : ''}`}
                    />
                  </ClientFormField>
                  <ClientFormField label="City" required error={fieldErrors.city}>
                    <Input value={manualForm.city} onChange={(e) => setManualForm((p) => ({ ...p, city: e.target.value }))} />
                  </ClientFormField>
                  <ClientFormField label="Country" required error={fieldErrors.country}>
                    <Input value={manualForm.country} onChange={(e) => setManualForm((p) => ({ ...p, country: e.target.value }))} />
                  </ClientFormField>
                </div>
              </section>
            ) : null}
            {step === 3 ? (
              <section className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
                <h3 className="text-xl font-black text-slate-900">Who was driving?</h3>
                <ClientFormField label="Driver involved" required error={fieldErrors.driverId}>
                  <Select
                    className={`${fieldErrors.driverId ? 'border-red-500/70 ring-4 ring-red-500/10' : ''}`}
                    value={manualForm.driverId}
                    onChange={(e) => {
                      const v = String(e.target.value || '');
                      const picked = namedDrivers.find((d) => d.id === v) || null;
                      setManualForm((p) => ({
                        ...p,
                        driverId: v,
                        driverContactPhone: v === ANOTHER_DRIVER_ID ? p.driverContactPhone : (clampE164Phone(picked?.phone || '') || p.driverContactPhone || ''),
                        driverContactEmail: v === ANOTHER_DRIVER_ID ? p.driverContactEmail : (picked?.email || p.driverContactEmail || ''),
                      }));
                    }}
                  >
                    {namedDrivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    <option value={ANOTHER_DRIVER_ID}>Another driver</option>
                  </Select>
                </ClientFormField>
                {manualForm.driverId !== ANOTHER_DRIVER_ID ? (
                  <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                    <div className="text-xs uppercase tracking-wide font-black text-slate-500">Named driver on policy</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Input value={selectedDriver?.name || '—'} disabled />
                      <Input value={formatFnolDateForDisplay(selectedDriver?.dateOfBirth || '') || '—'} disabled />
                      <ClientFormField label="Driver claims contact phone" error={fieldErrors.driverContactPhone}>
                        <PhoneInputField
                          international
                          defaultCountry={defaultPhoneCountry}
                          value={manualForm.driverContactPhone || ''}
                          limitMaxLength
                          countryCallingCodeEditable={false}
                          onChange={(v: string | undefined) => setManualForm((p) => ({ ...p, driverContactPhone: clampE164Phone(v || '') }))}
                          className={phoneInputClass(Boolean(fieldErrors.driverContactPhone))}
                          placeholder="Driver claims contact phone (editable)"
                        />
                      </ClientFormField>
                      <ClientFormField label="Driver claims contact email" error={fieldErrors.driverContactEmail}>
                        <Input type="email" value={manualForm.driverContactEmail} onChange={(e) => setManualForm((p) => ({ ...p, driverContactEmail: e.target.value }))} />
                      </ClientFormField>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                    <div className="text-xs uppercase tracking-wide font-black text-slate-500">Another driver</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <ClientFormField label="First name" required error={fieldErrors.unauthorizedDriverFirstName}>
                        <Input value={manualForm.unauthorizedDriverFirstName} onChange={(e) => setManualForm((p) => ({ ...p, unauthorizedDriverFirstName: e.target.value }))} />
                      </ClientFormField>
                      <ClientFormField label="Last name" required error={fieldErrors.unauthorizedDriverLastName}>
                        <Input value={manualForm.unauthorizedDriverLastName} onChange={(e) => setManualForm((p) => ({ ...p, unauthorizedDriverLastName: e.target.value }))} />
                      </ClientFormField>
                      <ClientFormField label="Date of birth" required error={fieldErrors.unauthorizedDriverDateOfBirth}>
                        <Input type="date" value={manualForm.unauthorizedDriverDateOfBirth} onValueChange={(next) => setManualForm((p) => ({ ...p, unauthorizedDriverDateOfBirth: next }))} />
                      </ClientFormField>
                      <ClientFormField label="License years held" error={fieldErrors.driverLicenseYearsHeld}>
                        <Input
                          type="number"
                          min={0}
                          max={80}
                          value={manualForm.driverLicenseYearsHeld}
                          onChange={(e) => setManualForm((p) => ({ ...p, driverLicenseYearsHeld: e.target.value }))}
                        />
                      </ClientFormField>
                      <ClientFormField label="License issued country" error={fieldErrors.driverLicenseIssuedCountry}>
                        <Input value={manualForm.driverLicenseIssuedCountry} onChange={(e) => setManualForm((p) => ({ ...p, driverLicenseIssuedCountry: e.target.value }))} />
                      </ClientFormField>
                      <ClientFormField label="Driver claims contact phone" error={fieldErrors.unauthorizedDriverPhone}>
                        <PhoneInputField
                          international
                          defaultCountry={defaultPhoneCountry}
                          value={manualForm.unauthorizedDriverPhone || ''}
                          limitMaxLength
                          countryCallingCodeEditable={false}
                          onChange={(v: string | undefined) => setManualForm((p) => ({ ...p, unauthorizedDriverPhone: clampE164Phone(v || '') }))}
                          className={phoneInputClass(Boolean(fieldErrors.unauthorizedDriverPhone))}
                          placeholder="Driver claims contact phone (editable)"
                        />
                      </ClientFormField>
                      <div className="md:col-span-2">
                        <ClientFormField label="Driver claims contact email" error={fieldErrors.unauthorizedDriverEmail}>
                          <Input type="email" value={manualForm.unauthorizedDriverEmail} onChange={(e) => setManualForm((p) => ({ ...p, unauthorizedDriverEmail: e.target.value }))} />
                        </ClientFormField>
                      </div>
                      <div className="md:col-span-2">
                        <ClientFormField label="Driver had policyholder permission" required error={fieldErrors.driverHasPermission}>
                          <div className="flex items-center gap-6">
                            <label className="inline-flex items-center gap-2 font-semibold text-slate-700">
                              <Input
                                type="radio"
                                checked={manualForm.driverHasPermission === 'yes'}
                                onChange={() => setManualForm((p) => ({ ...p, driverHasPermission: 'yes' }))}
                              />
                              Yes
                            </label>
                            <label className="inline-flex items-center gap-2 font-semibold text-slate-700">
                              <Input
                                type="radio"
                                checked={manualForm.driverHasPermission === 'no'}
                                onChange={() => setManualForm((p) => ({ ...p, driverHasPermission: 'no' }))}
                              />
                              No
                            </label>
                          </div>
                        </ClientFormField>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            ) : null}
            {step === 4 ? (
              <StepFourThirdPartyServices
                form={manualForm}
                setForm={setManualForm}
                fieldErrors={fieldErrors}
                defaultPhoneCountry={defaultPhoneCountry}
                thirdPartyKinds={claimsContract?.fnol?.thirdPartyKinds}
                requiresThirdParty={guidedRules.requiresThirdParty}
                requiresPoliceRef={guidedRules.requiresPoliceRef}
                title="Third party & services"
              />
            ) : null}
            {step === 5 ? (
              <StepSixDescriptionEvidence
                form={manualForm}
                setForm={setManualForm}
                fieldErrors={fieldErrors}
                uploads={uploads}
                onUpload={uploadMany}
                onRemoveUpload={(bucket, idx) => setUploads((prev) => ({ ...prev, [bucket]: prev[bucket].filter((_, i) => i !== idx) }))}
              />
            ) : null}
            {step === 6 ? (
              <StepReviewSection
                form={manualForm}
                selectedPolicyLabel={String(policyData?.policyNumber || worksheet.policyNumber || '—')}
                selectedDriverName={selectedDriver?.name || '—'}
                anotherDriverName={[manualForm.unauthorizedDriverFirstName, manualForm.unauthorizedDriverLastName].filter(Boolean).join('') || 'Another driver'}
                anotherDriverId={ANOTHER_DRIVER_ID}
                canSubmit={eligibility.canSubmit}
                onToggleDeclaration={(checked) => setManualForm((p) => ({ ...p, declarationAccepted: checked }))}
              />
            ) : null}
            <div className="sticky bottom-0 bg-white/90 backdrop-blur border border-slate-200 rounded-2xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="px-0 py-0 font-semibold text-brand-primary underline underline-offset-2 hover:bg-transparent hover:text-brand-primary-600"
                  onClick={() => void saveAndContinueLater()}
                  disabled={busy || manualSaving}
                >
                  Save and continue later
                </Button>
                <div className="text-xs font-semibold text-slate-600">
                  {step < 6 ? 'Complete this step to continue.' : (eligibility.canSubmit ? `Ready to ${isManualEntry ? 'save manual response' : 'save intake details'}.` : 'Please complete required fields and declaration.')}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {step > 1 ? <Button variant="secondary" onClick={prevStep}>Back</Button> : null}
                {step < 6 ? (
                  <Button
                    onClick={nextStep}
                    disabled={
                      (step === 1 && !eligibility.canContinueStep1) ||
                      (step === 2 && !eligibility.canContinueStep2) ||
                      (step === 3 && !eligibility.canContinueStep3) ||
                      (step === 4 && !eligibility.canContinueStep4) ||
                      (step === 5 && !eligibility.canContinueStep5)
                    }
                  >
                    Continue
                  </Button>
                ) : (
                  <Button onClick={() => void submitManualResponse()} disabled={!eligibility.canSubmit} isLoading={manualSaving || busy}>
                    {isManualEntry ? 'Save manual response' : 'Save intake details'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : null}
        {blockedByReconfirmGuard ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 space-y-3">
            <div className="text-sm font-black text-amber-900">Changing confirmed intake details requires reconfirmation.</div>
            <div className="text-xs font-semibold text-amber-800">
              Changing these details will require reconfirmation before financial actions.
            </div>
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={() => setAcknowledgedReconfirmRisk(true)} disabled={busy}>
                Unconfirm and edit
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}


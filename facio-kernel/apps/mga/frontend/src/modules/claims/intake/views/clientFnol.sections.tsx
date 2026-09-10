import React from 'react';
import { AlertTriangle, Building2, CarFront, ShieldCheck, UserRound } from 'lucide-react';
import { WizardInput as Input } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { Input as UiInput } from '@/src/shared/ui';
import { PhoneInputField } from '@/src/shared/ui';
import { Textarea } from '@/src/shared/ui';
import { FileUpload } from '@/src/shared/ui';
import { fnolUploadDisplayName } from '../views/clientFnol.helpers';
import type { FnolForm, FnolFieldErrors, UploadItem } from '../model/clientFnol.types';

export type FnolUploadBuckets = {
  accidentLocation: UploadItem[];
  vehicleDamage: UploadItem[];
  policeReport: UploadItem[];
  drivingLicence: UploadItem[];
  vehicleRegistrationCertificate: UploadItem[];
};

export function ClientFormField({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="block mb-2 text-[14px] font-semibold text-slate-400 tracking-tight">
        {label}
        {required ? <span className="text-red-500 ml-0.5">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-red-600 text-xs mt-2 flex items-start gap-1">
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function StepFourThirdPartyServices(props: {
  form: FnolForm;
  setForm: React.Dispatch<React.SetStateAction<FnolForm>>;
  fieldErrors: FnolFieldErrors;
  defaultPhoneCountry: React.ComponentProps<typeof PhoneInputField>['defaultCountry'];
  thirdPartyKinds?: Array<{ id: string; label: string }>;
  requiresThirdParty?: boolean;
  requiresPoliceRef?: boolean;
  title?: string;
}) {
  const {
    form,
    setForm,
    fieldErrors,
    defaultPhoneCountry,
    thirdPartyKinds = [],
    requiresThirdParty = false,
    requiresPoliceRef = false,
    title,
  } = props;
  const kindOptions = (thirdPartyKinds.length
    ? thirdPartyKinds
    : [
      { id: 'another_car', label: 'Another car' },
      { id: 'pedestrian', label: 'Pedestrian' },
      { id: 'property', label: 'Property' },
    ]).filter((k) => ['another_car', 'pedestrian', 'property'].includes(k.id));
  const selectedThirdPartyKinds = Object.entries(form.thirdPartyCounts || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([kind]) => kind);
  const radioCardClass = (active: boolean) =>
    `rounded-2xl border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${active ? 'border-brand-primary bg-brand-primary/5 shadow-sm' : 'border-slate-300 ring-1 ring-slate-200/80'}`;
  const choiceTooltipClass = 'brand-radio-tooltip pointer-events-none hidden group-hover:block absolute left-1/2 top-0 -translate-x-1/2 -translate-y-[110%] bg-slate-900 text-white text-xs rounded-lg px-3 py-2 z-20 shadow-lg max-w-[min(320px,calc(100vw-2rem))] whitespace-normal text-center';
  const kindIcon = (id: string) =>
    id === 'another_car'
      ? <CarFront className="h-5 w-5" />
      : id === 'pedestrian'
        ? <UserRound className="h-5 w-5" />
        : <Building2 className="h-5 w-5" />;
  const setKindCount = (kind: 'another_car' | 'pedestrian' | 'property', delta: -1 | 1) => {
    setForm((prev) => {
      const next = Math.max(0, Math.min(3, Number((prev.thirdPartyCounts as Record<string, number>)[kind] || 0) + delta));
      const counts = { ...prev.thirdPartyCounts, [kind]: next };
      const ensureLength = <T,>(arr: T[], size: number, make: () => T): T[] => {
        if (arr.length >= size) return arr.slice(0, size);
        return [...arr, ...Array.from({ length: size - arr.length }, make)];
      };
      return {
        ...prev,
        thirdPartyCounts: counts,
        thirdPartyAnotherCars: ensureLength(
          prev.thirdPartyAnotherCars || [],
          counts.another_car || 0,
          () => ({ fullName: '', telephone: '', plate: '', make: '', model: '', insurerName: '' })
        ),
        thirdPartyPedestrians: ensureLength(
          prev.thirdPartyPedestrians || [],
          counts.pedestrian || 0,
          () => ({ fullName: '', telephone: '' })
        ),
        thirdPartyProperties: ensureLength(
          prev.thirdPartyProperties || [],
          counts.property || 0,
          () => ({ fullName: '', telephone: '' })
        ),
      };
    });
  };
  const updateAnotherCar = (idx: number, patch: Partial<FnolForm['thirdPartyAnotherCars'][number]>) =>
    setForm((prev) => ({
      ...prev,
      thirdPartyAnotherCars: (prev.thirdPartyAnotherCars || []).map((v, i) => (i === idx ? { ...v, ...patch } : v)),
    }));
  const updatePedestrian = (idx: number, patch: Partial<FnolForm['thirdPartyPedestrians'][number]>) =>
    setForm((prev) => ({
      ...prev,
      thirdPartyPedestrians: (prev.thirdPartyPedestrians || []).map((v, i) => (i === idx ? { ...v, ...patch } : v)),
    }));
  const updateProperty = (idx: number, patch: Partial<FnolForm['thirdPartyProperties'][number]>) =>
    setForm((prev) => ({
      ...prev,
      thirdPartyProperties: (prev.thirdPartyProperties || []).map((v, i) => (i === idx ? { ...v, ...patch } : v)),
    }));
  return (
    <section className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
      <h3 className="text-xl font-black text-slate-900">{title || 'Third party & services'}</h3>
      <div className="space-y-4">
        {requiresThirdParty ? (
          <>
            <ClientFormField label="Was a third party involved?" required error={fieldErrors.thirdPartyInvolved}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setForm((p) => ({ ...p, thirdPartyInvolved: 'yes' }))}
                  className={`group relative ${radioCardClass(form.thirdPartyInvolved === 'yes')}`}
                  aria-label="Yes. Capture third party details."
                >
                  <div className="flex items-center gap-2 font-black text-slate-900"><ShieldCheck className="h-5 w-5" />Yes</div>
                  <span role="tooltip" className={choiceTooltipClass}>
                    Capture third party details.
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setForm((p) => ({
                      ...p,
                      thirdPartyInvolved: 'no',
                      thirdPartyCounts: { another_car: 0, pedestrian: 0, property: 0 },
                      thirdPartyAnotherCars: [],
                      thirdPartyPedestrians: [],
                      thirdPartyProperties: [],
                    }))}
                  className={`group relative ${radioCardClass(form.thirdPartyInvolved === 'no')}`}
                  aria-label="No. Continue without third party capture."
                >
                  <div className="flex items-center gap-2 font-black text-slate-900"><AlertTriangle className="h-5 w-5" />No</div>
                  <span role="tooltip" className={choiceTooltipClass}>
                    Continue without third party capture.
                  </span>
                </Button>
              </div>
            </ClientFormField>
            {form.thirdPartyInvolved === 'yes' ? (
              <div className="space-y-4">
                <div className="md:col-span-2">
                  <ClientFormField label="Who else was involved?" required error={fieldErrors.thirdPartyKinds}>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {kindOptions.map((opt) => {
                        const key = opt.id as 'another_car' | 'pedestrian' | 'property';
                        const count = Number((form.thirdPartyCounts as Record<string, number>)[key] || 0);
                        const active = count > 0;
                        return (
                          <div
                            key={opt.id}
                            className={`rounded-2xl border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${active ? 'border-brand-primary bg-brand-primary/5 shadow-sm' : 'border-slate-300 ring-1 ring-slate-200/80'}`}
                          >
                            <div className="flex items-center gap-2 font-black text-slate-900">
                              {kindIcon(opt.id)}
                              {opt.label}
                            </div>
                            <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-300 ring-1 ring-slate-200/80 bg-white px-2 py-1">
                              <Button type="button" variant="ghost" size="sm" className="h-7 w-7 rounded-lg border border-slate-300 font-black text-slate-700 hover:bg-slate-50" onClick={() => setKindCount(key, -1)} disabled={count <= 0}>-</Button>
                              <div className="text-sm font-black text-slate-900">{count}</div>
                              <Button type="button" variant="ghost" size="sm" className="h-7 w-7 rounded-lg border border-slate-300 font-black text-slate-700 hover:bg-slate-50" onClick={() => setKindCount(key, 1)} disabled={count >= 3}>+</Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ClientFormField>
                </div>
                {selectedThirdPartyKinds.includes('another_car') && form.thirdPartyAnotherCars.map((car, idx) => (
                  <div key={`another-car-${idx}`} className="rounded-2xl border border-slate-300 ring-1 ring-slate-200/80 p-4">
                    <div className="text-sm font-black text-slate-900 mb-3">Another car #{idx + 1}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <ClientFormField label="Another car driver's full name" required error={fieldErrors.thirdPartyAnotherCarDetails}>
                        <Input value={car.fullName} onChange={(e) => updateAnotherCar(idx, { fullName: e.target.value })} placeholder="Full name" />
                      </ClientFormField>
                      <ClientFormField label="Telephone" error={fieldErrors.thirdPartyAnotherCarDetails}>
                        <PhoneInputField
                          international
                          defaultCountry={defaultPhoneCountry}
                          value={car.telephone || ''}
                          onChange={(value: string | undefined) => updateAnotherCar(idx, { telephone: String(value || '') })}
                          error={Boolean(fieldErrors.thirdPartyAnotherCarDetails)}
                          placeholder="Telephone"
                        />
                      </ClientFormField>
                      <ClientFormField label="Vehicle plate number" error={fieldErrors.thirdPartyAnotherCarDetails}>
                        <Input value={car.plate} onChange={(e) => updateAnotherCar(idx, { plate: e.target.value })} placeholder="Plate number" />
                      </ClientFormField>
                      <ClientFormField label="Insurer name" required error={fieldErrors.thirdPartyAnotherCarDetails}>
                        <Input value={car.insurerName} onChange={(e) => updateAnotherCar(idx, { insurerName: e.target.value })} placeholder="Insurer name" />
                      </ClientFormField>
                      <ClientFormField label="Vehicle make" error={fieldErrors.thirdPartyAnotherCarDetails}>
                        <Input value={car.make} onChange={(e) => updateAnotherCar(idx, { make: e.target.value })} placeholder="Vehicle make" />
                      </ClientFormField>
                      <ClientFormField label="Vehicle model" error={fieldErrors.thirdPartyAnotherCarDetails}>
                        <Input value={car.model} onChange={(e) => updateAnotherCar(idx, { model: e.target.value })} placeholder="Vehicle model" />
                      </ClientFormField>
                    </div>
                  </div>
                ))}
                {selectedThirdPartyKinds.includes('pedestrian') && form.thirdPartyPedestrians.map((person, idx) => (
                  <div key={`pedestrian-${idx}`} className="rounded-2xl border border-slate-300 ring-1 ring-slate-200/80 p-4">
                    <div className="text-sm font-black text-slate-900 mb-3">Pedestrian #{idx + 1}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <ClientFormField label="Full name" required error={fieldErrors.thirdPartyPedestrianDetails}>
                        <Input value={person.fullName} onChange={(e) => updatePedestrian(idx, { fullName: e.target.value })} placeholder="Full name" />
                      </ClientFormField>
                      <ClientFormField label="Telephone" error={fieldErrors.thirdPartyPedestrianDetails}>
                        <PhoneInputField
                          international
                          defaultCountry={defaultPhoneCountry}
                          value={person.telephone || ''}
                          onChange={(value: string | undefined) => updatePedestrian(idx, { telephone: String(value || '') })}
                          error={Boolean(fieldErrors.thirdPartyPedestrianDetails)}
                          placeholder="Telephone"
                        />
                      </ClientFormField>
                    </div>
                  </div>
                ))}
                {selectedThirdPartyKinds.includes('property') && form.thirdPartyProperties.map((property, idx) => (
                  <div key={`property-${idx}`} className="rounded-2xl border border-slate-300 ring-1 ring-slate-200/80 p-4">
                    <div className="text-sm font-black text-slate-900 mb-3">Property owner/contact #{idx + 1}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <ClientFormField label="Full name" required error={fieldErrors.thirdPartyPropertyDetails}>
                        <Input value={property.fullName} onChange={(e) => updateProperty(idx, { fullName: e.target.value })} placeholder="Full name" />
                      </ClientFormField>
                      <ClientFormField label="Telephone" error={fieldErrors.thirdPartyPropertyDetails}>
                        <PhoneInputField
                          international
                          defaultCountry={defaultPhoneCountry}
                          value={property.telephone || ''}
                          onChange={(value: string | undefined) => updateProperty(idx, { telephone: String(value || '') })}
                          error={Boolean(fieldErrors.thirdPartyPropertyDetails)}
                          placeholder="Telephone"
                        />
                      </ClientFormField>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
        <div className="pt-1">
          <ClientFormField label="Police involved?" required={requiresPoliceRef} error={fieldErrors.policeInvolved}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setForm((p) => ({ ...p, policeInvolved: 'yes' }))}
                className={`group relative ${radioCardClass(form.policeInvolved === 'yes')}`}
                aria-label="Yes. Provide report details."
              >
                <div className="flex items-center gap-2 font-black text-slate-900"><ShieldCheck className="h-5 w-5" />Yes</div>
                <span role="tooltip" className={choiceTooltipClass}>
                  Provide report details.
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setForm((p) => ({ ...p, policeInvolved: 'no', policeReportNumber: '', policeStation: '' }))}
                className={`group relative ${radioCardClass(form.policeInvolved === 'no')}`}
                aria-label="No. No police reference available."
              >
                <div className="flex items-center gap-2 font-black text-slate-900"><AlertTriangle className="h-5 w-5" />No</div>
                <span role="tooltip" className={choiceTooltipClass}>
                  No police reference available.
                </span>
              </Button>
            </div>
          </ClientFormField>

          {form.policeInvolved === 'yes' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ClientFormField label="Police report number" error={fieldErrors.policeReportNumber}>
                <Input
                  value={form.policeReportNumber}
                  onChange={(e) => setForm((p) => ({ ...p, policeReportNumber: e.target.value }))}
                  placeholder="Police reference"
                />
              </ClientFormField>
              <ClientFormField label="Police station (optional)">
                <Input
                  value={form.policeStation}
                  onChange={(e) => setForm((p) => ({ ...p, policeStation: e.target.value }))}
                  placeholder="Station name"
                />
              </ClientFormField>
            </div>
          ) : null}

          <ClientFormField label="Is the car drivable?">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setForm((p) => ({ ...p, carDrivable: 'yes' }))}
                className={`group relative ${radioCardClass(form.carDrivable === 'yes')}`}
                aria-label="Yes. Vehicle can be driven safely from scene."
              >
                <div className="flex items-center gap-2 font-black text-slate-900">
                  <CarFront className="h-5 w-5" />
                  Yes
                </div>
                <span role="tooltip" className={choiceTooltipClass}>
                  Vehicle can be driven safely from scene.
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setForm((p) => ({ ...p, carDrivable: 'no' }))}
                className={`group relative ${radioCardClass(form.carDrivable === 'no')}`}
                aria-label="No. Vehicle is not drivable and needs assistance."
              >
                <div className="flex items-center gap-2 font-black text-slate-900">
                  <AlertTriangle className="h-5 w-5" />
                  No
                </div>
                <span role="tooltip" className={choiceTooltipClass}>
                  Vehicle is not drivable and needs assistance.
                </span>
              </Button>
            </div>
          </ClientFormField>

          <ClientFormField label="Injuries reported?">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setForm((p) => ({ ...p, injuriesReported: 'yes' }))}
                className={`group relative ${radioCardClass(form.injuriesReported === 'yes')}`}
                aria-label="Yes. Injuries were reported at the incident."
              >
                <div className="flex items-center gap-2 font-black text-slate-900">
                  <AlertTriangle className="h-5 w-5" />
                  Yes
                </div>
                <span role="tooltip" className={choiceTooltipClass}>
                  Injuries were reported at the incident.
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setForm((p) => ({ ...p, injuriesReported: 'no' }))}
                className={`group relative ${radioCardClass(form.injuriesReported === 'no')}`}
                aria-label="No. No injuries were reported."
              >
                <div className="flex items-center gap-2 font-black text-slate-900">
                  <ShieldCheck className="h-5 w-5" />
                  No
                </div>
                <span role="tooltip" className={choiceTooltipClass}>
                  No injuries were reported.
                </span>
              </Button>
            </div>
          </ClientFormField>
        </div>
      </div>
    </section>
  );
}

export function StepSixDescriptionEvidence(props: {
  form: FnolForm;
  setForm: React.Dispatch<React.SetStateAction<FnolForm>>;
  fieldErrors: FnolFieldErrors;
  uploads: FnolUploadBuckets;
  onUpload: (bucket: keyof FnolUploadBuckets, files: File[]) => Promise<void>;
  onRemoveUpload: (bucket: keyof FnolUploadBuckets, idx: number) => void;
}) {
  const { form, setForm, fieldErrors, uploads, onUpload, onRemoveUpload } = props;
  const isPoliceReportRequired = String(form.policeInvolved || '').toLowerCase() === 'yes';
  const renderUploadField = (
    bucket: keyof FnolUploadBuckets,
    label: string,
    multi: boolean,
    required?: boolean
  ) => (
    <div className="rounded-2xl border border-slate-300 ring-1 ring-slate-200/80 p-4">
      <div className="text-sm font-black text-slate-900 mb-2">
        {label}{required ? <span className="text-red-500 ml-1">*</span> : null}
      </div>
      <FileUpload
        label={multi ? 'Upload files' : 'Upload file'}
        multiple={multi}
        onFileSelect={(f) => {
          void onUpload(bucket, f);
        }}
      />
      {uploads[bucket].length > 0 ? (
        <div className="mt-3 space-y-2">
          {uploads[bucket].map((u, idx) => (
            <div key={`${u.url}-${idx}`} className="text-sm font-semibold text-slate-700 flex items-center justify-between">
              {u.url ? (
                <a
                  href={u.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-brand-primary hover:underline underline-offset-2"
                  title={fnolUploadDisplayName(u)}
                >
                  {fnolUploadDisplayName(u)}
                </a>
              ) : (
                <span className="truncate">{fnolUploadDisplayName(u)}</span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-rose-700 font-black text-xs uppercase tracking-widest hover:underline"
                onClick={() => onRemoveUpload(bucket, idx)}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
      <h3 className="text-xl font-black text-slate-900">Description & Evidence</h3>
      <ClientFormField label="Incident description" required error={fieldErrors.description}>
        <Textarea
          className={`ui-input ${fieldErrors.description ? 'border-red-500/70 ring-4 ring-red-500/10' : ''}`}
          rows={6}
          placeholder="Briefly describe what happened."
          value={form.description}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
        />
      </ClientFormField>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {renderUploadField('accidentLocation', 'Location of the Accident', true)}
        {renderUploadField('vehicleDamage', 'Vehicle Damage Details', true)}
        {isPoliceReportRequired ? renderUploadField('policeReport', 'Police Report Details', true, true) : null}
        {renderUploadField('drivingLicence', 'Driving Licence', false)}
        {renderUploadField('vehicleRegistrationCertificate', 'Vehicle Registration Certificate', false)}
      </div>
    </section>
  );
}

export function StepReviewSection(props: {
  form: FnolForm;
  selectedPolicyLabel: string;
  selectedDriverName: string;
  anotherDriverName: string;
  anotherDriverId: string;
  canSubmit: boolean;
  onToggleDeclaration: (checked: boolean) => void;
}) {
  const {
    form,
    selectedPolicyLabel,
    selectedDriverName,
    anotherDriverName,
    anotherDriverId,
    canSubmit,
    onToggleDeclaration,
  } = props;
  const selectedKinds = Object.entries(form.thirdPartyCounts || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([kind]) => kind);
  const kindLabel = (kind: string) =>
    kind === 'another_car' ? 'Another car' : kind === 'pedestrian' ? 'Pedestrian' : kind === 'property' ? 'Property' : kind;

  return (
    <section className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4 animate-in fade-in duration-200">
      <h3 className="text-xl font-black text-slate-900">Review and submit</h3>
      <div className="rounded-2xl border border-slate-200 p-4 space-y-1 text-sm font-semibold text-slate-700">
        <div><span className="font-black text-slate-900">Policy:</span> {selectedPolicyLabel}</div>
        <div><span className="font-black text-slate-900">Date:</span> {form.incidentDate}</div>
        <div><span className="font-black text-slate-900">Location:</span> {form.location || '—'}</div>
        <div><span className="font-black text-slate-900">Type:</span> {String(form.incidentType).replace(/_/g, ' ')}</div>
        <div>
          <span className="font-black text-slate-900">Driver:</span>{' '}
          {form.driverId === anotherDriverId ? anotherDriverName : selectedDriverName}
        </div>
        {form.incidentType === 'collision' ? (
          <>
            <div>
              <span className="font-black text-slate-900">Third party involved:</span> {form.thirdPartyInvolved || '—'}
            </div>
            <div>
              <span className="font-black text-slate-900">Third party type(s):</span>{' '}
              {selectedKinds.map(kindLabel).join(', ') || '—'}
            </div>
            {selectedKinds.includes('another_car') && form.thirdPartyAnotherCars.slice(0, form.thirdPartyCounts.another_car).map((car, idx) => (
              <div key={`review-car-${idx}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3 mt-2">
                <div className="font-black text-slate-900">Another car #{idx + 1}</div>
                <div>Driver: {car.fullName || '—'}</div>
                <div>Telephone: {car.telephone || '—'}</div>
                <div>Plate: {car.plate || '—'}</div>
                <div>Make / model: {[car.make, car.model].filter(Boolean).join(' / ') || '—'}</div>
                <div>Insurer: {car.insurerName || '—'}</div>
              </div>
            ))}
            {selectedKinds.includes('pedestrian') && form.thirdPartyPedestrians.slice(0, form.thirdPartyCounts.pedestrian).map((person, idx) => (
              <div key={`review-ped-${idx}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3 mt-2">
                <div className="font-black text-slate-900">Pedestrian #{idx + 1}</div>
                <div>Full name: {person.fullName || '—'}</div>
                <div>Telephone: {person.telephone || '—'}</div>
              </div>
            ))}
            {selectedKinds.includes('property') && form.thirdPartyProperties.slice(0, form.thirdPartyCounts.property).map((property, idx) => (
              <div key={`review-property-${idx}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3 mt-2">
                <div className="font-black text-slate-900">Property #{idx + 1}</div>
                <div>Full name: {property.fullName || '—'}</div>
                <div>Telephone: {property.telephone || '—'}</div>
              </div>
            ))}
          </>
        ) : null}
        <div>
          <span className="font-black text-slate-900">Police involved:</span> {form.policeInvolved || '—'}
        </div>
        <div>
          <span className="font-black text-slate-900">Police report:</span> {form.policeReportNumber || '—'}
        </div>
        <div>
          <span className="font-black text-slate-900">Car drivable:</span> {form.carDrivable || '—'}
        </div>
        <div>
          <span className="font-black text-slate-900">Injuries reported:</span> {form.injuriesReported || '—'}
        </div>
      </div>
      <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-white">
        <UiInput
          type="checkbox"
          checked={form.declarationAccepted}
          onChange={(e) => onToggleDeclaration(e.target.checked)}
          className="mt-1"
        />
        <div className="text-sm font-semibold text-slate-700">
          I confirm this report is accurate to the best of my knowledge.
        </div>
      </label>
      {!canSubmit ? (
        <p className="text-xs font-semibold text-slate-500">
          Please accept the declaration before submission.
        </p>
      ) : null}
    </section>
  );
}

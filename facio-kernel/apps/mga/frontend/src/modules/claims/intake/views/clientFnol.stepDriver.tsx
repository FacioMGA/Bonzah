/**
 * StepDriver — FNOL Step 3: Driver selection.
 *
 * Handles named-driver card and "another driver" form.
 * Pure presentation. No state. No effects.
 */
import React from 'react';
import PhoneInput from 'react-phone-number-input';
import { Select } from '@/src/shared/ui';
import { WizardInput as Input } from '@/src/shared/ui';
import { Input as UiInput } from '@/src/shared/ui';
import { ClientFormField } from '../views/clientFnol.sections';
import type { FnolForm, FnolFieldErrors, NamedDriver } from '../model/clientFnol.types';
import { ANOTHER_DRIVER_ID } from '../model/clientFnol.types';
import { clampE164Phone, formatFnolDateForDisplay } from '../views/clientFnol.helpers';

interface Props {
    form: FnolForm;
    setForm: React.Dispatch<React.SetStateAction<FnolForm>>;
    fieldErrors: FnolFieldErrors;
    policyId: string;
    namedDrivers: NamedDriver[];
    selectedDriver: NamedDriver | null;
    driverStepTitle: string;
    defaultPhoneCountry: React.ComponentProps<typeof PhoneInput>['defaultCountry'];
    phoneInputFlags: NonNullable<React.ComponentProps<typeof PhoneInput>['flags']>;
    phoneInputClass: (hasError: boolean) => string;
}

export function StepDriver({
    form,
    setForm,
    fieldErrors,
    policyId,
    namedDrivers,
    selectedDriver,
    driverStepTitle,
    defaultPhoneCountry,
    phoneInputFlags,
    phoneInputClass,
}: Props) {
    return (
        <section className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
            <h3 className="text-xl font-black text-slate-900">{driverStepTitle}</h3>

            {namedDrivers.length > 0 ? (
                <div className="pt-2">
                    <ClientFormField label="Driver involved" required error={fieldErrors.driverId}>
                        <Select
                            variant="ui"
                            className={`ui-input ${fieldErrors.driverId ? 'border-red-500/70 ring-4 ring-red-500/10' : ''}`}
                            value={form.driverId}
                            onChange={(e) => {
                                const v = String(e.target.value || '');
                                const picked = namedDrivers.find((d) => d.id === v) || null;
                                setForm((p) => ({
                                    ...p,
                                    driverId: v,
                                    driverContactPhone: v === ANOTHER_DRIVER_ID ? p.driverContactPhone : (clampE164Phone(picked?.phone || '') || p.driverContactPhone || ''),
                                    driverContactEmail: v === ANOTHER_DRIVER_ID ? p.driverContactEmail : (picked?.email || p.driverContactEmail || ''),
                                }));
                            }}
                            disabled={!policyId}
                        >
                            {namedDrivers.map((d) => (
                                <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                            <option value={ANOTHER_DRIVER_ID}>Another driver</option>
                        </Select>
                    </ClientFormField>
                </div>
            ) : null}

            {namedDrivers.length === 0 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                    We could not find named drivers for this policy. Please contact support before submitting a claim.
                </div>
            ) : form.driverId !== ANOTHER_DRIVER_ID ? (
                <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                    <div className="text-xs uppercase tracking-wide font-black text-slate-500">Named driver on policy</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Input value={selectedDriver?.name || '—'} disabled />
                        <Input value={formatFnolDateForDisplay(selectedDriver?.dateOfBirth || '') || '—'} disabled />
                        <ClientFormField label="Driver claims contact phone" error={fieldErrors.driverContactPhone}>
                            <PhoneInput
                                international
                                defaultCountry={defaultPhoneCountry}
                                flags={phoneInputFlags}
                                value={form.driverContactPhone || ''}
                                limitMaxLength
                                countryCallingCodeEditable={false}
                                onChange={(v) => setForm((p) => ({ ...p, driverContactPhone: clampE164Phone(v || '') }))}
                                className={phoneInputClass(Boolean(fieldErrors.driverContactPhone))}
                                placeholder="Driver claims contact phone (editable)"
                            />
                        </ClientFormField>
                        <ClientFormField label="Driver claims contact email" error={fieldErrors.driverContactEmail}>
                            <Input
                                value={form.driverContactEmail}
                                type="email"
                                error={Boolean(fieldErrors.driverContactEmail)}
                                showValid
                                onChange={(e) => setForm((p) => ({ ...p, driverContactEmail: e.target.value }))}
                                placeholder="Driver claims contact email (editable)"
                            />
                        </ClientFormField>
                    </div>
                </div>
            ) : (
                <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                    <div className="text-xs uppercase tracking-wide font-black text-slate-500">Another driver</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <ClientFormField label="First name" required error={fieldErrors.unauthorizedDriverFirstName}>
                            <Input
                                value={form.unauthorizedDriverFirstName}
                                error={Boolean(fieldErrors.unauthorizedDriverFirstName)}
                                showValid
                                onChange={(e) => setForm((p) => ({ ...p, unauthorizedDriverFirstName: e.target.value }))}
                                placeholder="First name *"
                            />
                        </ClientFormField>
                        <ClientFormField label="Last name" required error={fieldErrors.unauthorizedDriverLastName}>
                            <Input
                                value={form.unauthorizedDriverLastName}
                                error={Boolean(fieldErrors.unauthorizedDriverLastName)}
                                showValid
                                onChange={(e) => setForm((p) => ({ ...p, unauthorizedDriverLastName: e.target.value }))}
                                placeholder="Last name *"
                            />
                        </ClientFormField>
                        <ClientFormField label="Date of birth" required error={fieldErrors.unauthorizedDriverDateOfBirth}>
                            <Input
                                type="date"
                                value={form.unauthorizedDriverDateOfBirth}
                                error={Boolean(fieldErrors.unauthorizedDriverDateOfBirth)}
                                showValid
                                onChange={(e) => setForm((p) => ({ ...p, unauthorizedDriverDateOfBirth: e.target.value }))}
                            />
                        </ClientFormField>
                        <ClientFormField label="License years held" error={fieldErrors.driverLicenseYearsHeld}>
                            <Input
                                type="number"
                                min={0}
                                max={80}
                                value={form.driverLicenseYearsHeld}
                                error={Boolean(fieldErrors.driverLicenseYearsHeld)}
                                showValid
                                onChange={(e) => setForm((p) => ({ ...p, driverLicenseYearsHeld: e.target.value }))}
                                placeholder="e.g. 3"
                            />
                        </ClientFormField>
                        <ClientFormField label="License issued country" error={fieldErrors.driverLicenseIssuedCountry}>
                            <Input
                                value={form.driverLicenseIssuedCountry}
                                error={Boolean(fieldErrors.driverLicenseIssuedCountry)}
                                showValid
                                onChange={(e) => setForm((p) => ({ ...p, driverLicenseIssuedCountry: e.target.value }))}
                                placeholder="Country"
                            />
                        </ClientFormField>
                        <ClientFormField label="Driver claims contact phone" error={fieldErrors.unauthorizedDriverPhone}>
                            <PhoneInput
                                international
                                defaultCountry={defaultPhoneCountry}
                                flags={phoneInputFlags}
                                value={form.unauthorizedDriverPhone || ''}
                                limitMaxLength
                                countryCallingCodeEditable={false}
                                onChange={(v) => setForm((p) => ({ ...p, unauthorizedDriverPhone: clampE164Phone(v || '') }))}
                                className={phoneInputClass(Boolean(fieldErrors.unauthorizedDriverPhone))}
                                placeholder="Driver claims contact phone (editable)"
                            />
                        </ClientFormField>
                        <div className="md:col-span-2">
                            <ClientFormField label="Driver claims contact email" error={fieldErrors.unauthorizedDriverEmail}>
                                <Input
                                    value={form.unauthorizedDriverEmail}
                                    type="email"
                                    error={Boolean(fieldErrors.unauthorizedDriverEmail)}
                                    showValid
                                    onChange={(e) => setForm((p) => ({ ...p, unauthorizedDriverEmail: e.target.value }))}
                                    placeholder="Driver claims contact email (editable)"
                                />
                            </ClientFormField>
                        </div>
                        <div className="md:col-span-2">
                            <ClientFormField label="Driver had policyholder permission" required error={fieldErrors.driverHasPermission}>
                                <div className="flex items-center gap-6">
                                    <label className="inline-flex items-center gap-2 font-semibold text-slate-700">
                                        <UiInput
                                            type="radio"
                                            checked={form.driverHasPermission === 'yes'}
                                            onChange={() => setForm((p) => ({ ...p, driverHasPermission: 'yes' }))}
                                        />
                                        Yes
                                    </label>
                                    <label className="inline-flex items-center gap-2 font-semibold text-slate-700">
                                        <UiInput
                                            type="radio"
                                            checked={form.driverHasPermission === 'no'}
                                            onChange={() => setForm((p) => ({ ...p, driverHasPermission: 'no' }))}
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
    );
}

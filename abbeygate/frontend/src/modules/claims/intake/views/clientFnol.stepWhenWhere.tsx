/**
 * StepWhenWhere — FNOL Step 2: Date, time, and location.
 *
 * Pure presentation. No state. No effects.
 */
import React from 'react';
import AddressAutocomplete from '@/src/shared/components/AddressAutocomplete';
import { WizardInput as Input } from '@/src/shared/ui';
import { ClientFormField } from '../views/clientFnol.sections';
import type { FnolForm, FnolFieldErrors } from '../model/clientFnol.types';
import { isoDate } from '../views/clientFnol.helpers';

interface Props {
    form: FnolForm;
    setForm: React.Dispatch<React.SetStateAction<FnolForm>>;
    fieldErrors: FnolFieldErrors;
}

export function StepWhenWhere({ form, setForm, fieldErrors }: Props) {
    return (
        <section className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
            <h3 className="text-xl font-black text-slate-900">When and where did it happen?</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                    <ClientFormField label="Date" required error={fieldErrors.incidentDate}>
                        <Input
                            type="date"
                            value={form.incidentDate}
                            max={isoDate(new Date())}
                            error={Boolean(fieldErrors.incidentDate)}
                            showValid
                            onValueChange={(next) => setForm((p) => ({ ...p, incidentDate: next }))}
                        />
                    </ClientFormField>
                </div>
                <div>
                    <ClientFormField label="Time (optional)">
                        <Input
                            type="time"
                            value={form.incidentTime}
                            showValid
                            onChange={(e) => setForm((p) => ({ ...p, incidentTime: e.target.value }))}
                        />
                    </ClientFormField>
                </div>
            </div>
            <div>
                <ClientFormField label="Location" required error={fieldErrors.location}>
                    <AddressAutocomplete
                        value={form.location}
                        onChange={(val) => setForm((p) => ({ ...p, location: val }))}
                        onAddressSelect={(addr) => {
                            setForm((p) => ({
                                ...p,
                                location: addr.address || p.location,
                                city: addr.city || p.city,
                                country: addr.country || p.country,
                            }));
                        }}
                        placeholder="Search address or place"
                        inputVariant="ui"
                        className={`ui-input !h-[56.5px] !py-0 text-[15px] !bg-slate-50/50 ${fieldErrors.location ? 'border-red-500/70 !important ring-4 ring-red-500/10' : ''}`}
                    />
                </ClientFormField>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ClientFormField label="City" required error={fieldErrors.city}>
                    <Input
                        placeholder="City"
                        value={form.city}
                        error={Boolean(fieldErrors.city)}
                        showValid
                        onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))}
                    />
                </ClientFormField>
                <ClientFormField label="Country" required error={fieldErrors.country}>
                    <Input
                        placeholder="Country"
                        value={form.country}
                        error={Boolean(fieldErrors.country)}
                        showValid
                        onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))}
                    />
                </ClientFormField>
            </div>
        </section>
    );
}

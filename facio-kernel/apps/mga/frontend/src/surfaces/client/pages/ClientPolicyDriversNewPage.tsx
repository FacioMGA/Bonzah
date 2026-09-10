import React from 'react';
import { createPortal } from 'react-dom';
import { PageHeader } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { WizardInput as Input } from '@/src/shared/ui';
import { Select } from '@/src/shared/ui';
import { CheckCircle2, Loader2, ShieldCheck, Sparkles, Trash2, UserPlus, Users } from 'lucide-react';
import { licenseYearsOptions } from '@/src/products/motor/public';
import PhoneInput from 'react-phone-number-input';
import flags from 'react-phone-number-input/flags';
import 'react-phone-number-input/style.css';
import { formatDateUI } from '@/src/shared/lib/format';

import { useClientPolicyDriversController } from '../controller/useClientPolicyDriversController';

export default function ClientPolicyDriversNewPage() {
  const ctrl = useClientPolicyDriversController();
  const phoneInputFlags: NonNullable<React.ComponentProps<typeof PhoneInput>['flags']> = flags;
  const dobDisplay = (value: string) => {
    const raw = String(value || '').trim();
    if (!raw) return 'DOB not set';
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return formatDateUI(raw);
    }
    return raw;
  };

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-8">
      <PageHeader
        breadcrumb={{ label: 'Back to policy', onClick: ctrl.backToPolicy }}
        title="Manage drivers"
        subtitle="Driver changes are processed as an endorsement and may require approval."
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-6 md:p-7 shadow-sm space-y-5">
        {ctrl.loading ? (
          <div className="text-sm font-semibold text-slate-500">Loading driver details...</div>
        ) : (
          <>
            <div className="space-y-3 rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
              <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wide font-black text-slate-500">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Main Driver</span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input value={ctrl.mainDriver.fullName} disabled />
                <Input type="date" value={ctrl.mainDriver.dateOfBirth} disabled />
                <Input value={ctrl.mainDriver.email} disabled />
                <Input value={ctrl.mainDriver.telephone} disabled />
              </div>
            </div>

            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wide font-black text-slate-500">
                <Users className="w-3.5 h-3.5" />
                <span>Additional Drivers</span>
              </div>
            </div>
            {ctrl.mode !== 'edit' && (
              <div className="space-y-3">
                {ctrl.currentDrivers.length === 0 ? (
                  <div className="text-sm font-semibold text-slate-600">No additional drivers added yet.</div>
                ) : null}
                {ctrl.currentDrivers.map((driver, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => ctrl.startEditDriver(idx)}
                    className="group w-full rounded-xl border border-slate-200 bg-white p-4 text-left transition-all hover:border-slate-300 hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-black text-slate-900">{`${driver.firstName} ${driver.lastName}`.trim() || 'Unnamed driver'}</div>
                        <div className="mt-1 text-sm font-semibold text-slate-600">{dobDisplay(driver.dateOfBirth)}</div>
                        <div className="mt-2 text-sm font-semibold text-slate-700">License Years: <span className="font-black text-slate-900">{driver.licenseYears || '—'}</span></div>
                        <div className="text-sm font-semibold text-slate-700">Email: <span className="font-black text-slate-900">{driver.email || '—'}</span></div>
                        <div className="text-sm font-semibold text-slate-700">Phone: <span className="font-black text-slate-900">{driver.telephone || '—'}</span></div>
                      </div>
                      <div className="text-xs font-black uppercase tracking-wide text-slate-400 group-hover:text-slate-600">Edit driver</div>
                    </div>
                  </button>
                ))}

                {(ctrl.pending.driversAdded.length > 0 || ctrl.pending.driversUpdated.length > 0 || ctrl.pending.driversRemoved.length > 0) && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-3">
                    <div className="text-[11px] uppercase tracking-wide font-black text-amber-700">Pending Changes</div>
                    {ctrl.pending.driversAdded.map((driver, idx) => (
                      <div key={`add-${idx}`} className="rounded-xl border border-amber-200 bg-white p-3">
                        <div className="text-xs font-black uppercase tracking-wide text-amber-600">Pending addition</div>
                        <div className="mt-1 text-sm font-black text-slate-900">{`${driver.firstName} ${driver.lastName}`.trim() || 'Unnamed driver'}</div>
                        <div className="text-xs font-semibold text-slate-600">{dobDisplay(driver.dateOfBirth)} · License Years: {driver.licenseYears || '—'}</div>
                        <div className="mt-2 flex items-center gap-2">
                          <Button variant="secondary" className="h-10" onClick={() => ctrl.startEditPendingAdd(driver)}>Edit Pending Change</Button>
                          <Button variant="secondary" className="h-10" onClick={() => ctrl.removePendingAddition(driver)}>Remove Pending Change</Button>
                        </div>
                      </div>
                    ))}
                    {ctrl.pending.driversUpdated.map((pair, idx) => (
                      <div key={`upd-${idx}`} className="rounded-xl border border-amber-200 bg-white p-3">
                        <div className="text-xs font-black uppercase tracking-wide text-amber-600">Pending update</div>
                        <div className="mt-1 text-sm font-black text-slate-900">{`${pair.after.firstName} ${pair.after.lastName}`.trim() || 'Unnamed driver'}</div>
                        <div className="text-xs font-semibold text-slate-600">{dobDisplay(pair.after.dateOfBirth)} · License Years: {pair.after.licenseYears || '—'}</div>
                        <div className="mt-2 flex items-center gap-2">
                          <Button variant="secondary" className="h-10" onClick={() => ctrl.startEditPendingUpdate(pair.before, pair.after)}>Edit Pending Change</Button>
                          <Button variant="secondary" className="h-10" onClick={() => ctrl.removePendingUpdate(pair.before, pair.after)}>Remove Pending Change</Button>
                        </div>
                      </div>
                    ))}
                    {ctrl.pending.driversRemoved.map((driver, idx) => (
                      <div key={`rem-${idx}`} className="rounded-xl border border-amber-200 bg-white p-3">
                        <div className="text-xs font-black uppercase tracking-wide text-amber-600">Pending removal</div>
                        <div className="mt-1 text-sm font-black text-slate-900">{`${driver.firstName} ${driver.lastName}`.trim() || 'Unnamed driver'}</div>
                        <div className="text-xs font-semibold text-slate-600">{dobDisplay(driver.dateOfBirth)} · License Years: {driver.licenseYears || '—'}</div>
                        <div className="mt-2 flex items-center gap-2">
                          <Button variant="secondary" className="h-10" onClick={() => ctrl.removePendingRemoval(driver)}>Remove Pending Change</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(ctrl.mode === 'edit' || ctrl.mode === 'add') && ctrl.draftDriver ? (
              <div className="rounded-xl border border-slate-200 p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2 text-[11px] uppercase tracking-wide font-black text-slate-500">New driver details</div>
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-wide font-black text-slate-500">First Name</label>
                  <Input value={ctrl.draftDriver.firstName} onChange={(e) => ctrl.setDraftField('firstName', e.target.value)} placeholder="First name *" error={Boolean(ctrl.draftErrors.firstName)} showValid />
                  {ctrl.draftErrors.firstName ? <p className="mt-1 text-xs font-semibold text-red-600">{ctrl.draftErrors.firstName}</p> : null}
                </div>
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-wide font-black text-slate-500">Last Name</label>
                  <Input value={ctrl.draftDriver.lastName} onChange={(e) => ctrl.setDraftField('lastName', e.target.value)} placeholder="Last name *" error={Boolean(ctrl.draftErrors.lastName)} showValid />
                  {ctrl.draftErrors.lastName ? <p className="mt-1 text-xs font-semibold text-red-600">{ctrl.draftErrors.lastName}</p> : null}
                </div>
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-wide font-black text-slate-500">Date Of Birth</label>
                  <Input type="date" value={ctrl.draftDriver.dateOfBirth} onValueChange={(next) => ctrl.setDraftField('dateOfBirth', next)} error={Boolean(ctrl.draftErrors.dateOfBirth)} showValid />
                  {ctrl.draftErrors.dateOfBirth ? <p className="mt-1 text-xs font-semibold text-red-600">{ctrl.draftErrors.dateOfBirth}</p> : null}
                </div>
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-wide font-black text-slate-500">License Years</label>
                  <Select value={String(ctrl.draftDriver.licenseYears || '')} onChange={(e) => ctrl.setDraftField('licenseYears', e.target.value)} error={Boolean(ctrl.draftErrors.licenseYears)}>
                    {licenseYearsOptions.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                  </Select>
                  {ctrl.draftErrors.licenseYears ? <p className="mt-1 text-xs font-semibold text-red-600">{ctrl.draftErrors.licenseYears}</p> : null}
                </div>
                <div>
                  <label className="mb-1 block text-[11px] uppercase tracking-wide font-black text-slate-500">Email</label>
                  <Input value={ctrl.draftDriver.email} onChange={(e) => ctrl.setDraftField('email', e.target.value)} placeholder="Email (optional)" type="email" error={Boolean(ctrl.draftErrors.email)} showValid />
                  {ctrl.draftErrors.email ? <p className="mt-1 text-xs font-semibold text-red-600">{ctrl.draftErrors.email}</p> : null}
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-[11px] uppercase tracking-wide font-black text-slate-500">Phone</label>
                  <PhoneInput
                    international
                    defaultCountry={ctrl.defaultPhoneCountry}
                    flags={phoneInputFlags}
                    value={ctrl.draftDriver.telephone || ''}
                    limitMaxLength
                    countryCallingCodeEditable={false}
                    onChange={(v) => ctrl.setDraftField('telephone', v || '')}
                    className={`ui-input w-full text-[15px] ${ctrl.draftErrors.telephone ? 'border-red-500/70 ring-4 ring-red-500/10' : ''} [&_.PhoneInputInput]:bg-transparent [&_.PhoneInputInput]:outline-none [&_.PhoneInputInput]:flex-1 [&_.PhoneInputInput]:min-w-0 [&_.PhoneInputInput]:w-0 [&_.PhoneInputInput]:border-0 [&_.PhoneInputInput]:shadow-none [&_.PhoneInputInput]:ring-0 [&_.PhoneInputInput]:font-semibold [&_.PhoneInputInput]:text-slate-700 [&_.PhoneInputCountry]:mr-2 [&_.PhoneInputCountry]:shrink-0 [&_.PhoneInputCountrySelect]:bg-transparent [&_.PhoneInputCountrySelect]:border-0 [&_.PhoneInputCountrySelect]:shadow-none [&_.PhoneInputCountrySelect]:outline-none [&_.PhoneInputCountrySelect]:ring-0`}
                    placeholder="Telephone (optional)"
                  />
                  {ctrl.draftErrors.telephone ? <p className="mt-1 text-xs font-semibold text-red-600">{ctrl.draftErrors.telephone}</p> : null}
                </div>
                <div className="md:col-span-2 flex items-center justify-between gap-3">
                  <Button
                    variant="secondary"
                    className="group h-12 inline-flex items-center justify-center gap-2"
                    onClick={ctrl.mode === 'edit' ? ctrl.openRemoveConfirm : ctrl.removeDraftDriver}
                  >
                    <Trash2 className="w-4 h-4 transition-transform duration-200 group-hover:scale-110" />
                    <span>{ctrl.removeButtonLabel}</span>
                  </Button>
                  <div className="ml-auto flex items-center gap-3">
                    {ctrl.mode === 'edit' ? (
                      <Button variant="secondary" className="h-12" disabled={ctrl.saving} onClick={ctrl.cancelEdit}>
                        Cancel
                      </Button>
                    ) : null}
                    <Button className="group h-12 inline-flex items-center justify-center gap-2" disabled={ctrl.saving || !ctrl.canSubmit} onClick={ctrl.openConfirm}>
                      <CheckCircle2 className="w-4 h-4 transition-transform duration-200 group-hover:-translate-y-0.5" />
                      <span>{ctrl.saving ? 'Saving...' : 'Save Changes'}</span>
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <Button variant="secondary" className="group h-12 inline-flex items-center justify-center gap-2" onClick={ctrl.startAddDriver}>
                <UserPlus className="w-4 h-4 transition-transform duration-200 group-hover:-translate-y-0.5" />
                <span>Add Driver</span>
              </Button>
            )}
            {ctrl.error ? <div className="text-sm font-semibold text-red-600">{ctrl.error}</div> : null}
          </>
        )}
      </section>

      {ctrl.showConfirm ? createPortal(
        <div className="fixed top-0 left-0 z-[2000] w-screen h-screen bg-slate-950/45 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-5 shadow-2xl space-y-3">
            <div className="text-base font-black text-amber-900">Policy Modification</div>
            {ctrl.isRemoveIntent ? (
              <>
                <div className="text-sm font-semibold text-amber-800">
                  Removing this driver will create a policy endorsement and may require approval.
                </div>
                <div className="text-sm font-semibold text-amber-800">
                  Continue?
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold text-amber-800">
                  Adding a driver will create a policy endorsement and may require approval.
                </div>
                <div className="text-sm font-semibold text-amber-800">
                  Continue to create and process the endorsement?
                </div>
              </>
            )}
            <div className="flex items-center justify-end gap-3 pt-1">
              <Button variant="secondary" className="h-12" disabled={ctrl.saving} onClick={ctrl.closeConfirm}>Cancel</Button>
              {ctrl.canAddAnotherDriver ? (
                <Button variant="secondary" className="group h-12 inline-flex items-center justify-center gap-2" disabled={ctrl.saving} onClick={ctrl.addAnotherDriver}>
                  <UserPlus className="w-4 h-4 transition-transform duration-200 group-hover:-translate-y-0.5" />
                  <span>Add Another Driver</span>
                </Button>
              ) : null}
              <Button className="group h-12 inline-flex items-center justify-center gap-2" disabled={ctrl.saving} onClick={() => void ctrl.confirmAndSubmit()}>
                <CheckCircle2 className="w-4 h-4 transition-transform duration-200 group-hover:-translate-y-0.5" />
                <span>Confirm & Continue</span>
              </Button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {ctrl.saving ? createPortal(
        <div className="fixed top-0 left-0 z-[2100] w-screen h-screen bg-slate-950/55 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-3xl border border-white/20 bg-slate-950/70 text-white p-8 shadow-[0_25px_80px_-20px_rgba(2,6,23,0.8)] relative overflow-hidden">
            <div className="absolute -top-14 -left-10 h-40 w-40 rounded-full bg-cyan-400/20 blur-3xl animate-pulse" />
            <div className="absolute -bottom-16 -right-12 h-44 w-44 rounded-full bg-blue-500/25 blur-3xl animate-pulse" />
            <div className="relative flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl border border-white/20 bg-white/5 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-cyan-300" />
              </div>
              <div>
                <div className="text-lg font-black tracking-tight">Processing Endorsement</div>
                <div className="mt-1 text-sm font-semibold text-slate-200">
                  Applying driver changes, rating, binding, and issuing policy updates...
                </div>
              </div>
            </div>
            <div className="relative mt-6 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-cyan-300 via-blue-300 to-indigo-300 animate-[pulse_1.2s_ease-in-out_infinite]" />
            </div>
            <div className="relative mt-4 inline-flex items-center gap-2 text-xs font-black uppercase tracking-wide text-cyan-200/90">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Please keep this window open</span>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

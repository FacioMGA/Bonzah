import { Calendar } from 'lucide-react';
import { Modal } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import { PhoneInputField } from '@/src/shared/ui';
import { SearchableSelect } from '@/src/shared/ui';
import { Select } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { Textarea } from '@/src/shared/ui';
import AddressAutocomplete from '@/src/shared/components/AddressAutocomplete';
import type { CreateCaseDraft } from '@/src/modules/claims/model/types';

type Props = {
  isOpen: boolean;
  busy: boolean;
  newCaseStep: 1 | 2;
  newCaseMode: 'KNOWN' | 'UNKNOWN';
  createDraft: CreateCaseDraft;
  createDraftErrors: { contactEmail: string; contactPhone: string; dateOfLoss: string };
  createPolicyOptions: Array<{ value: string; label: string }>;
  disableCreateCasePrimary: boolean;
  onClose: () => void;
  onCancel: () => void;
  onPrimary: () => void;
  onSetNewCaseMode: (mode: 'KNOWN' | 'UNKNOWN') => void;
  onSetCreateDraft: (updater: (prev: CreateCaseDraft) => CreateCaseDraft) => void;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-[11px] font-semibold text-red-600">{message}</p>;
}

export function ClaimsDeskCreateCaseModal(props: Props) {
  const {
    isOpen,
    busy,
    newCaseStep,
    newCaseMode,
    createDraft,
    createDraftErrors,
    createPolicyOptions,
    disableCreateCasePrimary,
    onClose,
    onCancel,
    onPrimary,
    onSetNewCaseMode,
    onSetCreateDraft,
  } = props;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New case"
      maxWidth="max-w-2xl"
      actions={(
        <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            onClick={onCancel}
            className="w-full sm:w-auto px-6 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition"
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={onPrimary}
            className="w-full sm:w-auto bg-brand-primary text-white px-8 py-3 rounded-xl font-black shadow-lg hover:bg-brand-secondary transition disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={disableCreateCasePrimary}
          >
            {busy ? 'Saving…' : newCaseStep === 1 ? 'Continue' : 'Save case'}
          </Button>
        </div>
      )}
    >
      <div className="space-y-5 sm:space-y-6">
        {newCaseStep === 1 ? (
          <div className="space-y-3">
            <div className="text-sm font-semibold text-slate-700">What are you starting?</div>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Input type="radio" checked={newCaseMode === 'KNOWN'} onChange={() => onSetNewCaseMode('KNOWN')} />
              Policy known
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Input type="radio" checked={newCaseMode === 'UNKNOWN'} onChange={() => onSetNewCaseMode('UNKNOWN')} />
              Policy unknown
            </label>
          </div>
        ) : null}
        {newCaseStep === 2 && newCaseMode === 'KNOWN' ? (
          <label className="space-y-1 block">
            <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">Policy</div>
            <SearchableSelect
              value={createDraft.policyId}
              onChange={(policyId) => onSetCreateDraft((p) => ({ ...p, policyId }))}
              placeholder="Select policy"
              searchPlaceholder="Search by policy number or client name"
              options={createPolicyOptions}
              disabled={busy}
            />
          </label>
        ) : null}
        {newCaseStep === 2 && newCaseMode === 'UNKNOWN' ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">Reported by</div>
              <Select variant="ui" value={createDraft.reporterType} onChange={(e) => onSetCreateDraft((p) => ({ ...p, reporterType: e.target.value }))}>
                <option value="LAWYER">Lawyer</option>
                <option value="THIRD_PARTY">Third party</option>
                <option value="POLICYHOLDER">Policyholder</option>
                <option value="OTHER_INSURER">Other insurer</option>
              </Select>
            </label>
            <label className="space-y-1">
              <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">Contact name</div>
              <Input variant="ui" value={createDraft.contactName} onChange={(e) => onSetCreateDraft((p) => ({ ...p, contactName: e.target.value }))} />
            </label>
            <label className="space-y-1">
              <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">Contact phone</div>
              <PhoneInputField
                value={createDraft.contactPhone}
                onChange={(value: string | undefined) => onSetCreateDraft((p) => ({ ...p, contactPhone: String(value || '') }))}
                international
                defaultCountry="CY"
                error={Boolean(createDraftErrors.contactPhone)}
              />
              <FieldError message={createDraftErrors.contactPhone || undefined} />
            </label>
            <label className="space-y-1">
              <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">Contact email</div>
              <Input
                variant="ui"
                type="email"
                value={createDraft.contactEmail}
                onChange={(e) => onSetCreateDraft((p) => ({ ...p, contactEmail: e.target.value }))}
                error={Boolean(createDraftErrors.contactEmail)}
              />
              <FieldError message={createDraftErrors.contactEmail || undefined} />
            </label>
            <label className="space-y-1 md:col-span-2">
              <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">Short description</div>
              <Textarea
                className="min-h-24 ui-input"
                value={createDraft.shortDescription}
                onChange={(e) => onSetCreateDraft((p) => ({ ...p, shortDescription: e.target.value }))}
              />
            </label>
            <label className="space-y-1">
              <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">Date (if known)</div>
              <div className="relative">
                <Input
                  variant="ui"
                  type="date"
                  value={createDraft.dateOfLoss}
                  max={new Date().toISOString().slice(0, 10)}
                  onValueChange={(next) => onSetCreateDraft((p) => ({ ...p, dateOfLoss: next }))}
                  error={Boolean(createDraftErrors.dateOfLoss)}
                  className="pr-12"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 transition-colors !p-0 bg-transparent"
                  aria-label="Open date picker"
                  onClick={(e) => {
                    const input = (e.currentTarget.previousElementSibling as HTMLInputElement | null);
                    if (!input) return;
                    if (typeof (input as HTMLInputElement & { showPicker?: () => void }).showPicker === 'function') {
                      (input as HTMLInputElement & { showPicker: () => void }).showPicker();
                    } else {
                      input.focus();
                    }
                  }}
                >
                  <Calendar className="h-4 w-4" />
                </Button>
              </div>
              <FieldError message={createDraftErrors.dateOfLoss || undefined} />
            </label>
            <label className="space-y-1 md:col-span-2">
              <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">Location (if known)</div>
              <AddressAutocomplete
                value={createDraft.location}
                onChange={(val) => onSetCreateDraft((p) => ({ ...p, location: val, locationDetails: null }))}
                onAddressSelect={(address) => onSetCreateDraft((p) => ({
                  ...p,
                  location: [address.address, address.city].filter(Boolean).join(', ') || p.location,
                  locationDetails: address,
                }))}
                placeholder="Search address or enter city name"
                inputVariant="ui"
                className="w-full"
              />
            </label>
            <label className="space-y-1">
              <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">Insured name (if known)</div>
              <Input variant="ui" value={createDraft.insuredName} onChange={(e) => onSetCreateDraft((p) => ({ ...p, insuredName: e.target.value }))} />
            </label>
            <div className="hidden md:block" aria-hidden="true" />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

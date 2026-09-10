import React from 'react';
import AddressAutocomplete from '@/src/shared/components/AddressAutocomplete';
import { Button } from '@/src/shared/ui';
import { Input, SearchableSelect, PhoneInputField } from '@/src/shared/ui';
import { REGION_CONFIG } from '@/src/shared/config/region';

type QuoteDataLike = Record<string, unknown>;
type PortfolioLike = Record<string, unknown>;

const FieldError = ({ message }: { message?: string }) => {
  if (!message) return null;
  return (
    <div className="flex items-center space-x-1.5 mt-2 text-red-500 animate-in fade-in slide-in-from-top-1 duration-200 px-1">
      <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
      <span className="text-[10px] font-black uppercase tracking-widest leading-none">{message}</span>
    </div>
  );
};

interface AdditionalPolicyHoldersProps {
  policyHolders: QuoteDataLike[];
  formErrors: Record<string, string>;
  showValidation: boolean;
  fieldDisabled: boolean;
  countryOptions: Array<{ value: string; label: string }>;
  validateField: (field: string, value: string, portfolio: PortfolioLike) => void;
  clearFieldError: (field: string) => void;
  endorsementFieldChanged: (path: string) => boolean;
  updatePolicyHolderAt: (index: number, patch: QuoteDataLike) => PortfolioLike;
  updatePolicyHolderAddressAt: (index: number, patch: QuoteDataLike) => PortfolioLike;
  removePolicyHolder: (index: number) => void;
  hasSelectedOption: (value: unknown) => boolean;
  textFieldClass: (args: { errorKey?: string; changed?: boolean; extra?: string }) => string;
}

const policyHolderFieldPath = (index: number, path: string) => `quoteData.policyHolders.${index}.${path}`;
const endorsementPolicyHolderPath = (index: number, path: string) => `policyHolders.${index}.${path}`;

export function AdditionalPolicyHolders({
  policyHolders,
  formErrors,
  showValidation,
  fieldDisabled,
  countryOptions,
  validateField,
  clearFieldError,
  endorsementFieldChanged,
  updatePolicyHolderAt,
  updatePolicyHolderAddressAt,
  removePolicyHolder,
  hasSelectedOption,
  textFieldClass,
}: AdditionalPolicyHoldersProps) {
  if (policyHolders.length === 0) return null;

  return (
    <section className="space-y-6 p-0">
      {policyHolders.map((holder, index) => {
        const holderAddress = (holder.address && typeof holder.address === 'object' && !Array.isArray(holder.address)
          ? (holder.address as QuoteDataLike)
          : {}) as QuoteDataLike;
        const displayIndex = index + 2;
        return (
          <div key={index} className="space-y-5 rounded-3xl border border-slate-200 bg-white/70 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Additional Policy Holder</div>
                <div className="text-sm font-black text-slate-900">Policy holder {displayIndex}</div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => removePolicyHolder(index)}
                disabled={fieldDisabled}
                className="h-9 rounded-2xl px-4 text-[10px] font-black uppercase tracking-widest"
              >
                Remove
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 sm:gap-8">
              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">First Name</label>
                <Input
                  variant="ui"
                  type="text"
                  name={`policyHolder-${index}-firstName`}
                  aria-label={`Policy holder ${displayIndex} first name`}
                  disabled={fieldDisabled}
                  value={String(holder.firstName || '')}
                  onChange={(e) => {
                    const next = e.target.value;
                    const nextPortfolio = updatePolicyHolderAt(index, { firstName: next });
                    validateField(policyHolderFieldPath(index, 'firstName'), next, nextPortfolio);
                    clearFieldError(policyHolderFieldPath(index, 'firstName'));
                  }}
                  className={textFieldClass({
                    errorKey: policyHolderFieldPath(index, 'firstName'),
                    changed: endorsementFieldChanged(endorsementPolicyHolderPath(index, 'firstName')),
                  })}
                />
                <FieldError message={formErrors[policyHolderFieldPath(index, 'firstName')]} />
              </div>

              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Last Name</label>
                <Input
                  variant="ui"
                  type="text"
                  name={`policyHolder-${index}-lastName`}
                  aria-label={`Policy holder ${displayIndex} last name`}
                  disabled={fieldDisabled}
                  value={String(holder.lastName || '')}
                  onChange={(e) => {
                    const next = e.target.value;
                    const nextPortfolio = updatePolicyHolderAt(index, { lastName: next });
                    validateField(policyHolderFieldPath(index, 'lastName'), next, nextPortfolio);
                    clearFieldError(policyHolderFieldPath(index, 'lastName'));
                  }}
                  className={textFieldClass({
                    errorKey: policyHolderFieldPath(index, 'lastName'),
                    changed: endorsementFieldChanged(endorsementPolicyHolderPath(index, 'lastName')),
                  })}
                />
                <FieldError message={formErrors[policyHolderFieldPath(index, 'lastName')]} />
              </div>

              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Date of Birth</label>
                <Input
                  variant="ui"
                  type="date"
                  name={`policyHolder-${index}-dateOfBirth`}
                  aria-label={`Policy holder ${displayIndex} date of birth`}
                  disabled={fieldDisabled}
                  value={String(holder.dateOfBirth || '')}
                  onValueChange={(next) => {
                    const nextPortfolio = updatePolicyHolderAt(index, { dateOfBirth: next });
                    validateField(policyHolderFieldPath(index, 'dateOfBirth'), next, nextPortfolio);
                    clearFieldError(policyHolderFieldPath(index, 'dateOfBirth'));
                  }}
                  className={textFieldClass({
                    errorKey: policyHolderFieldPath(index, 'dateOfBirth'),
                    changed: endorsementFieldChanged(endorsementPolicyHolderPath(index, 'dateOfBirth')),
                  })}
                />
                <FieldError message={formErrors[policyHolderFieldPath(index, 'dateOfBirth')]} />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-5 sm:gap-8">
              <div className="relative group/field lg:col-span-2 xl:col-span-4">
                <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Address</label>
                <AddressAutocomplete
                  value={String(holderAddress.line1 || '')}
                  onChange={(val) => {
                    const nextPortfolio = updatePolicyHolderAddressAt(index, { line1: val });
                    validateField(policyHolderFieldPath(index, 'address.line1'), val, nextPortfolio);
                    clearFieldError(policyHolderFieldPath(index, 'address.line1'));
                  }}
                  onAddressSelect={(data) => {
                    const nextPortfolio = updatePolicyHolderAddressAt(index, {
                      line1: data.address || holderAddress.line1,
                      city: data.city || holderAddress.city,
                      province: data.state || holderAddress.province,
                      postcode: data.zip || holderAddress.postcode,
                      country: data.country || holderAddress.country,
                    });
                    validateField(policyHolderFieldPath(index, 'address.line1'), String(data.address || holderAddress.line1 || ''), nextPortfolio);
                    validateField(policyHolderFieldPath(index, 'address.city'), String(data.city || holderAddress.city || ''), nextPortfolio);
                    validateField(policyHolderFieldPath(index, 'address.province'), String(data.state || holderAddress.province || ''), nextPortfolio);
                    validateField(policyHolderFieldPath(index, 'address.postcode'), String(data.zip || holderAddress.postcode || ''), nextPortfolio);
                    validateField(policyHolderFieldPath(index, 'address.country'), String(data.country || holderAddress.country || ''), nextPortfolio);
                    clearFieldError(policyHolderFieldPath(index, 'address.line1'));
                    clearFieldError(policyHolderFieldPath(index, 'address.city'));
                    clearFieldError(policyHolderFieldPath(index, 'address.province'));
                    clearFieldError(policyHolderFieldPath(index, 'address.postcode'));
                    clearFieldError(policyHolderFieldPath(index, 'address.country'));
                  }}
                  placeholder="Search address..."
                  disabled={fieldDisabled}
                  inputVariant="ui"
                  className={textFieldClass({
                    errorKey: policyHolderFieldPath(index, 'address.line1'),
                    changed: endorsementFieldChanged(endorsementPolicyHolderPath(index, 'address.line1')),
                  })}
                />
                <FieldError message={formErrors[policyHolderFieldPath(index, 'address.line1')]} />
              </div>

              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">City</label>
                <Input
                  variant="ui"
                  type="text"
                  name={`policyHolder-${index}-city`}
                  aria-label={`Policy holder ${displayIndex} city`}
                  disabled={fieldDisabled}
                  value={String(holderAddress.city || '')}
                  onChange={(e) => {
                    const next = e.target.value;
                    const nextPortfolio = updatePolicyHolderAddressAt(index, { city: next });
                    validateField(policyHolderFieldPath(index, 'address.city'), next, nextPortfolio);
                    clearFieldError(policyHolderFieldPath(index, 'address.city'));
                  }}
                  className={textFieldClass({
                    errorKey: policyHolderFieldPath(index, 'address.city'),
                    changed: endorsementFieldChanged(endorsementPolicyHolderPath(index, 'address.city')),
                  })}
                />
                <FieldError message={formErrors[policyHolderFieldPath(index, 'address.city')]} />
              </div>

              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Province</label>
                <Input
                  variant="ui"
                  type="text"
                  name={`policyHolder-${index}-province`}
                  aria-label={`Policy holder ${displayIndex} province`}
                  disabled={fieldDisabled}
                  value={String(holderAddress.province || '')}
                  onChange={(e) => {
                    const next = e.target.value;
                    const nextPortfolio = updatePolicyHolderAddressAt(index, { province: next });
                    validateField(policyHolderFieldPath(index, 'address.province'), next, nextPortfolio);
                    clearFieldError(policyHolderFieldPath(index, 'address.province'));
                  }}
                  className={textFieldClass({
                    errorKey: policyHolderFieldPath(index, 'address.province'),
                    changed: endorsementFieldChanged(endorsementPolicyHolderPath(index, 'address.province')),
                  })}
                />
                <FieldError message={formErrors[policyHolderFieldPath(index, 'address.province')]} />
              </div>

              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Post Code</label>
                <Input
                  variant="ui"
                  type="text"
                  name={`policyHolder-${index}-postCode`}
                  aria-label={`Policy holder ${displayIndex} post code`}
                  disabled={fieldDisabled}
                  value={String(holderAddress.postcode || '')}
                  onChange={(e) => {
                    const next = e.target.value;
                    const nextPortfolio = updatePolicyHolderAddressAt(index, { postcode: next });
                    validateField(policyHolderFieldPath(index, 'address.postcode'), next, nextPortfolio);
                    clearFieldError(policyHolderFieldPath(index, 'address.postcode'));
                  }}
                  className={textFieldClass({
                    errorKey: policyHolderFieldPath(index, 'address.postcode'),
                    changed: endorsementFieldChanged(endorsementPolicyHolderPath(index, 'address.postcode')),
                  })}
                />
                <FieldError message={formErrors[policyHolderFieldPath(index, 'address.postcode')]} />
              </div>

              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Country</label>
                <SearchableSelect
                  value={String(holderAddress.country || '')}
                  onChange={(next) => {
                    const nextPortfolio = updatePolicyHolderAddressAt(index, { country: next });
                    validateField(policyHolderFieldPath(index, 'address.country'), next, nextPortfolio);
                    clearFieldError(policyHolderFieldPath(index, 'address.country'));
                  }}
                  options={countryOptions}
                  placeholder="Search country..."
                  searchPlaceholder="Type to search..."
                  disabled={fieldDisabled}
                  error={Boolean(formErrors[policyHolderFieldPath(index, 'address.country')])}
                  showValidTick={true}
                  isValid={Boolean(
                    showValidation &&
                    hasSelectedOption(holderAddress.country) &&
                    !formErrors[policyHolderFieldPath(index, 'address.country')]
                  )}
                />
                <FieldError message={formErrors[policyHolderFieldPath(index, 'address.country')]} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 sm:gap-8">
              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Email</label>
                <Input
                  variant="ui"
                  type="text"
                  name={`policyHolder-${index}-email`}
                  aria-label={`Policy holder ${displayIndex} email`}
                  disabled={fieldDisabled}
                  value={String(holder.email || '')}
                  onChange={(e) => {
                    const next = e.target.value;
                    const nextPortfolio = updatePolicyHolderAt(index, { email: next });
                    validateField(policyHolderFieldPath(index, 'email'), next, nextPortfolio);
                    clearFieldError(policyHolderFieldPath(index, 'email'));
                  }}
                  className={textFieldClass({
                    errorKey: policyHolderFieldPath(index, 'email'),
                    changed: endorsementFieldChanged(endorsementPolicyHolderPath(index, 'email')),
                  })}
                />
                <FieldError message={formErrors[policyHolderFieldPath(index, 'email')]} />
              </div>

              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Telephone</label>
                <PhoneInputField
                  name={`policyHolder-${index}-telephone`}
                  aria-label={`Policy holder ${displayIndex} telephone`}
                  placeholder="Enter phone number"
                  disabled={fieldDisabled}
                  value={String(holder.phone || '').replace(/\s+/g, '')}
                  onChange={(v: string | undefined) => {
                    const next = String(v || '');
                    const nextPortfolio = updatePolicyHolderAt(index, { phone: next });
                    validateField(policyHolderFieldPath(index, 'phone'), next, nextPortfolio);
                    clearFieldError(policyHolderFieldPath(index, 'phone'));
                  }}
                  international
                  limitMaxLength={true}
                  defaultCountry={REGION_CONFIG.defaultRegionCode}
                  error={Boolean(formErrors[policyHolderFieldPath(index, 'phone')])}
                  changed={endorsementFieldChanged(endorsementPolicyHolderPath(index, 'phone'))}
                />
                <FieldError message={formErrors[policyHolderFieldPath(index, 'phone')]} />
              </div>

              <div className="relative group/field z-20">
                <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Nationality</label>
                <SearchableSelect
                  value={String(holder.nationality || '')}
                  onChange={(next) => {
                    const nextPortfolio = updatePolicyHolderAt(index, { nationality: next });
                    validateField(policyHolderFieldPath(index, 'nationality'), next, nextPortfolio);
                    clearFieldError(policyHolderFieldPath(index, 'nationality'));
                  }}
                  options={countryOptions}
                  placeholder="Search nationality..."
                  searchPlaceholder="Type to search..."
                  disabled={fieldDisabled}
                  error={Boolean(formErrors[policyHolderFieldPath(index, 'nationality')])}
                  showValidTick={true}
                  isValid={Boolean(
                    showValidation &&
                    hasSelectedOption(holder.nationality) &&
                    !formErrors[policyHolderFieldPath(index, 'nationality')]
                  )}
                />
                <FieldError message={formErrors[policyHolderFieldPath(index, 'nationality')]} />
              </div>

              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">NIF</label>
                <Input
                  variant="ui"
                  type="text"
                  name={`policyHolder-${index}-nif`}
                  aria-label={`Policy holder ${displayIndex} NIF`}
                  disabled={fieldDisabled}
                  value={String(holder.nif || '')}
                  onChange={(e) => {
                    const next = e.target.value;
                    const nextPortfolio = updatePolicyHolderAt(index, { nif: next });
                    validateField(policyHolderFieldPath(index, 'nif'), next, nextPortfolio);
                    clearFieldError(policyHolderFieldPath(index, 'nif'));
                  }}
                  className={textFieldClass({
                    errorKey: policyHolderFieldPath(index, 'nif'),
                    changed: endorsementFieldChanged(endorsementPolicyHolderPath(index, 'nif')),
                  })}
                />
                <FieldError message={formErrors[policyHolderFieldPath(index, 'nif')]} />
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}

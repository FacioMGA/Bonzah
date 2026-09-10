import React from 'react';
import AddressAutocomplete from '@/src/shared/components/AddressAutocomplete';
import { Button } from '@/src/shared/ui';
import { Input as BaseInput } from '@/src/shared/ui';
import { SearchableSelect } from '@/src/shared/ui';
import { PhoneInputField } from '@/src/shared/ui';
import { cn } from '@/src/shared/lib/utils';
import { REGION_CONFIG } from '@/src/shared/config/region';
import { AdditionalPolicyHolders } from './AdditionalPolicyHolders';
import { normalizePostCodeForCountry, validatePostCodeForCountry } from '@facio/products';
import type { PolicyRecord, PolicyStateSetter } from '../../model/policy';

type QuoteDataLike = Record<string, unknown>;
type ContactLike = Record<string, unknown>;
type PortfolioLike = PolicyRecord & {
  quoteData?: QuoteDataLike;
  contact?: ContactLike;
};

function toPolicyHolderArray(value: unknown): QuoteDataLike[] {
  if (Array.isArray(value)) {
    return value.map((entry) => (
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as QuoteDataLike)
        : {}
    ));
  }
  return value && typeof value === 'object' ? [value as QuoteDataLike] : [];
}

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

interface PolicyholderProps {
  selectedPortfolio: PortfolioLike | null;
  setSelectedPortfolio: PolicyStateSetter;
  isEditing: boolean;
  setIsEditing: (editing: boolean) => void;
  formErrors: Record<string, string>;
  validateField: (field: string, value: string, portfolio: PortfolioLike) => void;
  clearFieldError: (field: string) => void;
  setFieldError: (field: string, message: string) => void;
  showValidation: boolean;
  readOnly: boolean;
  endorsementFieldChanged: (path: string) => boolean;
  loading: boolean;
  handleSavePolicy: () => void;
  handleSavePolicyHolder: () => void;
  handleCancelPolicyHolder: () => void;
  loadPolicyDetails: () => Promise<void>;
  countryOptions: Array<{ value: string; label: string }>;
  endorsementDraftRiskTransactionId?: string | null;
}

export function Policyholder(props: PolicyholderProps) {
  const {
    selectedPortfolio,
    setSelectedPortfolio,
    isEditing,
    setIsEditing,
    formErrors,
    validateField,
    clearFieldError,
    setFieldError,
    showValidation,
    readOnly,
    endorsementFieldChanged,
    loading,
    handleSavePolicy,
    handleSavePolicyHolder,
    handleCancelPolicyHolder,
    countryOptions,
    endorsementDraftRiskTransactionId,
  } = props;

  const saveButtonRef = React.useRef<HTMLButtonElement>(null);
  const cancelButtonRef = React.useRef<HTMLButtonElement>(null);

  const portfolio: PortfolioLike = selectedPortfolio || {};
  const quoteData: QuoteDataLike = portfolio.quoteData || {};
  // Phase 6k: BO Policyholder tab reads/writes the canonical
  // `quoteData.proposer.*` shape exclusively. Flat policyholder access paths
  // were eliminated together with `withPolicyholderAliases` /
  // `withCanonicalPolicyholderAliases`.
  const proposer = (quoteData.proposer && typeof quoteData.proposer === 'object'
    ? (quoteData.proposer as QuoteDataLike)
    : {}) as QuoteDataLike;
  const proposerAddress = (proposer.address && typeof proposer.address === 'object'
    ? (proposer.address as QuoteDataLike)
    : {}) as QuoteDataLike;
  const policyHolders = React.useMemo(
    () => toPolicyHolderArray(quoteData.policyHolders),
    [quoteData.policyHolders],
  );
  const statusUpper = String(portfolio.status || '').toUpperCase();
  const productTypeUpper = String(portfolio.productType || '').toUpperCase();
  const supportsJointProposers = productTypeUpper === 'HOME' || productTypeUpper === 'MOTOR';
  const policyLocked = Boolean(portfolio.isLocked || portfolio.policy?.isLocked);
  const isEndorsementMode = Boolean(endorsementDraftRiskTransactionId);
  const lockPolicyholderEdits = !isEndorsementMode && (policyLocked || statusUpper === 'ISSUED' || statusUpper === 'ACTIVE');

  const isLocked = !isEditing && !selectedPortfolio?.isNew;
  const fieldDisabled = isLocked || readOnly || lockPolicyholderEdits;

  // Local alias so all fields on this screen share the same contract by default.
  const Input = React.useMemo(() => {
    return React.forwardRef<HTMLInputElement, React.ComponentProps<typeof BaseInput>>(
      (inputProps, ref) => <BaseInput ref={ref} variant="ui" {...inputProps} />,
    );
  }, []);

  const fieldTone = (args: { errorKey?: string; changed?: boolean }) => {
    const hasError = Boolean(args.errorKey ? formErrors[args.errorKey] : false);
    if (hasError) return 'border-ui-danger ring-2 ring-ui-danger/15 ring-offset-2';
    if (args.changed) return 'border-amber-300 ring-2 ring-amber-200/20 ring-offset-2';
    return '';
  };

  const textFieldClass = (args: { errorKey?: string; changed?: boolean; extra?: string }) =>
    cn(fieldTone({ errorKey: args.errorKey, changed: args.changed }), args.extra);

  const hasSelectedOption = React.useCallback((value: unknown) => {
    const normalized = String(value || '').trim();
    if (!normalized) return false;
    return countryOptions.some((opt) => String(opt.value || '').trim() === normalized);
  }, [countryOptions]);

  const updateQuoteData = (patch: QuoteDataLike) => {
    const nextPortfolio: PortfolioLike = {
      ...portfolio,
      quoteData: { ...quoteData, ...patch },
    };
    setSelectedPortfolio(nextPortfolio);
    return nextPortfolio;
  };

  // Phase 6k: every policyholder field write goes through these helpers so
  // we never accidentally re-introduce a flat `quoteData.firstName` write.
  const updateProposer = (patch: QuoteDataLike): PortfolioLike => {
    const nextProposer = { ...proposer, ...patch };
    return updateQuoteData({ proposer: nextProposer });
  };
  const updateProposerAddress = (patch: QuoteDataLike): PortfolioLike => {
    const nextAddress = { ...proposerAddress, ...patch };
    return updateProposer({ address: nextAddress });
  };
  const updatePolicyHolders = (nextPolicyHolders: QuoteDataLike[]): PortfolioLike => (
    updateQuoteData({ policyHolders: nextPolicyHolders })
  );
  const updatePolicyHolderAt = (index: number, patch: QuoteDataLike): PortfolioLike => {
    const nextPolicyHolders = policyHolders.map((holder, holderIndex) => (
      holderIndex === index ? { ...holder, ...patch } : holder
    ));
    return updatePolicyHolders(nextPolicyHolders);
  };
  const updatePolicyHolderAddressAt = (index: number, patch: QuoteDataLike): PortfolioLike => {
    const holder = policyHolders[index] || {};
    const address = (holder.address && typeof holder.address === 'object' && !Array.isArray(holder.address)
      ? (holder.address as QuoteDataLike)
      : {}) as QuoteDataLike;
    return updatePolicyHolderAt(index, { address: { ...address, ...patch } });
  };
  const addPolicyHolder = () => {
    updatePolicyHolders([...policyHolders, { address: {} }]);
  };
  const removePolicyHolder = (index: number) => {
    updatePolicyHolders(policyHolders.filter((_, holderIndex) => holderIndex !== index));
  };
  return (
    <div className="space-y-7 max-w-full pb-0">
      {/* Policy holder actions (edit controls live only here) */}
      {selectedPortfolio?.status !== 'BOUND' && (
        <div className="flex items-center justify-end gap-3 min-h-controlXs">
          {lockPolicyholderEdits ? (
            // Reserve space so the layout doesn't "jump" when actions are hidden.
            <div className="h-controlXs" aria-hidden />
          ) : !isEditing && !selectedPortfolio?.isNew ? (
            <Button
              variant="secondary"
              size="md"
              onClick={() => setIsEditing(true)}
              className="gap-2 h-controlXs px-5 rounded-2xl text-[11px] font-black uppercase tracking-widest"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              Edit
            </Button>
          ) : (
            <>
              <Button
                ref={cancelButtonRef}
                variant="secondary"
                size="md"
                onClick={handleCancelPolicyHolder}
                className="h-controlXs px-5 rounded-2xl text-[11px] font-black uppercase tracking-widest"
              >
                Cancel
              </Button>
              <Button
                ref={saveButtonRef}
                variant="primary"
                size="md"
                onClick={selectedPortfolio?.isNew ? handleSavePolicy : handleSavePolicyHolder}
                disabled={loading}
                onKeyDown={(e) => {
                  if (e.key === 'Tab' && !e.shiftKey) {
                    e.preventDefault();
                    cancelButtonRef.current?.focus();
                  }
                }}
                className="gap-2 h-controlXs px-5 rounded-2xl text-[11px] font-black uppercase tracking-widest"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                {selectedPortfolio?.isNew ? 'Save & continue' : 'Save changes'}
              </Button>
            </>
          )}
        </div>
      )}

      {/* Auto-only rendering */}
      {(
        <>
          {/* Auto Insurance: Customer Details */}
          <section className="p-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 sm:gap-8">
              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">First Name</label>
                <div className="relative">
                  <Input
                    type="text"
                    name="firstName"
                    aria-label="First Name"
                    disabled={fieldDisabled}
                    value={String(proposer.firstName || '')}
                    onChange={(e) => {
                      const next = e.target.value;
                      const nextPortfolio = updateProposer({ firstName: next });
                      validateField('quoteData.proposer.firstName', next, nextPortfolio);
                      clearFieldError('quoteData.proposer.firstName');
                    }}
                    className={textFieldClass({
                      errorKey: 'quoteData.proposer.firstName',
                      changed: endorsementFieldChanged('proposer.firstName'),
                    })}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-200" style={{ opacity: showValidation && proposer.firstName && !formErrors['quoteData.proposer.firstName'] ? 1 : 0, transform: showValidation && proposer.firstName && !formErrors['quoteData.proposer.firstName'] ? 'translateY(-50%) scale(1)' : 'translateY(-50%) scale(0.8)' }}>
                    <div className="bg-emerald-50 rounded-full p-1">
                      <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  </div>
                </div>
                <FieldError message={formErrors['quoteData.proposer.firstName']} />
              </div>
              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Last Name</label>
                <div className="relative">
                  <Input
                    type="text"
                    name="lastName"
                    aria-label="Last Name"
                    disabled={fieldDisabled}
                    value={String(proposer.lastName || '')}
                    onChange={(e) => {
                      const next = e.target.value;
                      const nextPortfolio = updateProposer({ lastName: next });
                      validateField('quoteData.proposer.lastName', next, nextPortfolio);
                      clearFieldError('quoteData.proposer.lastName');
                    }}
                    className={textFieldClass({
                      errorKey: 'quoteData.proposer.lastName',
                      changed: endorsementFieldChanged('proposer.lastName'),
                    })}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-200" style={{ opacity: showValidation && proposer.lastName && !formErrors['quoteData.proposer.lastName'] ? 1 : 0, transform: showValidation && proposer.lastName && !formErrors['quoteData.proposer.lastName'] ? 'translateY(-50%) scale(1)' : 'translateY(-50%) scale(0.8)' }}>
                    <div className="bg-emerald-50 rounded-full p-1">
                      <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  </div>
                </div>
                <FieldError message={formErrors['quoteData.proposer.lastName']} />
              </div>
              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Date of Birth</label>
                <div className="relative">
                  <Input
                    type="date"
                    name="dateOfBirth"
                    aria-label="Date of Birth"
                    disabled={fieldDisabled}
                    value={String(proposer.dateOfBirth || '')}
                    onValueChange={(next) => {
                      const nextPortfolio = updateProposer({ dateOfBirth: next });
                      validateField('quoteData.proposer.dateOfBirth', next, nextPortfolio);
                      clearFieldError('quoteData.proposer.dateOfBirth');
                    }}
                    className={textFieldClass({
                      errorKey: 'quoteData.proposer.dateOfBirth',
                      changed: endorsementFieldChanged('proposer.dateOfBirth'),
                    })}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-200" style={{ opacity: showValidation && proposer.dateOfBirth && !formErrors['quoteData.proposer.dateOfBirth'] ? 1 : 0, transform: showValidation && proposer.dateOfBirth && !formErrors['quoteData.proposer.dateOfBirth'] ? 'translateY(-50%) scale(1)' : 'translateY(-50%) scale(0.8)' }}>
                    <div className="bg-emerald-50 rounded-full p-1">
                      <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  </div>
                </div>
                <FieldError message={formErrors['quoteData.proposer.dateOfBirth']} />
              </div>
            </div>
          </section>

          <section className="p-0">
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-5 sm:gap-8">
              <div className="relative group/field lg:col-span-2 xl:col-span-4">
                <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Address</label>
                <div className="relative">
                  <AddressAutocomplete
                    value={String(proposerAddress.line1 || '')}
                    onChange={(val) => {
                      const nextPortfolio = updateProposerAddress({ line1: val });
                      validateField('quoteData.proposer.address.line1', val, nextPortfolio);
                      clearFieldError('quoteData.proposer.address.line1');
                    }}
                    onAddressSelect={(data) => {
                      const nextPortfolio = updateProposerAddress({
                        line1: data.address || proposerAddress.line1,
                        city: data.city || proposerAddress.city,
                        province: data.state || proposerAddress.province,
                        postcode: data.zip || proposerAddress.postcode,
                        country: data.country || proposerAddress.country,
                      });
                      const nextAddr = ((nextPortfolio.quoteData as QuoteDataLike | undefined)?.proposer as QuoteDataLike | undefined)?.address as QuoteDataLike | undefined ?? {};
                      validateField('quoteData.proposer.address.line1', String(nextAddr.line1 || ''), nextPortfolio);
                      validateField('quoteData.proposer.address.city', String(nextAddr.city || ''), nextPortfolio);
                      validateField('quoteData.proposer.address.province', String(nextAddr.province || ''), nextPortfolio);
                      validateField('quoteData.proposer.address.postcode', String(nextAddr.postcode || ''), nextPortfolio);
                      validateField('quoteData.proposer.address.country', String(nextAddr.country || ''), nextPortfolio);
                      clearFieldError('quoteData.proposer.address.line1');
                      clearFieldError('quoteData.proposer.address.city');
                      clearFieldError('quoteData.proposer.address.province');
                      clearFieldError('quoteData.proposer.address.postcode');
                      clearFieldError('quoteData.proposer.address.country');
                    }}
                    placeholder="Search address..."
                    disabled={fieldDisabled}
                    inputVariant="ui"
                    className={textFieldClass({
                      errorKey: 'quoteData.proposer.address.line1',
                      changed: endorsementFieldChanged('proposer.address.line1'),
                    })}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-200" style={{ opacity: showValidation && proposerAddress.line1 && !formErrors['quoteData.proposer.address.line1'] ? 1 : 0, transform: showValidation && proposerAddress.line1 && !formErrors['quoteData.proposer.address.line1'] ? 'translateY(-50%) scale(1)' : 'translateY(-50%) scale(0.8)' }}>
                    <div className="bg-emerald-50 rounded-full p-1">
                      <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  </div>
                </div>
                <FieldError message={formErrors['quoteData.proposer.address.line1']} />
              </div>
              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">City</label>
                <div className="relative">
                  <Input
                    type="text"
                    name="city"
                    aria-label="City"
                    disabled={fieldDisabled}
                    value={String(proposerAddress.city || '')}
                    onChange={(e) => {
                      const next = e.target.value;
                      const nextPortfolio = updateProposerAddress({ city: next });
                      validateField('quoteData.proposer.address.city', next, nextPortfolio);
                      clearFieldError('quoteData.proposer.address.city');
                    }}
                    className={textFieldClass({
                      errorKey: 'quoteData.proposer.address.city',
                      changed: endorsementFieldChanged('proposer.address.city'),
                    })}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-200" style={{ opacity: showValidation && proposerAddress.city && !formErrors['quoteData.proposer.address.city'] ? 1 : 0, transform: showValidation && proposerAddress.city && !formErrors['quoteData.proposer.address.city'] ? 'translateY(-50%) scale(1)' : 'translateY(-50%) scale(0.8)' }}>
                    <div className="bg-emerald-50 rounded-full p-1">
                      <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  </div>
                </div>
                <FieldError message={formErrors['quoteData.proposer.address.city']} />
              </div>
              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Province</label>
                <div className="relative">
                  <Input
                    type="text"
                    name="province"
                    aria-label="Province"
                    disabled={fieldDisabled}
                    value={String(proposerAddress.province || '')}
                    onChange={(e) => {
                      const next = e.target.value;
                      const currentPostCode = String(proposerAddress.postcode || '');
                      const country = String(proposerAddress.country || '');
                      const normalizedPostCode = normalizePostCodeForCountry(currentPostCode, country);
                      const postCodeError = validatePostCodeForCountry(normalizedPostCode, country);
                      const shouldClearPostCode = Boolean(normalizedPostCode && postCodeError);
                      const nextPortfolio = updateProposerAddress({ province: next, postcode: shouldClearPostCode ? '' : normalizedPostCode });
                      validateField('quoteData.proposer.address.province', next, nextPortfolio);
                      validateField('quoteData.proposer.address.postcode', shouldClearPostCode ? '' : normalizedPostCode, nextPortfolio);
                      if (shouldClearPostCode) {
                        setFieldError('quoteData.proposer.address.postcode', 'Post Code was cleared because it does not match selected country/state requirements.');
                      } else {
                        clearFieldError('quoteData.proposer.address.postcode');
                      }
                      clearFieldError('quoteData.proposer.address.province');
                    }}
                    className={textFieldClass({
                      errorKey: 'quoteData.proposer.address.province',
                      changed: endorsementFieldChanged('proposer.address.province'),
                    })}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-200" style={{ opacity: showValidation && proposerAddress.province && !formErrors['quoteData.proposer.address.province'] ? 1 : 0, transform: showValidation && proposerAddress.province && !formErrors['quoteData.proposer.address.province'] ? 'translateY(-50%) scale(1)' : 'translateY(-50%) scale(0.8)' }}>
                    <div className="bg-emerald-50 rounded-full p-1">
                      <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  </div>
                </div>
                <FieldError message={formErrors['quoteData.proposer.address.province']} />
              </div>
              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Post Code</label>
                <div className="relative">
                  <Input
                    type="text"
                    name="postCode"
                    aria-label="Post Code"
                    disabled={fieldDisabled}
                    value={String(proposerAddress.postcode || '')}
                    onChange={(e) => {
                      const next = e.target.value;
                      const nextPortfolio = updateProposerAddress({ postcode: next });
                      validateField('quoteData.proposer.address.postcode', next, nextPortfolio);
                      clearFieldError('quoteData.proposer.address.postcode');
                    }}
                    className={textFieldClass({
                      errorKey: 'quoteData.proposer.address.postcode',
                      changed: endorsementFieldChanged('proposer.address.postcode'),
                    })}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-200" style={{ opacity: showValidation && proposerAddress.postcode && !formErrors['quoteData.proposer.address.postcode'] ? 1 : 0, transform: showValidation && proposerAddress.postcode && !formErrors['quoteData.proposer.address.postcode'] ? 'translateY(-50%) scale(1)' : 'translateY(-50%) scale(0.8)' }}>
                    <div className="bg-emerald-50 rounded-full p-1">
                      <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  </div>
                </div>
                <FieldError message={formErrors['quoteData.proposer.address.postcode']} />
              </div>
              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Country</label>
                <div className="relative">
                  <SearchableSelect
                    value={String(proposerAddress.country || '')}
                    onChange={(next) => {
                      const currentPostCode = String(proposerAddress.postcode || '');
                      const normalizedPostCode = normalizePostCodeForCountry(currentPostCode, next);
                      const postCodeError = validatePostCodeForCountry(normalizedPostCode, next);
                      const shouldClearPostCode = Boolean(normalizedPostCode && postCodeError);
                      const nextPortfolio = updateProposerAddress({ country: next, postcode: shouldClearPostCode ? '' : normalizedPostCode });
                      const nextAddr = ((nextPortfolio.quoteData as QuoteDataLike | undefined)?.proposer as QuoteDataLike | undefined)?.address as QuoteDataLike | undefined ?? {};
                      validateField('quoteData.proposer.address.country', next, nextPortfolio);
                      validateField('quoteData.proposer.address.province', String(nextAddr.province || ''), nextPortfolio);
                      validateField('quoteData.proposer.address.postcode', shouldClearPostCode ? '' : normalizedPostCode, nextPortfolio);
                      if (shouldClearPostCode) {
                        setFieldError('quoteData.proposer.address.postcode', 'Post Code was cleared because it does not match selected country/state requirements.');
                      } else {
                        clearFieldError('quoteData.proposer.address.postcode');
                      }
                      clearFieldError('quoteData.proposer.address.country');
                    }}
                    options={countryOptions}
                    placeholder="Search country..."
                    searchPlaceholder="Type to search..."
                    disabled={fieldDisabled}
                    error={Boolean(formErrors['quoteData.proposer.address.country'])}
                    showValidTick={true}
                    isValid={Boolean(
                      showValidation &&
                      hasSelectedOption(proposerAddress.country) &&
                      !formErrors['quoteData.proposer.address.country']
                    )}
                  />
                </div>
                <FieldError message={formErrors['quoteData.proposer.address.country']} />
              </div>
            </div>
          </section>

          <section className="p-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 sm:gap-8">
              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Email</label>
                <div className="relative">
                  <Input
                    type="text"
                    name="email"
                    aria-label="Email"
                    disabled={fieldDisabled}
                    value={String(proposer.email || '')}
                    onChange={(e) => {
                      const next = e.target.value;
                      const nextPortfolio = updateProposer({ email: next });
                      validateField('quoteData.proposer.email', next, nextPortfolio);
                      clearFieldError('quoteData.proposer.email');
                    }}
                    placeholder=""
                    className={textFieldClass({
                      errorKey: 'quoteData.proposer.email',
                      changed: endorsementFieldChanged('proposer.email'),
                    })}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-200" style={{ opacity: showValidation && proposer.email && !formErrors['quoteData.proposer.email'] ? 1 : 0, transform: showValidation && proposer.email && !formErrors['quoteData.proposer.email'] ? 'translateY(-50%) scale(1)' : 'translateY(-50%) scale(0.8)' }}>
                    <div className="bg-emerald-50 rounded-full p-1">
                      <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  </div>
                </div>
                <FieldError message={formErrors['quoteData.proposer.email']} />
              </div>
              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Telephone</label>
                <div className="relative">
                  <PhoneInputField
                    name="telephone"
                    aria-label="Telephone"
                    placeholder="Enter phone number"
                    disabled={fieldDisabled}
                    value={String(proposer.phone || '').replace(/\s+/g, '')}
                    onChange={(v: string | undefined) => {
                      const next = String(v || '');
                      const nextPortfolio = updateProposer({ phone: next });
                      validateField('quoteData.proposer.phone', next, nextPortfolio);
                      clearFieldError('quoteData.proposer.phone');
                    }}
                    international
                    limitMaxLength={true}
                    defaultCountry={REGION_CONFIG.defaultRegionCode}
                    error={Boolean(formErrors['quoteData.proposer.phone'])}
                    changed={endorsementFieldChanged('proposer.phone')}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-200" style={{ opacity: showValidation && proposer.phone && !formErrors['quoteData.proposer.phone'] ? 1 : 0, transform: showValidation && proposer.phone && !formErrors['quoteData.proposer.phone'] ? 'translateY(-50%) scale(1)' : 'translateY(-50%) scale(0.8)' }}>
                    <div className="bg-emerald-50 rounded-full p-1">
                      <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  </div>
                </div>
                <FieldError message={formErrors['quoteData.proposer.phone']} />
              </div>
              <div className="relative group/field z-20">
                <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Nationality</label>
                <div className="relative">
                  <SearchableSelect
                    value={String(proposer.nationality || '')}
                    onChange={(next) => {
                      const nextPortfolio = updateProposer({ nationality: next });
                      validateField('quoteData.proposer.nationality', next, nextPortfolio);
                      clearFieldError('quoteData.proposer.nationality');
                    }}
                    options={countryOptions}
                    placeholder="Search nationality..."
                    searchPlaceholder="Type to search..."
                    disabled={fieldDisabled}
                    error={Boolean(formErrors['quoteData.proposer.nationality'])}
                    showValidTick={true}
                    isValid={Boolean(
                      showValidation &&
                      hasSelectedOption(proposer.nationality) &&
                      !formErrors['quoteData.proposer.nationality']
                    )}
                  />
                </div>
                <FieldError message={formErrors['quoteData.proposer.nationality']} />
              </div>
              <div className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">NIF</label>
                <div className="relative">
                  <Input
                    type="text"
                    name="nif"
                    aria-label="NIF"
                    disabled={fieldDisabled}
                    value={String(proposer.nif || '')}
                    onChange={(e) => {
                      const next = e.target.value;
                      const nextPortfolio = updateProposer({ nif: next });
                      validateField('quoteData.proposer.nif', next, nextPortfolio);
                      clearFieldError('quoteData.proposer.nif');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Tab' && !e.shiftKey && saveButtonRef.current) {
                        e.preventDefault();
                        saveButtonRef.current.focus();
                      }
                    }}
                    className={textFieldClass({
                      errorKey: 'quoteData.proposer.nif',
                      changed: endorsementFieldChanged('proposer.nif'),
                    })}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-200" style={{ opacity: showValidation && proposer.nif && !formErrors['quoteData.proposer.nif'] ? 1 : 0, transform: showValidation && proposer.nif && !formErrors['quoteData.proposer.nif'] ? 'translateY(-50%) scale(1)' : 'translateY(-50%) scale(0.8)' }}>
                    <div className="bg-emerald-50 rounded-full p-1">
                      <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  </div>
                </div>
                <FieldError message={formErrors['quoteData.proposer.nif']} />
              </div>
            </div>
          </section>

          <section className="p-0">
            {/* Moved Occupation + Lead Source to Underwriting tab (Part 2: Driving & History) */}
          </section>

          {supportsJointProposers && (
            <>
              <AdditionalPolicyHolders
                policyHolders={policyHolders}
                formErrors={formErrors}
                showValidation={showValidation}
                fieldDisabled={fieldDisabled}
                countryOptions={countryOptions}
                validateField={validateField}
                clearFieldError={clearFieldError}
                endorsementFieldChanged={endorsementFieldChanged}
                updatePolicyHolderAt={updatePolicyHolderAt}
                updatePolicyHolderAddressAt={updatePolicyHolderAddressAt}
                removePolicyHolder={removePolicyHolder}
                hasSelectedOption={hasSelectedOption}
                textFieldClass={textFieldClass}
              />

              <section className="p-0">
                <Button
                  variant="secondary"
                  size="md"
                  onClick={addPolicyHolder}
                  disabled={fieldDisabled}
                  className="h-11 rounded-2xl border-red-200 px-5 text-[11px] font-black uppercase tracking-widest text-red-600 hover:border-red-300 hover:bg-red-50"
                >
                  + Policy holder
                </Button>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

import React from 'react';
import { PageHeader } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import AddressAutocomplete from '@/src/shared/components/AddressAutocomplete';
import { SearchableSelect as UiSearchableSelect } from '@/src/shared/ui';
import { Modal } from '@/src/shared/ui';
import PhoneInput from 'react-phone-number-input';
import flags from 'react-phone-number-input/flags';
import 'react-phone-number-input/style.css';
import { Toast } from '@/src/shared/ui';
import type { Flags } from 'react-phone-number-input';

import { useClientProfileController } from '../controller/useClientProfileController';

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

export default function ClientProfilePage() {
  const ctrl = useClientProfileController();

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-10">
      <PageHeader
        title="Profile & Settings"
        subtitle="Update contact details and preferences."
        actions={(
          !ctrl.isEditing ? (
            <Button variant="secondary" size="lg" onClick={ctrl.startEditing} className="gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={() => void ctrl.handleSaveClick()} disabled={ctrl.loadingPolicies} className="gap-2">
              {ctrl.loadingPolicies ? (
                <>Checking...</>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Save changes
                </>
              )}
            </Button>
          )
        )}
      />

      <div className="ui-card ui-card-pad bg-white">
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Account</div>
        <div className="mt-2 text-xl font-black text-slate-900 mb-8">Policyholder Details</div>

        <div className={`space-y-6 ${!ctrl.isEditing ? 'opacity-80 pointer-events-none' : ''}`}>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="relative group/field">
              <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">First Name</label>
              <Input
                type="text"
                value={ctrl.formData.firstName}
                onChange={(e) => ctrl.handleChange('firstName', e.target.value)}
                className={`w-full ${!ctrl.isEditing ? 'bg-transparent' : 'bg-slate-50'} border ${ctrl.formErrors.firstName ? 'border-red-500/50 ring-4 ring-red-500/5' : 'border-slate-200 hover:border-slate-300'} rounded-xl px-5 py-4 font-bold text-slate-800 focus:bg-white focus:border-brand-primary outline-none transition-all`}
              />
              <FieldError message={ctrl.formErrors.firstName} />
            </div>

            <div className="relative group/field">
              <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Last Name</label>
              <Input
                type="text"
                value={ctrl.formData.lastName}
                onChange={(e) => ctrl.handleChange('lastName', e.target.value)}
                className={`w-full ${!ctrl.isEditing ? 'bg-transparent' : 'bg-slate-50'} border ${ctrl.formErrors.lastName ? 'border-red-500/50 ring-4 ring-red-500/5' : 'border-slate-200 hover:border-slate-300'} rounded-xl px-5 py-4 font-bold text-slate-800 focus:bg-white focus:border-brand-primary outline-none transition-all`}
              />
              <FieldError message={ctrl.formErrors.lastName} />
            </div>

            <div className="relative group/field">
              <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Date of Birth</label>
              <Input
                type="date"
                value={ctrl.formData.dateOfBirth}
                onValueChange={(next) => ctrl.handleChange('dateOfBirth', next)}
                className={`w-full ${!ctrl.isEditing ? 'bg-transparent' : 'bg-slate-50'} border border-slate-200 hover:border-slate-300 rounded-xl px-5 py-4 font-bold text-slate-800 focus:bg-white focus:border-brand-primary outline-none transition-all`}
              />
            </div>
            <div className="hidden md:block"></div>
          </div>

          <div className="relative group/field">
            <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Address</label>
            <AddressAutocomplete
              value={ctrl.formData.addressLine}
              onChange={(val) => ctrl.handleChange('addressLine', val)}
              onAddressSelect={ctrl.handleAddressSelect}
              placeholder="Search address..."
              disabled={!ctrl.isEditing}
              className={`w-full ${!ctrl.isEditing ? 'bg-transparent' : 'bg-slate-50'} border border-slate-200 hover:border-slate-300 rounded-xl px-5 py-4 font-bold text-slate-800 focus:bg-white focus:border-brand-primary outline-none transition-all`}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="relative group/field">
              <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">City</label>
              <Input
                type="text"
                value={ctrl.formData.city}
                onChange={(e) => ctrl.handleChange('city', e.target.value)}
                className={`w-full ${!ctrl.isEditing ? 'bg-transparent' : 'bg-slate-50'} border border-slate-200 hover:border-slate-300 rounded-xl px-5 py-4 font-bold text-slate-800 focus:bg-white focus:border-brand-primary outline-none transition-all`}
              />
            </div>
            <div className="relative group/field">
              <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Province</label>
              <Input
                type="text"
                value={ctrl.formData.province}
                onChange={(e) => ctrl.handleChange('province', e.target.value)}
                className={`w-full ${!ctrl.isEditing ? 'bg-transparent' : 'bg-slate-50'} border border-slate-200 hover:border-slate-300 rounded-xl px-5 py-4 font-bold text-slate-800 focus:bg-white focus:border-brand-primary outline-none transition-all`}
              />
            </div>
            <div className="relative group/field">
              <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Post Code</label>
              <Input
                type="text"
                value={ctrl.formData.postCode}
                onChange={(e) => ctrl.handleChange('postCode', e.target.value)}
                className={`w-full ${!ctrl.isEditing ? 'bg-transparent' : 'bg-slate-50'} border border-slate-200 hover:border-slate-300 rounded-xl px-5 py-4 font-bold text-slate-800 focus:bg-white focus:border-brand-primary outline-none transition-all`}
              />
            </div>
            <div className="relative group/field">
              <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Country</label>
              <Input
                type="text"
                value={ctrl.formData.country}
                onChange={(e) => ctrl.handleChange('country', e.target.value)}
                className={`w-full ${!ctrl.isEditing ? 'bg-transparent' : 'bg-slate-50'} border border-slate-200 hover:border-slate-300 rounded-xl px-5 py-4 font-bold text-slate-800 focus:bg-white focus:border-brand-primary outline-none transition-all`}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="relative group/field">
              <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Email</label>
              <Input
                type="text"
                value={ctrl.formData.email}
                onChange={(e) => ctrl.handleChange('email', e.target.value)}
                className={`w-full ${!ctrl.isEditing ? 'bg-transparent' : 'bg-slate-50'} border ${ctrl.formErrors.email ? 'border-red-500/50 ring-4 ring-red-500/5' : 'border-slate-200 hover:border-slate-300'} rounded-xl px-5 py-4 font-bold text-slate-800 focus:bg-white focus:border-brand-primary outline-none transition-all`}
              />
              <FieldError message={ctrl.formErrors.email} />
            </div>

            <div className="relative group/field">
              <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Telephone</label>
              <PhoneInput
                placeholder="Enter phone number"
                flags={flags as Flags}
                disabled={!ctrl.isEditing}
                value={ctrl.formData.telephone}
                onChange={(v) => ctrl.handleChange('telephone', String(v || ''))}
                international
                limitMaxLength={true}
                defaultCountry="CY"
                className={`w-full ${!ctrl.isEditing ? 'bg-transparent' : 'bg-slate-50'} border border-slate-200 hover:border-slate-300 rounded-xl px-5 py-4 font-bold text-slate-800 focus-within:bg-white focus-within:border-brand-primary transition-all [&_.PhoneInputInput]:bg-transparent [&_.PhoneInputInput]:outline-none [&_.PhoneInputInput]:flex-1 [&_.PhoneInputInput]:min-w-0 [&_.PhoneInputInput]:w-0 [&_.PhoneInputCountry]:mr-2 [&_.PhoneInputCountry]:shrink-0`}
              />
            </div>

            <div className="relative group/field">
              <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">Nationality</label>
              <UiSearchableSelect
                value={ctrl.formData.nationality}
                onChange={(val: string) => ctrl.handleChange('nationality', val)}
                options={ctrl.countryOptions}
                placeholder="Search..."
                searchPlaceholder="Type to search..."
                disabled={!ctrl.isEditing}
                showValidTick={false}
              />
            </div>

            <div className="relative group/field">
              <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">NIF</label>
              <Input
                type="text"
                value={ctrl.formData.nif}
                onChange={(e) => ctrl.handleChange('nif', e.target.value)}
                className={`w-full ${!ctrl.isEditing ? 'bg-transparent' : 'bg-slate-50'} border border-slate-200 hover:border-slate-300 rounded-xl px-5 py-4 font-bold text-slate-800 focus:bg-white focus:border-brand-primary outline-none transition-all`}
              />
            </div>
          </div>
        </div>
      </div>

      <Modal
        isOpen={ctrl.showConfirmModal}
        onClose={ctrl.closeModal}
        title="Material Change Notice"
        maxWidth="max-w-md"
        actions={
          <>
            <Button variant="secondary" onClick={ctrl.closeModal} disabled={ctrl.isSaving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={ctrl.confirmSave} disabled={ctrl.isSaving}>
              {ctrl.isSaving ? 'Processing...' : 'Confirm Actions'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-4">
            <svg className="w-6 h-6 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="text-sm text-amber-900 font-medium leading-relaxed">
              Updating details on an active policy constitutes a <strong>Material Fact Change</strong>.
              This action will trigger the automated issuance of a <strong>Policy Amendment</strong> reflecting the new information.
            </div>
          </div>
          <p className="text-slate-600 font-bold text-sm text-center">
            Are you sure you want to proceed with these changes?
          </p>
        </div>
      </Modal>

      <Toast
        isVisible={ctrl.showToast}
        onClose={ctrl.closeToast}
        message="Profile details updated successfully."
      />
    </div>
  );
}

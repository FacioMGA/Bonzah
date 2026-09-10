/**
 * AccountIdentityForm — Company info + primary contact fields.
 *
 * Pure presentation. Receives form state and setters from controller.
 */
import React from 'react';
import PhoneInput from 'react-phone-number-input';
import flags from 'react-phone-number-input/flags';
import 'react-phone-number-input/style.css';

import AddressAutocomplete from '@/src/shared/components/AddressAutocomplete';
import { Input } from '@/src/shared/ui';
import { Select } from '@/src/shared/ui';
import type { AccountFormState } from '@/src/modules/accounts/model/account';

const phoneInputFlags: React.ComponentProps<typeof PhoneInput>['flags'] = flags;

interface Props {
    form: AccountFormState;
    errors: Record<string, string>;
    autoFocusName: boolean;
    onFieldChange: (patch: Partial<AccountFormState>) => void;
    onClearError: (field: string) => void;
}

export function AccountIdentityForm({ form, errors, autoFocusName, onFieldChange, onClearError }: Props) {
    return (
        <div className="space-y-10 animate-in fade-in duration-300">
            <div className="grid grid-cols-2 gap-8">
                <div className="space-y-6">
                    <div className="relative group/field">
                        <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">Company / Name</label>
                        <Input
                            variant="ui"
                            className={`w-full bg-slate-50/50 border rounded-2xl px-5 py-4 font-bold text-slate-700 outline-none transition-colors ${errors.name ? 'border-red-500 bg-red-50' : 'border-slate-200 focus:bg-white focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10'}`}
                            placeholder="e.g. Acme Holdings LLC"
                            value={form.name}
                            onChange={e => {
                                onFieldChange({ name: e.target.value });
                                if (errors.name) onClearError('name');
                            }}
                            autoFocus={autoFocusName}
                        />
                        {errors.name && <p className="text-red-500 text-xs mt-1 font-medium">{errors.name}</p>}
                    </div>
                    <div className="relative group/field">
                        <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">Market Segment</label>
                        <Select
                            variant="ui"
                            className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl px-5 py-4 font-bold text-slate-700 outline-none focus:bg-white focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-colors appearance-none"
                            value={form.segment}
                            onChange={e => onFieldChange({ segment: e.target.value })}
                        >
                            <option>Real Estate</option>
                            <option>Construction</option>
                            <option>Hospitality</option>
                            <option>Retail</option>
                            <option>Technology</option>
                            <option>Other</option>
                        </Select>
                    </div>
                </div>
                <div className="space-y-6">
                    <div className="relative group/field">
                        <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">Address</label>
                        <AddressAutocomplete
                            className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl px-5 py-4 font-bold text-slate-700 outline-none focus:bg-white focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-colors"
                            placeholder="Search address..."
                            value={form.address}
                            onChange={(val) => onFieldChange({ address: val })}
                            onAddressSelect={(data) => {
                                onFieldChange({
                                    address: data.address,
                                    city: data.city,
                                    state: data.state,
                                    zip: data.zip,
                                });
                            }}
                        />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div className="relative group/field">
                            <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">City</label>
                            <Input
                                variant="ui"
                                className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl px-5 py-4 font-bold text-slate-700 outline-none focus:bg-white focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-colors"
                                value={form.city || ''}
                                onChange={e => onFieldChange({ city: e.target.value })}
                            />
                        </div>
                        <div className="relative group/field">
                            <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">State</label>
                            <Input
                                variant="ui"
                                className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl px-5 py-4 font-bold text-slate-700 outline-none focus:bg-white focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-colors"
                                value={form.state || ''}
                                onChange={e => onFieldChange({ state: e.target.value })}
                            />
                        </div>
                        <div className="relative group/field">
                            <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">Zip</label>
                            <Input
                                variant="ui"
                                className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl px-5 py-4 font-bold text-slate-700 outline-none focus:bg-white focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-colors"
                                value={form.zip || ''}
                                onChange={e => onFieldChange({ zip: e.target.value })}
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-8 pt-8 border-t border-slate-100">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6 flex items-center gap-2">
                    <svg className="w-4 h-4 text-brand-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    Primary Contact
                </h3>
                <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-6">
                        <div className="relative group/field">
                            <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">First Name</label>
                            <Input
                                variant="ui"
                                className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl px-5 py-4 font-bold text-slate-700 outline-none focus:bg-white focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-colors"
                                placeholder="John"
                                value={form.firstName}
                                onChange={e => onFieldChange({ firstName: e.target.value })}
                            />
                        </div>
                        <div className="relative group/field">
                            <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">Email Address</label>
                            <Input
                                variant="ui"
                                className={`w-full bg-slate-50/50 border rounded-2xl px-5 py-4 font-bold text-slate-700 outline-none transition-colors ${errors.email ? 'border-red-500 bg-red-50' : 'border-slate-200 focus:bg-white focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10'}`}
                                placeholder="john@example.com"
                                value={form.email}
                                onChange={e => {
                                    onFieldChange({ email: e.target.value });
                                    if (errors.email) onClearError('email');
                                }}
                            />
                            {errors.email && <p className="text-red-500 text-xs mt-1 font-medium">{errors.email}</p>}
                        </div>
                    </div>
                    <div className="space-y-6">
                        <div className="relative group/field">
                            <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">Last Name</label>
                            <Input
                                variant="ui"
                                className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl px-5 py-4 font-bold text-slate-700 outline-none focus:bg-white focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 transition-colors"
                                placeholder="Doe"
                                value={form.lastName}
                                onChange={e => onFieldChange({ lastName: e.target.value })}
                            />
                        </div>
                        <div className="relative group/field">
                            <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">Phone Number</label>
                            <div className="relative">
                                <PhoneInput
                                    className={`w-full bg-slate-50/50 border ${errors.phone ? 'border-red-500/50 ring-4 ring-red-500/5' : 'border-slate-200 hover:border-slate-300'} rounded-2xl px-5 py-4 font-bold text-slate-700 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] focus-within:bg-white focus-within:border-brand-primary focus-within:ring-4 focus-within:ring-brand-primary/10 transition-all duration-300 [&_.PhoneInputInput]:bg-transparent [&_.PhoneInputInput]:outline-none [&_.PhoneInputInput]:flex-1 [&_.PhoneInputInput]:min-w-0 [&_.PhoneInputInput]:w-0 [&_.PhoneInputCountry]:mr-2 [&_.PhoneInputCountry]:shrink-0 opacity-100`}
                                    placeholder="Enter phone number"
                                    flags={phoneInputFlags}
                                    value={form.phone}
                                    onChange={(val) => {
                                        onFieldChange({ phone: val?.toString() || '' });
                                        if (errors.phone) onClearError('phone');
                                    }}
                                    defaultCountry="US"
                                    limitMaxLength={true}
                                />
                            </div>
                            {errors.phone && <p className="text-red-500 text-xs mt-1 font-medium">{errors.phone}</p>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * AccountFinancialForm — Bank accounts management tab.
 *
 * Pure presentation. Receives bank accounts array and setForm from controller.
 */
import React from 'react';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import type { AccountFormState } from '@/src/modules/accounts/model/account';

interface Props {
    bankAccounts: AccountFormState['bankAccounts'];
    onSetForm: React.Dispatch<React.SetStateAction<AccountFormState>>;
}

export function AccountFinancialForm({ bankAccounts, onSetForm }: Props) {
    const addRow = () => {
        onSetForm(prev => ({
            ...prev,
            bankAccounts: [...prev.bankAccounts, { bankName: 'New Bank', accountNumber: '', routingNumber: '' }],
        }));
    };

    const updateField = (index: number, field: 'bankName' | 'accountNumber' | 'routingNumber', value: string) => {
        onSetForm(prev => ({
            ...prev,
            bankAccounts: prev.bankAccounts.map((b, idx) => idx === index ? { ...b, [field]: value } : b),
        }));
    };

    const removeRow = (index: number) => {
        onSetForm(prev => ({
            ...prev,
            bankAccounts: prev.bankAccounts.filter((_, idx) => idx !== index),
        }));
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="font-bold text-slate-800">Bank Accounts</h3>
                    <p className="text-xs text-slate-500">Manage connected bank accounts for reconciliation.</p>
                </div>
                <Button onClick={addRow}>+ Add Account Row</Button>
            </div>

            {bankAccounts.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl">
                    <p className="text-slate-400 font-bold">No bank accounts linked.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {bankAccounts.map((acct, i) => (
                        <div key={i} className="py-4 flex items-center justify-between border-b border-slate-200/60 last:border-0">
                            <div className="flex items-center space-x-4">
                                <div className="w-10 h-10 bg-slate-100/60 rounded-full flex items-center justify-center text-slate-500">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" /></svg>
                                </div>
                                <div className="flex-1 grid grid-cols-3 gap-4">
                                    <Input
                                        className="font-bold text-slate-800 bg-transparent border-b border-transparent focus:border-slate-300 outline-none"
                                        value={acct.bankName}
                                        onChange={(e) => updateField(i, 'bankName', e.target.value)}
                                        placeholder="Bank Name"
                                    />
                                    <Input
                                        className="text-slate-600 font-mono bg-transparent border-b border-transparent focus:border-slate-300 outline-none"
                                        value={acct.accountNumber}
                                        onChange={(e) => updateField(i, 'accountNumber', e.target.value)}
                                        placeholder="Account Number"
                                    />
                                    <Input
                                        className="text-slate-400 font-mono text-xs bg-transparent border-b border-transparent focus:border-slate-300 outline-none"
                                        value={acct.routingNumber || ''}
                                        onChange={(e) => updateField(i, 'routingNumber', e.target.value)}
                                        placeholder="Routing Number"
                                    />
                                </div>
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeRow(i)}
                                className="text-slate-300 hover:text-red-500 bg-transparent"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </Button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

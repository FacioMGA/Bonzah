/**
 * AccountDetailView — Composition shell for account detail/edit.
 *
 * Delegates to AccountIdentityForm and AccountFinancialForm.
 * This component owns tabs + layout + action buttons only.
 */
import React from 'react';
import { PageHeader } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import type { AccountFormState } from '@/src/modules/accounts/model/account';
import { AccountIdentityForm } from './AccountIdentityForm';
import { AccountFinancialForm } from './AccountFinancialForm';

const TABS: Array<{ id: 'identity' | 'financial'; label: string }> = [
    { id: 'identity', label: 'Identity' },
    { id: 'financial', label: 'Financial Info' },
];

interface Props {
    form: AccountFormState;
    errors: Record<string, string>;
    activeTab: 'identity' | 'financial';
    editingAccountId: string | null;
    isEditing: boolean;
    onSetForm: React.Dispatch<React.SetStateAction<AccountFormState>>;
    onSetErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    onSetActiveTab: (tab: 'identity' | 'financial') => void;
    onSetIsEditing: (value: boolean) => void;
    onSave: () => void;
    onNavigateToList: () => void;
}

export function AccountDetailView({
    form,
    errors,
    activeTab,
    editingAccountId,
    isEditing,
    onSetForm,
    onSetErrors,
    onSetActiveTab,
    onSetIsEditing,
    onSave,
    onNavigateToList,
}: Props) {
    const handleFieldChange = (patch: Partial<AccountFormState>) => {
        onSetForm(prev => ({ ...prev, ...patch }));
    };

    const handleClearError = (field: string) => {
        onSetErrors(prev => ({ ...prev, [field]: '' }));
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-32">
            <div className="flex flex-col space-y-4">
                <PageHeader
                    breadcrumb={{
                        label: 'Return to list',
                        onClick: onNavigateToList,
                    }}
                    title={editingAccountId ? form.name : 'New account'}
                    subtitle="Policy holder identity and financial information."
                />
            </div>
            <div className="ui-card ui-card-flat bg-brand-canvas overflow-hidden">
                <div className="px-8 bg-brand-canvas">
                    <div className="ui-tabsbar">
                        {TABS.map(tab => (
                            <Button
                                key={tab.id}
                                type="button"
                                variant="tab"
                                size="tab"
                                onClick={() => onSetActiveTab(tab.id)}
                                className={`ui-tab ${activeTab === tab.id ? 'ui-tab-active' : 'ui-tab-inactive'}`}
                            >
                                {tab.label}
                            </Button>
                        ))}
                    </div>
                </div>
                <div className="px-8 pt-6 pb-10 bg-brand-canvas min-h-[500px]">
                    <fieldset disabled={Boolean(editingAccountId && !isEditing)} className={editingAccountId && !isEditing ? 'opacity-90' : ''}>
                        {activeTab === 'identity' && (
                            <AccountIdentityForm
                                form={form}
                                errors={errors}
                                autoFocusName={!editingAccountId || isEditing}
                                onFieldChange={handleFieldChange}
                                onClearError={handleClearError}
                            />
                        )}
                        {activeTab === 'financial' && (
                            <AccountFinancialForm
                                bankAccounts={form.bankAccounts}
                                onSetForm={onSetForm}
                            />
                        )}
                    </fieldset>

                    <div className="mt-10 flex justify-end gap-3">
                        {editingAccountId && !isEditing ? (
                            <Button variant="secondary" size="lg" onClick={() => onSetIsEditing(true)} className="gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                Edit
                            </Button>
                        ) : (
                            <Button onClick={onSave} disabled={!form.name} size="lg" className="gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                {editingAccountId ? 'Save changes' : 'Create account'}
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

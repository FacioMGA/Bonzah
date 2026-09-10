import React from 'react';
import { accountsApiClient } from '@/src/modules/accounts/api/accountsApiClient';
import { Button, Input, PageHeader, Toast } from '@/src/shared/ui';
import { settingsApiClient } from '../api/settingsApiClient';

type WorkspaceOrganizationProfileViewProps = {
  accountId: string | null;
};

type OrganizationFormState = {
  organizationName: string;
  legalEntityName: string;
  registrationNumber: string;
  address: string;
  contactEmail: string;
};

type ToastState = {
  message: string;
  type: 'success' | 'error';
};

type AccountRecord = {
  id?: string;
  name?: string;
  segment?: string;
  address?: string;
  contact?: Record<string, unknown>;
  bankAccounts?: unknown[];
};

const WORKSPACE_PROFILE_KEY = 'workspace_profile.v1';

const EMPTY_FORM: OrganizationFormState = {
  organizationName: '',
  legalEntityName: '',
  registrationNumber: '',
  address: '',
  contactEmail: '',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  optional = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  optional?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="space-y-2">
      <span className="block text-xs font-black uppercase tracking-widest text-slate-400">
        {label}
        {optional ? ' (optional)' : ''}
      </span>
      <Input
        variant="ui"
        className="ui-input"
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        placeholder={placeholder}
        disabled={disabled}
      />
    </label>
  );
}

export function WorkspaceOrganizationProfileView({ accountId }: WorkspaceOrganizationProfileViewProps) {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [toast, setToast] = React.useState<ToastState | null>(null);
  const [form, setForm] = React.useState<OrganizationFormState>(EMPTY_FORM);
  const [accountRecord, setAccountRecord] = React.useState<AccountRecord | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!accountId) {
        setLoading(false);
        setToast({ message: 'No workspace account is associated with this user.', type: 'error' });
        return;
      }

      setLoading(true);
      try {
        const [accountRes, workspaceProfileRes] = await Promise.all([
          accountsApiClient.getAccount(accountId),
          settingsApiClient.getSettings(WORKSPACE_PROFILE_KEY).catch(() => null),
        ]);

        if (cancelled) return;

        const nextAccountRecord = accountRes?.success ? asRecord(accountRes.data) as AccountRecord : null;
        const nextContact = asRecord(nextAccountRecord?.contact);
        const workspaceProfile = workspaceProfileRes && typeof workspaceProfileRes === 'object' && 'success' in workspaceProfileRes
          ? asRecord((workspaceProfileRes as { data?: unknown }).data)
          : {};

        setAccountRecord(nextAccountRecord);
        setForm({
          organizationName: asString(nextAccountRecord?.name),
          legalEntityName: asString(workspaceProfile.legalEntityName),
          registrationNumber: asString(workspaceProfile.registrationNumber),
          address: asString(nextAccountRecord?.address),
          contactEmail: asString(nextContact.email),
        });
      } catch {
        if (cancelled) return;
        setToast({ message: 'Failed to load workspace profile.', type: 'error' });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const handleFieldChange = React.useCallback((field: keyof OrganizationFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSave = React.useCallback(async () => {
    if (!accountId) {
      setToast({ message: 'Cannot save without a workspace account.', type: 'error' });
      return;
    }

    setSaving(true);
    try {
      const existingContact = asRecord(accountRecord?.contact);
      const bankAccounts = Array.isArray(accountRecord?.bankAccounts) ? accountRecord?.bankAccounts : [];

      const [accountRes] = await Promise.all([
        accountsApiClient.updateAccount(accountId, {
          name: form.organizationName,
          segment: asString(accountRecord?.segment) || 'Real Estate',
          address: form.address,
          contact: {
            ...existingContact,
            email: form.contactEmail,
          },
          bankAccounts,
        }),
        settingsApiClient.saveSettings(WORKSPACE_PROFILE_KEY, {
          version: 1,
          legalEntityName: form.legalEntityName,
          registrationNumber: form.registrationNumber,
        }),
      ]);

      if (!accountRes?.success) {
        throw new Error('Account update failed');
      }

      setAccountRecord((prev) => ({
        ...prev,
        name: form.organizationName,
        address: form.address,
        contact: {
          ...asRecord(prev?.contact),
          email: form.contactEmail,
        },
      }));
      setToast({ message: 'Workspace profile saved.', type: 'success' });
    } catch {
      setToast({ message: 'Failed to save workspace profile.', type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [accountId, accountRecord, form]);

  if (loading) {
    return <div className="ui-page max-w-4xl text-slate-400">Loading workspace profile...</div>;
  }

  return (
    <div className="ui-page max-w-4xl space-y-8">
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          isVisible={Boolean(toast)}
          onClose={() => setToast(null)}
        />
      )}

      <PageHeader
        title="Organization Profile"
        subtitle="Single-workspace identity, legal profile, and contact details for workspace configuration."
        status={{ label: 'Workspace record', tone: 'info' }}
        actions={(
          <Button size="lg" onClick={() => void handleSave()} disabled={saving || !accountId || !form.organizationName.trim()}>
            {saving ? 'Saving…' : 'Save profile'}
          </Button>
        )}
      />

      <section className="ui-card ui-card-pad space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Field
            label="Organization / MGA name"
            value={form.organizationName}
            onChange={(value) => handleFieldChange('organizationName', value)}
            placeholder="My MGA"
          />
          <Field
            label="Legal entity name"
            value={form.legalEntityName}
            onChange={(value) => handleFieldChange('legalEntityName', value)}
            placeholder="My Holdings Ltd"
          />
          <Field
            label="Registration number"
            value={form.registrationNumber}
            onChange={(value) => handleFieldChange('registrationNumber', value)}
            placeholder="Optional company registration number"
            optional
          />
          <Field
            label="Contact email"
            value={form.contactEmail}
            onChange={(value) => handleFieldChange('contactEmail', value)}
            placeholder="ops@workspace.example"
          />
        </div>

        <Field
          label="Address"
          value={form.address}
          onChange={(value) => handleFieldChange('address', value)}
          placeholder="Workspace registered address"
        />
      </section>

      <section className="ui-card ui-card-pad space-y-4">
        <div>
          <h2 className="text-lg font-black text-slate-900">Branding</h2>
          <p className="mt-1 text-sm text-slate-500">
            Logo upload will be added in a later phase. This page establishes the workspace profile contract first.
          </p>
        </div>
        <Field
          label="Logo upload"
          value="Coming soon"
          disabled
        />
      </section>
    </div>
  );
}

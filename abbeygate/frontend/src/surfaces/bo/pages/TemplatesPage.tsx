import React, { useEffect, useMemo, useState } from 'react';
import { PageHeader, Button, Toast } from '@/src/shared/ui';
import { settingsApiClient } from '@/src/modules/settings/api/settingsApiClient';

type TemplateType = 'quote' | 'certificate' | 'invoice' | 'bordereaux';
type UnknownRecord = Record<string, unknown>;

type TemplateSlot = {
  type: TemplateType;
  title: string;
  description: string;
  key: 'localQuoteTemplatePath' | 'localCertificateTemplatePath' | 'localInvoiceTemplatePath' | 'bordereauxTemplatePath';
};

const TEMPLATE_SLOTS: TemplateSlot[] = [
  {
    type: 'quote',
    title: 'Quote document template',
    description: 'Source template used when generating customer quote documents.',
    key: 'localQuoteTemplatePath',
  },
  {
    type: 'certificate',
    title: 'Certificate template',
    description: 'Source template used for generated certificate artifacts.',
    key: 'localCertificateTemplatePath',
  },
  {
    type: 'invoice',
    title: 'Invoice template',
    description: 'Source template used for invoice document generation.',
    key: 'localInvoiceTemplatePath',
  },
  {
    type: 'bordereaux',
    title: 'Bordereaux template',
    description: 'Workbook or template path used for reporting exports.',
    key: 'bordereauxTemplatePath',
  },
];

function text(value: unknown): string {
  return String(value || '').trim();
}

const TemplatesPage: React.FC = () => {
  const [settings, setSettings] = useState<UnknownRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState<TemplateType | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const templateUploadMode = useMemo(
    () => text(settings?.templateUploadMode) || 'disk',
    [settings],
  );

  const loadSettings = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await settingsApiClient.getTemplateSettings();
      if (!response.success) throw new Error(response.error?.message || 'Failed to load template settings');
      setSettings((response.data || {}) as UnknownRecord);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load template settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const uploadTemplate = async (slot: TemplateSlot, file: File) => {
    setSavingType(slot.type);
    setError('');
    try {
      const response = await settingsApiClient.uploadTemplate(file, slot.type);
      if (!response.success) throw new Error(response.error?.message || 'Template upload failed');
      await loadSettings();
      setToast(`${slot.title} updated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Template upload failed');
    } finally {
      setSavingType(null);
    }
  };

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-8">
      <Toast message={toast} isVisible={Boolean(toast)} onClose={() => setToast('')} type="success" />
      <PageHeader
        title="Document template settings"
        subtitle="Live document-generation template paths from the platform settings contract."
        status={{ label: templateUploadMode === 'storage' ? 'Storage-backed' : 'Disk-backed', tone: 'info' }}
        actions={<Button variant="secondary" onClick={() => void loadSettings()} disabled={loading}>Refresh</Button>}
      />

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="ui-card ui-card-pad text-sm font-semibold text-slate-500">Loading template settings...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {TEMPLATE_SLOTS.map((slot) => {
            const currentPath = text(settings?.[slot.key]);
            const busy = savingType === slot.type;
            return (
              <section key={slot.key} className="ui-card ui-card-pad space-y-5">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    {slot.type}
                  </div>
                  <h2 className="mt-1 text-xl font-black text-slate-900">{slot.title}</h2>
                  <p className="mt-2 text-sm font-semibold text-slate-500">{slot.description}</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Current path</div>
                  <div className="mt-2 break-all font-mono text-xs font-semibold text-slate-700">
                    {currentPath || 'Not configured'}
                  </div>
                </div>

                <label className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-brand-primary px-4 py-3 text-sm font-black text-white transition hover:bg-brand-secondary">
                  {busy ? 'Uploading...' : 'Upload replacement'}
                  <input
                    type="file"
                    className="sr-only"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) void uploadTemplate(slot, file);
                    }}
                  />
                </label>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TemplatesPage;

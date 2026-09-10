import React, { useState, useEffect } from 'react';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import { Toast } from '@/src/shared/ui';
import { PageHeader } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import { FileUpload } from '@/src/shared/ui';

import { logger } from '@/src/shared/lib/logger';
import { asRecord } from '@/src/shared/lib/record';

type GlobalSettings = {
  rate: number;
  splits: {
    retailBroker: number;
    broker: number;
    mga: number;
  };
  localQuoteTemplatePath: string;
  localCertificateTemplatePath: string;
  localInvoiceTemplatePath: string;
  bordereauxTemplatePath: string;
  sendgridAutoQuoteInitialTemplateId: string;
  sendgridAutoQuoteResendTemplateId: string;
};

const DEFAULT_SETTINGS: GlobalSettings = {
  rate: 0.23,
  splits: {
    retailBroker: 10,
    broker: 10,
    mga: 80,
  },
  localQuoteTemplatePath: '',
  localCertificateTemplatePath: '',
  localInvoiceTemplatePath: '',
  bordereauxTemplatePath: '',
  sendgridAutoQuoteInitialTemplateId: '',
  sendgridAutoQuoteResendTemplateId: '',
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeSettings(input: unknown, base: GlobalSettings): GlobalSettings {
  const src = asRecord(input);
  const srcSplits = asRecord(src.splits);
  return {
    ...base,
    rate: asNumber(src.rate, base.rate),
    splits: {
      retailBroker: asNumber(srcSplits.retailBroker, base.splits.retailBroker),
      broker: asNumber(srcSplits.broker, base.splits.broker),
      mga: asNumber(srcSplits.mga, base.splits.mga),
    },
    localQuoteTemplatePath: asString(src.localQuoteTemplatePath) || base.localQuoteTemplatePath,
    localCertificateTemplatePath: asString(src.localCertificateTemplatePath) || base.localCertificateTemplatePath,
    localInvoiceTemplatePath: asString(src.localInvoiceTemplatePath) || base.localInvoiceTemplatePath,
    bordereauxTemplatePath: asString(src.bordereauxTemplatePath) || base.bordereauxTemplatePath,
    sendgridAutoQuoteInitialTemplateId: asString(src.sendgridAutoQuoteInitialTemplateId) || base.sendgridAutoQuoteInitialTemplateId,
    sendgridAutoQuoteResendTemplateId: asString(src.sendgridAutoQuoteResendTemplateId) || base.sendgridAutoQuoteResendTemplateId,
  };
}

const SettingsGlobalPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<GlobalSettings>(DEFAULT_SETTINGS);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const [globalRes, templatesRes, emailTemplatesRes] = await Promise.all([
          api.getGlobalSettings(),
          api.getTemplateSettings(),
          api.getEmailTemplateSettings(),
        ]);

        let mergedSettings = { ...DEFAULT_SETTINGS };

        if (globalRes.success && globalRes.data) {
          mergedSettings = normalizeSettings(globalRes.data, mergedSettings);
        }
        if (templatesRes.success && templatesRes.data) {
          mergedSettings = normalizeSettings(templatesRes.data, mergedSettings);
        }
        if (emailTemplatesRes.success && emailTemplatesRes.data) {
          mergedSettings = normalizeSettings(emailTemplatesRes.data, mergedSettings);
        }

        setSettings(mergedSettings);
      } catch (err) {
        logger.error('Failed to fetch settings:', err);
        setToast({ message: 'Failed to load settings', type: 'error' });
      } finally {
        setLoading(false);
      }
    };
    void fetchSettings();
  }, []);

  const handleUploadTemplate = async (file: File, type: 'quote' | 'certificate' | 'invoice' | 'bordereaux') => {
    try {
      setToast({ message: `Uploading ${type} template...`, type: 'success' });
      const response = await api.uploadTemplate(file, type);
      if (response.success && response.data) {
        setToast({ message: `${type} template uploaded successfully`, type: 'success' });

        const updateKey = type === 'quote' ? 'localQuoteTemplatePath' :
          type === 'certificate' ? 'localCertificateTemplatePath' :
            type === 'invoice' ? 'localInvoiceTemplatePath' : 'bordereauxTemplatePath';

        const nextPath = String((response.data as { path?: string } | undefined)?.path || '');
        setSettings((prev) => ({ ...prev, [updateKey]: nextPath }));
      } else {
        setToast({ message: 'Upload failed: ' + (response.error?.message || 'Unknown error'), type: 'error' });
      }
    } catch (error) {
      logger.error('Upload error:', error);
      setToast({ message: 'Error uploading file', type: 'error' });
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      const commissionData = {
        rate: settings.rate,
        splits: settings.splits
      };

      const templateData = {
        localQuoteTemplatePath: settings.localQuoteTemplatePath,
        localCertificateTemplatePath: settings.localCertificateTemplatePath,
        localInvoiceTemplatePath: settings.localInvoiceTemplatePath,
        bordereauxTemplatePath: settings.bordereauxTemplatePath
      };

      const emailTemplateData = {
        sendgridAutoQuoteInitialTemplateId: settings.sendgridAutoQuoteInitialTemplateId,
        sendgridAutoQuoteResendTemplateId: settings.sendgridAutoQuoteResendTemplateId,
      };

      const [res1, res2, res3] = await Promise.all([
        api.updateGlobalSettings(commissionData),
        api.updateTemplateSettings(templateData),
        api.updateEmailTemplateSettings(emailTemplateData),
      ]);

      if (res1.success && res2.success && res3.success) {
        setToast({ message: 'All settings saved successfully', type: 'success' });
      } else {
        setToast({ message: 'Some settings failed to save', type: 'error' });
      }
    } catch (err) {
      logger.error('Failed to save settings:', err);
      setToast({ message: 'Error saving settings', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-10 text-slate-400">Loading settings...</div>;

  return (
    <div className="ui-page max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      {toast && <Toast message={toast.message} type={toast.type} isVisible={!!toast} onClose={() => setToast(null)} />}

      <PageHeader
        title="Global configuration"
        subtitle="Define the core parameters for billing and commission calculations."
        actions={(
          <Button onClick={() => void handleSave()} disabled={saving} size="lg">
            {saving ? 'Saving…' : 'Save configuration'}
          </Button>
        )}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <section className="ui-card ui-card-pad space-y-6">
          <h3 className="ui-section-title">
            <div className="w-1.5 h-1.5 rounded-full bg-brand-primary mr-3"></div>
            Billing Parameters
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-2 ml-1">Default Premium Rate (%)</label>
              <div className="relative">
                <Input
                  type="number"
                  step="0.01"
                  value={settings.rate * 100}
                  onChange={(e) => setSettings({ ...settings, rate: parseFloat(e.target.value) / 100 })}
                  className="ui-input pr-12 font-extrabold"
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 font-black text-slate-300">%</span>
              </div>
            </div>
          </div>
        </section>

        <section className="ui-card ui-card-pad space-y-6">
          <h3 className="ui-section-title">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mr-3"></div>
            Commission Splits (%)
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-2 ml-1">Retail Broker Share</label>
              <div className="relative">
                <Input
                  type="number"
                  value={settings.splits.retailBroker}
                  onChange={(e) => setSettings({
                    ...settings,
                    splits: { ...settings.splits, retailBroker: parseFloat(e.target.value) }
                  })}
                  className="ui-input pr-12 font-extrabold"
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 font-black text-slate-300">%</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-2 ml-1">Broker Share</label>
              <div className="relative">
                <Input
                  type="number"
                  value={settings.splits.broker}
                  onChange={(e) => setSettings({
                    ...settings,
                    splits: { ...settings.splits, broker: parseFloat(e.target.value) }
                  })}
                  className="ui-input pr-12 font-extrabold"
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 font-black text-slate-300">%</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-2 ml-1">MGA Net Share</label>
              <div className="relative">
                <Input
                  type="number"
                  value={settings.splits.mga}
                  onChange={(e) => setSettings({
                    ...settings,
                    splits: { ...settings.splits, mga: parseFloat(e.target.value) }
                  })}
                  className="ui-input pr-12 font-extrabold bg-brand-primary/5 border-brand-primary/20 text-brand-primary focus:ring-brand-primary/10 focus:border-brand-primary"
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 font-black text-brand-primary/40">%</span>
              </div>
            </div>

            <div className="pt-2 px-1 flex justify-between items-center text-[10px] font-extrabold uppercase tracking-tighter">
              <span className="text-slate-400">Total Split</span>
              <span className={(settings.splits.retailBroker + settings.splits.broker + settings.splits.mga) === 100 ? 'text-brand-primary' : 'text-red-500'}>
                {settings.splits.retailBroker + settings.splits.broker + settings.splits.mga}%
                {(settings.splits.retailBroker + settings.splits.broker + settings.splits.mga) !== 100 && ' (Must equal 100%)'}
              </span>
            </div>
          </div>
        </section>

        <section className="ui-card ui-card-pad space-y-6 md:col-span-2">
          <h3 className="ui-section-title">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mr-3"></div>
            Document Templates
          </h3>

          <p className="text-sm text-slate-500 mb-4">
            Manage the templates used for generating Quotes, Certificates, Invoices, and Bordereaux.
            Templates are stored and versioned locally within the platform runtime.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
              <h4 className="font-bold text-slate-700">Quote Template</h4>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 ml-1">Local Fallback Template (.docx)</label>
                <div className="flex gap-2 items-center">
                  <Input
                    type="text"
                    readOnly
                    value={settings.localQuoteTemplatePath || 'Not set'}
                    className="ui-input bg-slate-100 text-slate-500 text-xs flex-1"
                  />
                  <FileUpload
                    label="Upload"
                    accept=".docx"
                    onFileSelect={(f) => {
                      if (f[0]) void handleUploadTemplate(f[0], 'quote');
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
              <h4 className="font-bold text-slate-700">Certificate Template</h4>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 ml-1">Local Fallback Template (.docx)</label>
                <div className="flex gap-2 items-center">
                  <Input
                    type="text"
                    readOnly
                    value={settings.localCertificateTemplatePath || 'Not set'}
                    className="ui-input bg-slate-100 text-slate-500 text-xs flex-1"
                  />
                  <FileUpload
                    label="Upload"
                    accept=".docx"
                    onFileSelect={(f) => {
                      if (f[0]) void handleUploadTemplate(f[0], 'certificate');
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
              <h4 className="font-bold text-slate-700">Invoice Template</h4>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 ml-1">Local Fallback Template (.docx)</label>
                <div className="flex gap-2 items-center">
                  <Input
                    type="text"
                    readOnly
                    value={settings.localInvoiceTemplatePath || 'Not set'}
                    className="ui-input bg-slate-100 text-slate-500 text-xs flex-1"
                  />
                  <FileUpload
                    label="Upload"
                    accept=".docx"
                    onFileSelect={(f) => {
                      if (f[0]) void handleUploadTemplate(f[0], 'invoice');
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
              <h4 className="font-bold text-slate-700">Bordereaux Template</h4>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 ml-1">Excel Template Path (Local Only)</label>
                <div className="flex gap-2 items-center">
                  <Input
                    type="text"
                    readOnly
                    value={settings.bordereauxTemplatePath || 'Not set'}
                    className="ui-input bg-slate-100 text-slate-500 text-xs flex-1"
                  />
                  <FileUpload
                    label="Upload"
                    accept=".xlsx,.xls"
                    onFileSelect={(f) => {
                      if (f[0]) void handleUploadTemplate(f[0], 'bordereaux');
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="ui-card ui-card-pad space-y-6 md:col-span-2">
          <h3 className="ui-section-title">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-3"></div>
            Email Templates (SendGrid)
          </h3>

          <p className="text-sm text-slate-500 mb-4">
            Configure SendGrid Dynamic Template IDs used for customer emails.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-2 ml-1">Auto Quote - Initial (proposal)</label>
              <Input
                type="text"
                value={settings.sendgridAutoQuoteInitialTemplateId || ''}
                onChange={(e) => setSettings({ ...settings, sendgridAutoQuoteInitialTemplateId: e.target.value })}
                className="ui-input font-mono text-xs"
                placeholder="e.g. d-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-2 ml-1">Auto Quote - Resend (complete your quote)</label>
              <Input
                type="text"
                value={settings.sendgridAutoQuoteResendTemplateId || ''}
                onChange={(e) => setSettings({ ...settings, sendgridAutoQuoteResendTemplateId: e.target.value })}
                className="ui-input font-mono text-xs"
                placeholder="e.g. d-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              />
            </div>
          </div>
        </section>
      </div>

      <div className="bg-slate-900 p-10 rounded-[3rem] text-white overflow-hidden relative group">
        <div className="absolute top-0 right-0 w-64 h-64 bg-brand-primary/10 rounded-full blur-3xl -mr-32 -mt-32"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="max-w-md">
            <h4 className="text-xl font-bold mb-2 italic">Developer Note: Math Verification</h4>
            <p className="text-slate-400 text-sm leading-relaxed">
              These parameters directly influence the <span className="text-brand-primary font-black">processor.ts</span> calculation logic.
              The monthly fee is calculated as: <br />
              <code className="bg-white/5 px-2 py-1 rounded text-[11px] block mt-2 text-slate-300">
                (Rent * Multiplier * Rate) / 12
              </code>
            </p>
          </div>
          <div className="bg-white/5 p-6 rounded-2xl border border-white/10 backdrop-blur-sm">
            <div className="text-[10px] font-black text-brand-primary uppercase tracking-[0.2em] mb-4">Live Preview</div>
            <div className="space-y-2">
              <div className="flex justify-between w-48 text-sm"><span className="text-slate-500">Example Fee:</span> <span className="font-bold text-white">$7,314.96</span></div>
              <div className="flex justify-between w-48 text-sm"><span className="text-slate-500">MGA Net:</span> <span className="font-bold text-brand-primary/70">${(7314.96 * (settings.splits.mga / 100)).toFixed(2)}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsGlobalPage;

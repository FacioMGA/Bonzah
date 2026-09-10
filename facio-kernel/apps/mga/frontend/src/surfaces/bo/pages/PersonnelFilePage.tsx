import React, { useEffect, useState } from 'react';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import { PageHeader, Button, Input } from '@/src/shared/ui';

export default function PersonnelFilePage() {
  const [form, setForm] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  useEffect(() => {
    void api.getMyPersonnelFile().then((response) => {
      if (response.success && response.data) {
        const data = response.data;
        setForm({
          staffNumber: String(data.staffNumber || ''),
          jobTitle: String(data.jobTitle || ''),
          office: String(data.office || ''),
          phone: String(data.phone || ''),
          notes: String(data.notes || ''),
        });
      }
    });
  }, []);

  const save = async () => {
    const response = await api.saveMyPersonnelFile(form);
    setMessage(response.success ? 'Personnel file saved.' : response.error?.message || 'Failed to save.');
  };

  return (
    <div className="ui-page max-w-3xl mx-auto space-y-6">
      <PageHeader title="Personnel File" subtitle="Your own basic personnel record." />
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        {['staffNumber', 'jobTitle', 'office', 'phone', 'notes'].map((field) => (
          <Input key={field} variant="ui" placeholder={field} value={form[field] || ''} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} />
        ))}
        <Button type="button" variant="primary" size="md" onClick={() => void save()}>Save</Button>
        {message && <p className="text-sm font-semibold text-slate-600">{message}</p>}
      </div>
    </div>
  );
}

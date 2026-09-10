import React from 'react';
import { Checkbox, Select, Textarea } from '@/src/shared/ui';
import type { JsonObject, JsonValue } from '@/src/modules/programs/components/StructuredJsonEditor';

type ExternalIssuanceMode = 'NONE' | 'manager_upload_after_payment';

function asObject(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function lines(value: string): string[] {
  return value.split('\n').map((entry) => entry.trim()).filter(Boolean);
}

/** Shared editor for the workflow component used by issuance and payment readiness. */
export function ProgrammeWorkflowEditor({ value, onChange }: { value: JsonObject; onChange: (next: JsonObject) => void }) {
  const externalIssuance = asObject(value.externalIssuance);
  const mode = externalIssuance?.mode;
  if (typeof value.referralOnly !== 'boolean' || (mode !== 'NONE' && mode !== 'manager_upload_after_payment')) {
    return <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">This draft requires an explicit referral-only setting and an approved external-issuance mode. Workflow is never inferred from product defaults.</p>;
  }
  const configuredExternalIssuance = externalIssuance as JsonObject;
  const documentTypes = Array.isArray(configuredExternalIssuance.documentTypes) && configuredExternalIssuance.documentTypes.every((entry) => typeof entry === 'string')
    ? configuredExternalIssuance.documentTypes as string[]
    : [];
  const updateExternalIssuance = (next: JsonObject) => onChange({ ...value, externalIssuance: next });
  return <section className="space-y-5">
    <div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Workflow and issuance</h3><p className="mt-1 text-xs font-semibold text-slate-500">These settings are used by referral handling, payment readiness and policy issuance.</p></div>
    <Checkbox checked={value.referralOnly as boolean} onChange={(event) => onChange({ ...value, referralOnly: event.target.checked })} label="This programme is referral only" />
    <div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">External issuance</p><Select value={mode} onChange={(event) => updateExternalIssuance({ ...configuredExternalIssuance, mode: event.target.value as ExternalIssuanceMode })} aria-label="External issuance mode"><option value="NONE">Issued by operating MGA</option><option value="manager_upload_after_payment">Manager uploads issued documents after payment</option></Select></div>
    {mode === 'manager_upload_after_payment' ? <div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Required external documents</p><Textarea rows={4} value={documentTypes.join('\n')} onChange={(event) => updateExternalIssuance({ ...configuredExternalIssuance, documentTypes: lines(event.target.value) })} aria-label="Required external documents" /><p className="text-xs font-medium text-slate-500">One registered document type per line. Issuance is blocked until all are uploaded.</p></div> : null}
  </section>;
}

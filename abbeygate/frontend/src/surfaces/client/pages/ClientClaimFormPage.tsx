import React from 'react';
import { PageHeader } from '@/src/shared/ui';
import { Button, Card } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import { Select } from '@/src/shared/ui';
import { Textarea } from '@/src/shared/ui';

import {
  useClientClaimFormController,
  isEditableField,
  asString,
} from '../controller/useClientClaimFormController';

export default function ClientClaimFormPage() {
  const ctrl = useClientClaimFormController();

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-8">
      <PageHeader
        breadcrumb={{ label: 'Back to claim', onClick: ctrl.goBackToClaim }}
        title="Full Claim Form"
        subtitle="Complete the requested claim package."
      />

      {ctrl.loading ? (
        <div className="text-slate-500 font-semibold">Loading claim form…</div>
      ) : ctrl.error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-900">{ctrl.error}</div>
      ) : !ctrl.claimPackage ? (
        <Card className="border-none p-4 text-sm font-semibold text-slate-700">Claim form is not available yet.</Card>
      ) : (
        <>
          {(() => {
            const packageStatus = ctrl.claimPackage.status;
            return (
              <>
                {ctrl.claimPackage.status === 'COMPLETED' ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
                    This claim form package has already been completed. You can review the fields below in read-only mode.
                  </div>
                ) : null}
                {Object.entries(ctrl.fieldsBySection).map(([section, fields]) => (
                  <section key={section} className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
                    <h3 className="text-lg font-black text-slate-900">{section}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {fields.map((field) => (
                        <div key={field.fieldId} className={field.type === 'textarea' ? 'md:col-span-2' : ''}>
                          <div className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">
                            {field.label}{field.required ? ' *' : ''}
                          </div>
                          {field.mode === 'derived' ? (
                            <div className="ui-input bg-slate-50 text-slate-600">{asString(ctrl.responses[field.fieldId]) || 'Calculated from other answers'}</div>
                          ) : field.type === 'textarea' ? (
                            <Textarea
                              className={`ui-input ${ctrl.fieldErrors[field.fieldId] ? 'border-red-300' : ''}`}
                              rows={4}
                              value={asString(ctrl.responses[field.fieldId])}
                              disabled={!isEditableField(field, packageStatus)}
                              onChange={(e) => ctrl.setResponse(field.fieldId, e.target.value)}
                            />
                          ) : field.type === 'select' ? (
                            <Select
                              className={`ui-input ${ctrl.fieldErrors[field.fieldId] ? 'border-red-300' : ''}`}
                              value={asString(ctrl.responses[field.fieldId])}
                              disabled={!isEditableField(field, packageStatus)}
                              onChange={(e) => ctrl.setResponse(field.fieldId, e.target.value)}
                            >
                              <option value="">Select…</option>
                              {(field.options || []).map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                            </Select>
                          ) : field.type === 'checkbox' ? (
                            <label className="inline-flex items-center gap-2">
                              <Input
                                type="checkbox"
                                checked={Boolean(ctrl.responses[field.fieldId])}
                                disabled={!isEditableField(field, packageStatus)}
                                onChange={(e) => ctrl.setResponse(field.fieldId, e.target.checked)}
                              />
                              <span className="text-sm font-semibold text-slate-700">Confirmed</span>
                            </label>
                          ) : (
                            <Input
                              type={field.type === 'date' ? 'date' : 'text'}
                              className={`ui-input ${ctrl.fieldErrors[field.fieldId] ? 'border-red-300' : ''}`}
                              value={asString(ctrl.responses[field.fieldId])}
                              disabled={!isEditableField(field, packageStatus)}
                              onChange={(e) => ctrl.setResponse(field.fieldId, e.target.value)}
                            />
                          )}
                          {ctrl.fieldErrors[field.fieldId] ? (
                            <div className="mt-1 text-xs font-semibold text-rose-700">{ctrl.fieldErrors[field.fieldId]}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </section>
                ))}

                {packageStatus !== 'COMPLETED' ? (
                  <div className="sticky bottom-4 z-30">
                    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm p-4 flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold text-slate-600">
                        {ctrl.missingRequired || Object.keys(ctrl.fieldErrors).length > 0
                          ? 'Please resolve required fields and validation errors.'
                          : 'Ready to submit claim form package.'}
                      </div>
                      <Button onClick={() => void ctrl.submit()} disabled={ctrl.saving || ctrl.missingRequired || Object.keys(ctrl.fieldErrors).length > 0}>
                        {ctrl.saving ? 'Submitting…' : 'Submit Claim Form'}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}

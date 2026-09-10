import React from 'react';
import { Button, Input, Select } from '@/src/shared/ui';
import { MOTOR_LICENSE_YEARS_OPTIONS } from '@facio/products';
import { normalizeAdditionalDrivers, type AdditionalDriverDraft } from '../model/questionnaireHelpers';

type QuestionType = 'date' | 'boolean' | 'number' | 'currency' | 'textarea' | 'select' | 'multiselect' | 'text' | 'percentage' | 'list';

const emptyDriver = (): AdditionalDriverDraft => ({
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  licenseYears: '',
  email: '',
  telephone: '',
});

export function AdditionalDriversListField(props: {
  fieldKey: string;
  value: unknown;
  fieldDisabled: boolean;
  fieldError?: string;
  updateQuestionField: (key: string, type: QuestionType | undefined, rawValue: unknown) => void;
  validateFieldOnBlur: (fieldPath: string) => void;
}) {
  const drivers = normalizeAdditionalDrivers(props.value);
  const updateDriver = (index: number, patch: Partial<AdditionalDriverDraft>) => {
    const next = drivers.map((driver, idx) => (idx === index ? { ...driver, ...patch } : driver));
    props.updateQuestionField(props.fieldKey, 'list', next);
  };

  return (
    <div id={`uw-field-${props.fieldKey}`} className="md:col-span-2 rounded-2xl border border-slate-200/80 bg-white/40 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Additional driver details</div>
          <div className="mt-1 text-xs font-semibold text-slate-500">Required when additional drivers is Yes.</div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={props.fieldDisabled}
          onClick={() => props.updateQuestionField(props.fieldKey, 'list', [...drivers, emptyDriver()])}
        >
          Add driver
        </Button>
      </div>
      {props.fieldError ? <div className="mt-3 text-xs font-semibold text-rose-700">{props.fieldError}</div> : null}
      <div className="mt-4 space-y-4">
        {drivers.length === 0 ? (
          <div className="text-sm font-semibold text-amber-800">Add at least one additional driver.</div>
        ) : drivers.map((driver, index) => (
          <div key={index} className="rounded-xl border border-slate-200/80 bg-white/70 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-black uppercase tracking-widest text-slate-500">Driver {index + 1}</div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={props.fieldDisabled}
                onClick={() => props.updateQuestionField(props.fieldKey, 'list', drivers.filter((_, idx) => idx !== index))}
              >
                Remove
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input value={driver.firstName} placeholder="First name *" disabled={props.fieldDisabled} onBlur={() => props.validateFieldOnBlur(props.fieldKey)} onChange={(event) => updateDriver(index, { firstName: event.target.value })} />
              <Input value={driver.lastName} placeholder="Last name *" disabled={props.fieldDisabled} onBlur={() => props.validateFieldOnBlur(props.fieldKey)} onChange={(event) => updateDriver(index, { lastName: event.target.value })} />
              <Input type="date" value={driver.dateOfBirth} disabled={props.fieldDisabled} onBlur={() => props.validateFieldOnBlur(props.fieldKey)} onValueChange={(next) => updateDriver(index, { dateOfBirth: next })} />
              <Select value={String(driver.licenseYears ?? '')} disabled={props.fieldDisabled} onBlur={() => props.validateFieldOnBlur(props.fieldKey)} onChange={(event) => updateDriver(index, { licenseYears: event.target.value })}>
                <option value="">License years *</option>
                {MOTOR_LICENSE_YEARS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
              <Input value={driver.email} type="email" placeholder="Email (optional)" disabled={props.fieldDisabled} onBlur={() => props.validateFieldOnBlur(props.fieldKey)} onChange={(event) => updateDriver(index, { email: event.target.value })} />
              <Input value={driver.telephone} placeholder="Telephone (optional)" disabled={props.fieldDisabled} onBlur={() => props.validateFieldOnBlur(props.fieldKey)} onChange={(event) => updateDriver(index, { telephone: event.target.value })} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

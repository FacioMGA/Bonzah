import React from 'react';
import type { FieldDef, UwConfigSchemaDef } from '@facio/products';
import { DateInput } from '@/src/shared/ui';
import { readPath } from './manifestHelpers';

export interface SchemaDrivenFormProps {
  schema: UwConfigSchemaDef;
  value: Record<string, unknown>;
  onChange: (path: string, value: unknown) => void;
  readOnly?: boolean;
  className?: string;
}

function renderField(field: FieldDef, value: unknown, onChange: (v: unknown) => void, disabled: boolean) {
  const common = {
    id: `schema-field-${field.path}`,
    disabled,
    className:
      'w-full border border-slate-200 bg-white rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary outline-none transition-all disabled:bg-slate-50 disabled:text-slate-500',
  };

  if (field.type === 'boolean') {
    return (
      <label className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          disabled={disabled}
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary"
        />
        <span className="text-sm text-slate-700">{field.placeholder || 'Enabled'}</span>
      </label>
    );
  }
  if (field.type === 'select') {
    return (
      <select {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">{field.placeholder || 'Select...'}</option>
        {(field.options || []).map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'textarea') {
    return <textarea {...common} rows={3} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  }
  if (field.type === 'number' || field.type === 'currency' || field.type === 'percent') {
    return (
      <input
        {...common}
        type="number"
        min={field.min}
        max={field.max}
        step={field.type === 'percent' ? 0.01 : 1}
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        placeholder={field.placeholder}
      />
    );
  }
  if (field.type === 'date') {
    return (
      <DateInput
        id={common.id}
        value={String(value ?? '')}
        onChange={onChange}
        disabled={disabled}
        placeholder={field.placeholder}
        aria-label={field.label}
        inputClassName={common.className}
      />
    );
  }
  // Default: text
  return (
    <input
      {...common}
      type="text"
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      pattern={field.pattern}
    />
  );
}

/**
 * Generic schema-driven form renderer.
 *
 * Reads a ProductManifest's `uwConfigSchema` and renders grouped inputs from it.
 * Used by the BO program editor — each product declares its own UW config shape;
 * the editor renders it without any motor-specific code.
 */
export function SchemaDrivenForm({ schema, value, onChange, readOnly, className }: SchemaDrivenFormProps) {
  return (
    <div className={className ?? 'space-y-6'}>
      {schema.groups.map((group) => (
        <fieldset key={group.id} className="rounded-2xl border border-slate-200/80 bg-white p-5">
          <legend className="text-sm font-black text-slate-800 px-2">{group.title}</legend>
          {group.description && (
            <p className="text-xs text-slate-500 mb-3">{group.description}</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {group.fields.map((field) => (
              <div key={field.path}>
                <label
                  htmlFor={`schema-field-${field.path}`}
                  className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5"
                >
                  {field.label}
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                {renderField(
                  field,
                  readPath(value, field.path),
                  (v) => onChange(field.path, v),
                  Boolean(readOnly),
                )}
                {field.description && (
                  <p className="mt-1 text-xs text-slate-500">{field.description}</p>
                )}
              </div>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

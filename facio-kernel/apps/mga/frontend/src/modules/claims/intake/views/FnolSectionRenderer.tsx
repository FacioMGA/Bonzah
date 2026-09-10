import React from 'react';
import type { IntakeSectionDef } from '@/src/modules/claims/intake/model/types';
import { Input } from '@/src/shared/ui';
import { Select } from '@/src/shared/ui';
import { Textarea } from '@/src/shared/ui';
import { asRecord } from '@/src/shared/lib/record';

function getByPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => (asRecord(acc)[segment]), source);
}

function setByPath(source: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.');
  const clone = structuredClone(source);
  let cursor: Record<string, unknown> = clone;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const next = asRecord(cursor[part]);
    cursor[part] = next;
    cursor = next;
  }
  cursor[parts[parts.length - 1]] = value;
  return clone;
}

type Props = {
  section: IntakeSectionDef;
  snapshot: Record<string, unknown>;
  editable?: boolean;
  onChange?: (next: Record<string, unknown>) => void;
  anchorPrefix?: string;
  highlightPaths?: string[];
  changedFieldByPath?: Record<string, { changedAt: string; actorName?: string }>;
};

export function FnolSectionRenderer({
  section,
  snapshot,
  editable = false,
  onChange,
  anchorPrefix,
  highlightPaths = [],
  changedFieldByPath = {},
}: Props) {
  const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700';
  const anchorId = anchorPrefix ? `${anchorPrefix}-${section.id}` : undefined;
  const formatReadOnlyValue = (rawValue: unknown, fieldType: IntakeSectionDef['fields'][number]['type'], options?: Array<{ value: string; label: string }>): string => {
    if (rawValue === null || typeof rawValue === 'undefined') return '—';
    if (fieldType === 'select') {
      const normalized = typeof rawValue === 'boolean'
        ? (rawValue ? 'yes' : 'no')
        : String(rawValue).trim().toLowerCase();
      const match = (options || []).find((opt) => String(opt.value || '').trim().toLowerCase() === normalized);
      if (match?.label) return match.label;
      if (typeof rawValue === 'boolean') return rawValue ? 'Yes' : 'No';
      if (normalized === 'true') return 'Yes';
      if (normalized === 'false') return 'No';
      return String(rawValue).trim() || '—';
    }
    if (fieldType === 'date') {
      const rawText = String(rawValue || '').trim();
      if (!rawText) return '—';
      const dt = new Date(rawText);
      if (Number.isNaN(dt.getTime())) return rawText;
      const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric' }).format(dt);
      const month = new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(dt);
      const year = new Intl.DateTimeFormat('en-GB', { year: 'numeric' }).format(dt);
      return `${day} ${month}, ${year}`;
    }
    const text = String(rawValue).trim();
    return text || '—';
  };

  return (
    <section id={anchorId} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div>
        <h4 className="text-sm font-black text-slate-900">{section.title}</h4>
        {section.description ? <p className="text-xs font-medium text-slate-500">{section.description}</p> : null}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {section.fields
          .filter((field) => (field.visibleWhen ? field.visibleWhen(snapshot) : true))
          .map((field) => {
            const value = getByPath(snapshot, field.path);
            const display = value === null || value === undefined ? '' : String(value);
            const isRequired = field.requiredWhen ? field.requiredWhen(snapshot) : false;
            const wide = field.type === 'textarea';
            const isHighlighted = highlightPaths.includes(field.path);
            const changedMeta = changedFieldByPath[field.path];
            if (!editable) {
              return (
                <div key={field.path} className={wide ? 'md:col-span-2' : ''}>
                  <div className="flex items-center gap-2">
                    <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">{field.label}</div>
                    {changedMeta ? (
                      <span className="inline-flex items-center rounded-lg bg-blue-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-blue-700">
                        Changed by {changedMeta.actorName || 'user'}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-800 whitespace-pre-wrap">{formatReadOnlyValue(value, field.type, field.options)}</div>
                </div>
              );
            }
            return (
              <label key={field.path} className={wide ? 'md:col-span-2 space-y-1' : 'space-y-1'}>
                <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                  {field.label}{isRequired ? ' *' : ''}
                </div>
                {field.type === 'textarea' ? (
                  <Textarea
                    className={`${inputCls} min-h-24 ${isHighlighted ? 'border-amber-300 bg-amber-50/40' : ''}`}
                    value={display}
                    placeholder={field.placeholder}
                    onChange={(e) => onChange?.(setByPath(snapshot, field.path, e.target.value))}
                  />
                ) : field.type === 'select' ? (
                  <Select
                    variant="ui"
                    className={`${inputCls} ${isHighlighted ? 'border-amber-300 bg-amber-50/40' : ''}`}
                    value={display}
                    onChange={(e) => onChange?.(setByPath(snapshot, field.path, e.target.value))}
                  >
                    <option value="">Select</option>
                    {(field.options || []).map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    variant="ui"
                    className={`${inputCls} ${isHighlighted ? 'border-amber-300 bg-amber-50/40' : ''}`}
                    type={field.type === 'date' ? 'date' : 'text'}
                    value={display}
                    placeholder={field.placeholder}
                    onChange={(e) => onChange?.(setByPath(snapshot, field.path, e.target.value))}
                  />
                )}
              </label>
            );
          })}
      </div>
    </section>
  );
}

export function diffSnapshots(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: Array<{ path: string; from: unknown; to: unknown }> = [];
  const keys = new Set<string>();
  const collect = (prefix: string, value: unknown) => {
    const rec = asRecord(value);
    Object.keys(rec).forEach((k) => {
      const path = prefix ? `${prefix}.${k}` : k;
      keys.add(path);
      if (typeof rec[k] === 'object' && rec[k] !== null && !Array.isArray(rec[k])) collect(path, rec[k]);
    });
  };
  collect('', before);
  collect('', after);
  keys.forEach((path) => {
    const from = getByPath(before, path);
    const to = getByPath(after, path);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({ path, from, to });
  });
  return changes.filter((c) => !Array.isArray(c.to));
}


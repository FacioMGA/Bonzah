import React from 'react';
import type { ProductManifest } from '@facio/products';
import { readPath, formatCurrency, hasMeaningfulValue } from './manifestHelpers';

export interface InsuredObjectPanelProps {
  manifest: ProductManifest;
  data: unknown;
  className?: string;
}

/**
 * Renders the product's insured object summary (what's being insured) using
 * `manifest.insuredObject.fields`. For motor this prints year/make/model/fuel/
 * engine/value; for home it would print address/property type; and so on.
 *
 * Shared BO surfaces that need a compact "what's insured" block use this
 * component instead of hardcoding vehicle fields.
 */
export function InsuredObjectPanel({ manifest, data, className }: InsuredObjectPanelProps) {
  const rows = manifest.insuredObject.fields
    .map((field) => {
      const raw = readPath(data, field.path);
      if (!hasMeaningfulValue(raw)) return null;
      let display: string;
      if (field.type === 'currency') {
        display = formatCurrency(raw) ?? String(raw);
      } else if (field.type === 'boolean') {
        display = raw === true ? 'Yes' : 'No';
      } else {
        display = String(raw);
      }
      return { label: field.label, value: display };
    })
    .filter((row): row is { label: string; value: string } => row !== null);

  if (rows.length === 0) {
    return (
      <div className={className ?? 'text-sm text-slate-400'}>
        No {manifest.insuredObject.label.singular.toLowerCase()} information captured yet.
      </div>
    );
  }

  return (
    <dl className={className ?? 'grid grid-cols-2 gap-x-4 gap-y-1 text-sm'}>
      {rows.map((row) => (
        <React.Fragment key={row.label}>
          <dt className="text-slate-500 font-semibold">{row.label}</dt>
          <dd className="text-slate-900 font-bold truncate">{row.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

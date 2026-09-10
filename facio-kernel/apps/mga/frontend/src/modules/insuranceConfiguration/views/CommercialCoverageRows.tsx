import React, { useEffect, useRef, useState } from 'react';
import { configuredCommercialSegments } from '@facio/products';
import { http } from '@/src/shared/api/http';
export type CommercialCoverageRow = { coverage: string; limit: number | ''; excess: number | '' };
type CoverageOption = { name: string; maximum: string; deductible: string; territory: string };
export type CommercialCoverageRowsProps = { programId: string; binderProductAuthorityId: string; value: unknown; disabled?: boolean; onChange: (rows: CommercialCoverageRow[]) => void; fieldError?: string; currency?: string };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function draftRows(value: unknown): CommercialCoverageRow[] { return Array.isArray(value) ? value.map((row) => { const data = object(row); return { coverage: typeof data.coverage === 'string' ? data.coverage : '', limit: typeof data.limit === 'number' ? data.limit : '', excess: typeof data.excess === 'number' ? data.excess : '' }; }) : []; }
/** User-editable selections from the exact mapped published definition; prices remain server-owned. */
export function CommercialCoverageRows({ programId, binderProductAuthorityId, value, disabled, onChange, fieldError, currency }: CommercialCoverageRowsProps) {
  const [options, setOptions] = useState<CoverageOption[]>([]), [error, setError] = useState(''), [reference, setReference] = useState(''), [loading, setLoading] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current; setOptions([]); setReference(''); setError('');
    if (!programId || !binderProductAuthorityId) { setError('Select a programme and binder authority to load offered coverage.'); setLoading(false); return; }
    setLoading(true);
    void http.request<Record<string, unknown>>(`programs/${encodeURIComponent(programId)}/definition/${encodeURIComponent(binderProductAuthorityId)}`).then((response) => {
      if (current !== generation.current) return;
      if (!response.success || !response.data) throw new Error(response.error?.message || 'Published definition unavailable.');
      const definition = response.data, product = object(object(object(definition.workflow).insuranceConfiguration).product);
      if (!Array.isArray(product.coverageSections) || !product.coverageSections.length) throw new Error('This published definition has no configured commercial coverage.');
      setOptions(product.coverageSections.map((entry) => { const section = object(entry); return { name: String(section.coverageName || section.classOfBusinessLabel || section.classOfBusinessKey || ''), maximum: String(section.maxLimit ?? ''), deductible: String(section.deductible ?? ''), territory: String(section.territorialLimit ?? '') }; }));
      setReference(`Published definition ${String(definition.version)} · ${String(definition.id)}`);
    }).catch((failure: unknown) => { if (current === generation.current) setError(failure instanceof Error ? failure.message : 'Coverage could not be loaded.'); }).finally(() => { if (current === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [programId, binderProductAuthorityId]);
  const rows = draftRows(value);
  const update = (index: number, field: keyof CommercialCoverageRow, next: string | number) => onChange(rows.map((row, position) => position === index ? { ...row, [field]: next } as CommercialCoverageRow : row));
  const amount = (raw: string): number | '' => raw.trim() === '' ? '' : Number(raw);
  return <fieldset disabled={disabled || loading || !options.length} className="space-y-3 rounded-xl border border-slate-200 p-4" aria-label="Selected commercial coverage">
    <legend className="px-1 text-sm font-semibold">Selected coverage</legend>
    {loading ? <p role="status" className="text-sm">Loading published coverage…</p> : null}
    {error || fieldError ? <p role="alert" className="text-sm text-red-700">{error || fieldError}</p> : null}
    {reference ? <p className="break-all text-xs text-slate-500">{reference}</p> : null}
    {rows.map((row, index) => { const selected = options.find((option) => option.name === row.coverage); return <div key={index} className="space-y-2 rounded-lg bg-slate-50 p-3">
      <label className="block text-sm">Coverage {index + 1}<select aria-label={`Coverage ${index + 1}`} value={row.coverage} onChange={(event) => update(index, 'coverage', event.target.value)} className="mt-1 w-full rounded border p-2"><option value="">Select configured coverage</option>{row.coverage && !selected ? <option value={row.coverage}>{row.coverage} (not offered by selected definition)</option> : null}{options.map((option) => <option key={option.name} value={option.name} disabled={rows.some((other, position) => position !== index && other.coverage === option.name)}>{option.name}</option>)}</select></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Limit{currency ? ` (${currency})` : ''}<input aria-label={`Coverage ${index + 1} limit`} type="number" min="0" step="0.01" value={row.limit} onChange={(event) => update(index, 'limit', amount(event.target.value))} className="mt-1 w-full rounded border p-2" /></label><label className="text-sm">Deductible{currency ? ` (${currency})` : ''}<input aria-label={`Coverage ${index + 1} deductible`} type="number" min="0" step="0.01" value={row.excess} onChange={(event) => update(index, 'excess', amount(event.target.value))} className="mt-1 w-full rounded border p-2" /></label></div>
      {selected ? <p className="text-xs text-slate-600">Configured maximum limit: {selected.maximum}; minimum deductible: {selected.deductible}. Territory: {selected.territory}. The server validates selected amounts.</p> : row.coverage ? <p role="alert" className="text-sm text-red-700">Re-select coverage for this published programme before quoting.</p> : null}
      {!disabled ? <button type="button" onClick={() => onChange(rows.filter((_row, position) => position !== index))} className="text-sm text-red-700 underline disabled:cursor-not-allowed disabled:opacity-40">Remove coverage {index + 1}</button> : null}
    </div>; })}
    {!disabled ? <button type="button" disabled={rows.length >= options.length} onClick={() => onChange([...rows, { coverage: '', limit: '', excess: '' }])} className="rounded border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">Add coverage</button> : null}
  </fieldset>;
}

export type CommercialSegmentFieldProps = { programId: string; binderProductAuthorityId: string; value: unknown; disabled?: boolean; onChange: (value: string) => void; fieldError?: string };
export function CommercialSegmentField({ programId, binderProductAuthorityId, value, disabled, onChange, fieldError }: CommercialSegmentFieldProps) {
  const [segments, setSegments] = useState<Array<{ id: string; name: string }>>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current; setSegments([]); setError('');
    if (!programId || !binderProductAuthorityId) { setError('Select a programme and binder authority first.'); setLoading(false); return; }
    setLoading(true);
    void http.request<Record<string, unknown>>(`programs/${encodeURIComponent(programId)}/definition/${encodeURIComponent(binderProductAuthorityId)}`).then((response) => {
      if (current !== generation.current) return;
      if (!response.success || !response.data) throw new Error(response.error?.message || 'Published definition unavailable.');
      const details = object(object(object(object(response.data.workflow).insuranceConfiguration).product).details);
      const text = (value: unknown) => typeof value === 'string' ? value : undefined;
      setSegments(configuredCommercialSegments({ details: {
        professions: Array.isArray(details.professions) ? details.professions.map((entry) => { const row = object(entry); return { segmentId: text(row.segmentId), profession: text(row.profession) }; }) : [],
        productLines: Array.isArray(details.productLines) ? details.productLines.map((entry) => { const row = object(entry); return { status: text(row.status), triggerSegmentId: text(row.triggerSegmentId) }; }) : [],
      } }));
    }).catch((failure: unknown) => { if (current === generation.current) setError(failure instanceof Error ? failure.message : 'Business segments could not be loaded.'); }).finally(() => { if (current === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [programId, binderProductAuthorityId]);
  const selected = typeof value === 'string' ? value : '';
  return <div className="space-y-2"><label className="block text-sm font-medium">Configured business segment<select aria-label="Configured business segment" value={selected} disabled={disabled || loading || Boolean(error)} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded border p-2"><option value="">{loading ? 'Loading published segments…' : segments.length ? 'Select a configured business segment' : 'No segment selection required'}</option>{selected && !segments.some((row) => row.id === selected) ? <option value={selected}>{selected} (not in selected definition)</option> : null}{segments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>{error || fieldError ? <p role="alert" className="text-sm text-red-700">{error || fieldError}</p> : null}</div>;
}

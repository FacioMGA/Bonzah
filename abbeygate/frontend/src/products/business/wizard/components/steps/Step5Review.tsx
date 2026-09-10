import { useFormContext } from 'react-hook-form';
import type { ReactNode } from 'react';
import { Building2, CheckCircle2, ClipboardCheck, ShieldCheck, UserRound } from 'lucide-react';
import { FormField, SectionCard } from '@/src/shared/ui';
import { getNestedError } from '@/src/shared/lib/wizard/utils/errors';

type ReviewRecord = Parameters<typeof getNestedError>[0];

function formatText(value: unknown): string {
  const text = value === undefined || value === null || String(value).trim() === ''
    ? '—'
    : String(value);
  return text
    .split('_')
    .map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part)
    .join(' ');
}

function Row({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
      <span className="text-sm font-medium text-slate-500">{label}</span>
      <span className="max-w-[58%] text-right text-sm font-semibold text-slate-900 break-words">{formatText(value)}</span>
    </div>
  );
}

function ReviewCard(props: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary">
          {props.icon}
        </div>
        <h4 className="text-sm font-black uppercase tracking-widest text-slate-600">{props.title}</h4>
      </div>
      <div>{props.children}</div>
    </div>
  );
}

function YesNoPill({ value }: { value: unknown }) {
  const v = String(value || '').toLowerCase();
  if (v !== 'yes' && v !== 'no') {
    return <span className="text-sm font-semibold text-slate-400">—</span>;
  }
  const yes = v === 'yes';
  return (
    <span className={[
      'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold',
      yes ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
    ].join(' ')}
    >
      {yes ? 'Yes' : 'No'}
    </span>
  );
}

function CoverRow({ label, value, kind = 'text' }: { label: string; value: unknown; kind?: 'money' | 'yesNo' | 'text' }) {
  const display = kind === 'money' ? money(value) : formatText(value);
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
      <span className="text-sm font-medium text-slate-500">{label}</span>
      {kind === 'yesNo' ? (
        <YesNoPill value={value} />
      ) : (
        <span className="max-w-[58%] text-right text-sm font-semibold text-slate-900 break-words">{display}</span>
      )}
    </div>
  );
}

function money(value: unknown): string {
  const n = Number(value);
  if (!value || Number.isNaN(n) || n <= 0) return '—';
  return `€${n.toLocaleString()}`;
}

export function Step5Review() {
  const { watch, register, formState: { errors } } = useFormContext();
  const err = (path: string): string | undefined =>
    getNestedError(errors as ReviewRecord, path);

  const proposer = (watch('proposer') || {}) as ReviewRecord;
  const address = (proposer.address || {}) as ReviewRecord;
  const business = (watch('business') || {}) as ReviewRecord;
  const coverage = (watch('coverage') || {}) as ReviewRecord;
  const declarationError = err('declarations.informationAccurate');

  return (
    <SectionCard title="Review & submit" icon={<ClipboardCheck className="w-5 h-5" />}>
      <div className="-mt-3 rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-5">
        <p className="text-base font-bold text-slate-900">Check everything before you send it to us.</p>
        <p className="mt-1 text-sm font-medium text-slate-600">
          There is nothing to pay now. Our commercial team will review your request, prepare terms manually, and contact you.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReviewCard title="Your details" icon={<UserRound className="h-4 w-4" />}>
        <Row label="Name" value={`${proposer.firstName || ''} ${proposer.lastName || ''}`.trim()} />
        <Row label="Email" value={proposer.email} />
        <Row label="Telephone" value={proposer.phone} />
        <Row label="Address" value={[address.line1, address.city, address.country].filter(Boolean).join(', ')} />
        </ReviewCard>

        <ReviewCard title="Business" icon={<Building2 className="h-4 w-4" />}>
        <Row label="Type of business" value={business.typeOfBusiness} />
        <Row label="Number of employees" value={business.numberOfEmployees} />
        <Row label="When cover is required" value={business.coverTiming} />
        </ReviewCard>
      </div>

      <ReviewCard title="Cover requested" icon={<ShieldCheck className="h-4 w-4" />}>
        <div className="grid gap-x-8 md:grid-cols-2">
          <CoverRow label="Buildings" value={coverage.buildings} kind="money" />
          <CoverRow label="Stock" value={coverage.stock} kind="money" />
          <CoverRow label="Contents & equipment" value={coverage.equipment} kind="money" />
          <CoverRow label="Public liability" value={coverage.publicLiability} kind="yesNo" />
          <CoverRow label="Employers' liability" value={coverage.employersLiability} kind="yesNo" />
          <CoverRow label="Business interruption" value={coverage.businessInterruption} kind="yesNo" />
          <CoverRow label="Legal assistance" value={coverage.legalAssistance} kind="yesNo" />
        </div>
      </ReviewCard>

      <div className="mt-2">
        <FormField label="" error={err('declarations.informationAccurate')} fieldKey="declarations.informationAccurate">
          <label className={[
            'flex items-start gap-4 rounded-3xl border p-5 shadow-sm transition',
            declarationError ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50/70',
          ].join(' ')}
          >
            <input
              type="checkbox"
              {...register('declarations.informationAccurate')}
              className="mt-1 h-5 w-5 rounded border-slate-300 text-brand-primary focus:ring-brand-primary"
            />
            <span>
              <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                Confirm and submit
              </span>
              <span className="mt-1 block text-sm font-medium text-slate-700">
                I confirm the information provided is accurate to the best of my knowledge and understand it will be
                used to prepare my business insurance quote.
              </span>
              {!declarationError ? (
                <span className="mt-2 block text-xs font-semibold text-slate-500">Select this box to enable Submit request.</span>
              ) : null}
            </span>
          </label>
        </FormField>
      </div>
    </SectionCard>
  );
}

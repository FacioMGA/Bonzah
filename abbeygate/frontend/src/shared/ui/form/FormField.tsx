import { ReactNode, useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import { useFollowUps } from './followUpContext';
import { Textarea } from '../primitives/Textarea';

interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
  tooltip?: string;
  fieldKey?: string;
}

export function FormField({ label, required, error, children, tooltip, fieldKey }: FormFieldProps) {
  const { register } = useFormContext();
  const { followUpMode, followUpRequests } = useFollowUps();

  const followUpsForField = useMemo(() => {
    const k = String(fieldKey || '').trim();
    if (!k) return [];
    return (Array.isArray(followUpRequests) ? followUpRequests : []).filter((r) => String(r?.fieldKey || '').trim() === k);
  }, [followUpRequests, fieldKey]);

  const baseReadOnly = Boolean(followUpMode);
  const inertAttrs: (React.HTMLAttributes<HTMLDivElement> & { inert?: boolean }) | undefined = baseReadOnly
    ? { inert: true }
    : undefined;

  // ABY-82 / ABY-83 / ABY-95 / ABY-96 / ABY-104 — labels are TOP-anchored
  // and the control sits a fixed `mt-2` below. Earlier iterations tried
  // to baseline-align controls across a side-by-side grid row by
  // anchoring labels to the BOTTOM of a `flex-grow` slot
  // (`justify-end`); that worked for the row-alignment case but
  // introduced the ABY-104 regression: when a validation error appeared
  // in cell A, the row height grew, the grow-slots in cell B (and
  // others) stretched, and label B literally jumped DOWN to the new
  // bottom anchor.
  //
  // The agreed trade-off: label position MUST stay stable across
  // validation state changes (ABY-104, ABY-105 "identify the vehicle
  // jumps up"). Label-to-control distance is consistent because every
  // cell uses the same `mt-2` gap, regardless of whether siblings have
  // wrapped labels or visible errors. Controls are no longer forced to
  // baseline-align across a row — that was an aesthetic preference
  // (ABY-82/83) but downstream consequences (ABY-95/96/104) outweighed
  // it. Mild visual offset between siblings with different label line
  // counts is the lesser cost.
  return (
    <div
      className="mb-6"
      data-field={fieldKey}
      id={fieldKey ? `field-${fieldKey}` : undefined}
    >
      <label className="block text-[14px] font-semibold leading-snug text-slate-400 tracking-tight">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
        {tooltip && (
          <span className="ml-1.5 inline-block group relative">
            <svg
              className="w-3.5 h-3.5 inline text-slate-400 cursor-help hover:text-slate-600 transition-colors"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="invisible group-hover:visible absolute left-0 top-5 bg-slate-900 text-white text-xs rounded-lg px-3 py-2 w-56 z-10 shadow-lg">
              {tooltip}
            </span>
          </span>
        )}
      </label>
      <div
        className={`mt-2 ${baseReadOnly ? 'pointer-events-none opacity-80' : ''}`.trim()}
        {...inertAttrs}
      >
        {children}
      </div>

      {followUpsForField.length > 0 && (
        <div className="mt-3 space-y-3">
          {followUpsForField.map((fu) => {
            const id = String(fu?.id || '').trim();
            if (!id) return null;
            return (
              <div
                key={id}
                className="rounded-2xl border border-amber-300/70 bg-amber-50/40 p-4 shadow-[0_8px_25px_rgba(245,158,11,0.08)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-black uppercase tracking-widest text-amber-700">
                      Follow-up requested
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-700">
                      {String(fu?.note || '').trim() || 'Please add more detail.'}
                    </div>
                  </div>
                  <div className="shrink-0 text-[10px] font-black uppercase tracking-widest text-amber-700/80">
                    {String(fu?.type || '').trim() || 'Follow-up'}
                  </div>
                </div>

                <div className="mt-3">
                  <Textarea
                    rows={3}
                    className="w-full resize-none text-[15px] bg-white/80 rounded-xl px-4 py-3"
                    placeholder="Type your answer here..."
                    {...register(`__followUpAnswers.${id}` as `__followUpAnswers.${string}`)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <p className="!text-red-600 text-xs mt-2 flex items-start gap-1">
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5 !text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}

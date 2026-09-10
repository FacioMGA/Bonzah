import React from 'react';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

function toneClasses(tone: StatusTone): string {
  switch (tone) {
    case 'success':
      return 'bg-brand-primary/10 text-brand-primary border-brand-primary/20';
    case 'info':
      return 'bg-blue-50 text-blue-700 border-blue-100';
    case 'warning':
      return 'bg-amber-50 text-amber-700 border-amber-100';
    case 'danger':
      return 'bg-rose-50 text-rose-700 border-rose-100';
    case 'neutral':
    default:
      return 'bg-slate-50 text-slate-600 border-slate-100';
  }
}

export function StatusPill({
  label,
  tone = 'neutral',
  dot = true,
  className = '',
}: {
  label: string;
  tone?: StatusTone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border shadow-sm ${toneClasses(tone)} ${className}`}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />}
      <span className="text-[10px] font-extrabold uppercase tracking-wide">{label}</span>
    </span>
  );
}

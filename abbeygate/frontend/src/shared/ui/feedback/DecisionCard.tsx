import React from 'react';

type DecisionCardTone = 'success' | 'warning' | 'danger' | 'neutral';
type DecisionCardVariant = 'default' | 'inline';

function toneClasses(tone: DecisionCardTone, variant: DecisionCardVariant): string {
  if (variant === 'inline') {
    if (tone === 'danger') return 'text-slate-900';
    return 'text-slate-900';
  }
  switch (tone) {
    case 'success':
      return 'border-brand-primary/15 bg-brand-primary/[0.04] text-brand-primary';
    case 'warning':
      return 'border-slate-200/70 border-l-[3px] border-l-amber-300 bg-white/80 text-slate-900';
    case 'danger':
      return 'border-rose-200/80 bg-rose-50/70 text-rose-900';
    case 'neutral':
    default:
      return 'border-slate-200/70 bg-white/70 text-slate-900';
  }
}

function renderIndicator(tone: DecisionCardTone): React.ReactNode {
  if (tone === 'warning') {
    return <span className="mt-2 h-2 w-2 rounded-full bg-amber-400/65" aria-hidden="true" />;
  }

  if (tone === 'success') {
    return <span className="mt-2 h-2 w-2 rounded-full bg-brand-primary/60" aria-hidden="true" />;
  }

  return (
    <div className={`mt-0.5 flex h-7 min-w-7 items-center justify-center rounded-full text-[10px] font-black uppercase tracking-widest ${
      tone === 'danger'
        ? 'bg-rose-100 text-rose-900'
        : 'bg-slate-100 text-slate-600'
    }`}>
      {tone === 'danger' ? '!' : 'i'}
    </div>
  );
}

export function DecisionCard({
  tone = 'neutral',
  eyebrow,
  title,
  subtitle,
  summary,
  details,
  defaultExpanded = false,
  variant = 'default',
}: {
  tone?: DecisionCardTone;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  summary?: string;
  details?: React.ReactNode;
  defaultExpanded?: boolean;
  variant?: DecisionCardVariant;
}) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const hasDetails = Boolean(details);

  return (
    <div className={variant === 'inline' ? toneClasses(tone, variant) : `rounded-3xl border p-6 md:p-8 ${toneClasses(tone, variant)}`}>
      {eyebrow && variant !== 'inline' ? (
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">{eyebrow}</div>
      ) : null}

      <div className={`${variant === 'inline' ? '' : 'mt-2'} flex items-start gap-3`}>
        {renderIndicator(tone)}
        <div className="min-w-0 flex-1">
          <div className={variant === 'inline' ? 'text-[17px] font-semibold tracking-tight text-slate-800' : 'text-base font-semibold tracking-tight text-slate-800'}>
            {title}
          </div>
          {subtitle ? <div className="mt-1 text-sm font-semibold text-slate-600">{subtitle}</div> : null}
          {summary ? (
            <div className={variant === 'inline' ? 'mt-1 text-sm font-medium text-slate-500' : 'mt-3 text-sm font-bold text-slate-700'}>
              {summary}
            </div>
          ) : null}
        </div>
      </div>

      {hasDetails ? (
        <div className={variant === 'inline' ? 'mt-2 pl-5' : 'mt-4'}>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className={variant === 'inline'
              ? 'inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-600'
              : 'inline-flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-600 transition hover:border-slate-300 hover:text-slate-800'}
          >
            {expanded ? 'Hide details' : 'Show details'}
            <span className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
          </button>

          {expanded ? <div className={variant === 'inline' ? 'mt-3 space-y-3' : 'mt-4 space-y-4'}>{details}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

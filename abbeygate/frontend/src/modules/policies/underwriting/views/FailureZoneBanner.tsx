// Operator-facing banner for behavior failure-zone signals.
//
// Presentational only — consumes the canonical projection produced by the
// backend `loadFailureZoneSnapshot` (via `useFailureZone`) and surfaces it
// in plain English. This is the seam that fixes ABY-231: the previous
// inline banner showed engineer-y signal text without explaining why the
// follow-up was needed or what the operator should do next.

import React from 'react';
import type { FailureZoneSignal, FailureZoneView } from './UnderwritingTab.types';
import {
  describeFailureZoneTiming,
  getFailureZoneSignalCopy,
  getSimilarEvidenceCopy,
  summarizeFailureZone,
} from './failureZoneCopy';

export type FailureZoneSignalView = FailureZoneSignal & { message: string };
export type FailureZoneEvidenceView = { label: string };

type Severity = 'alert' | 'watch';

function resolveSeverity(failureZone: FailureZoneView | null): Severity {
  return failureZone?.severity === 'alert' ? 'alert' : 'watch';
}

function severityVisuals(severity: Severity): {
  containerClass: string;
  iconClass: string;
  eyebrowClass: string;
  title: string;
  iconPath: string;
} {
  if (severity === 'alert') {
    return {
      containerClass: 'border-red-200 bg-red-50/80',
      iconClass: 'text-red-500',
      eyebrowClass: 'text-red-700',
      title: 'Operational follow-up needed',
      iconPath: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
    };
  }
  return {
    containerClass: 'border-amber-200 bg-amber-50/80',
    iconClass: 'text-amber-500',
    eyebrowClass: 'text-amber-700',
    title: 'Operational watch',
    iconPath: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  };
}

function GuidanceCard({
  whatsHappening,
  nextAction,
  timing,
  technicalLabel,
  technicalBody,
}: {
  whatsHappening: string;
  nextAction: string;
  timing?: string | null;
  technicalLabel?: string;
  technicalBody?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">
          What's happening
        </div>
        {timing ? (
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            {timing}
          </div>
        ) : null}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-800">{whatsHappening}</div>

      <div className="mt-3 text-[11px] font-black uppercase tracking-widest text-slate-500">
        What to do next
      </div>
      <div className="mt-1 text-sm font-medium text-slate-700">{nextAction}</div>

      {technicalBody ? (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-widest text-slate-400 transition hover:text-slate-600">
            {technicalLabel || 'Technical detail'}
          </summary>
          <div className="mt-2 text-xs font-medium text-slate-500">{technicalBody}</div>
        </details>
      ) : null}
    </div>
  );
}

function SignalRow({ signal }: { signal: FailureZoneSignalView }) {
  const copy = getFailureZoneSignalCopy(signal);
  const timing = describeFailureZoneTiming(signal);
  const code = String(signal.code || '').trim();
  return (
    <GuidanceCard
      whatsHappening={copy.whatsHappening}
      nextAction={copy.nextAction}
      timing={timing}
      technicalLabel={`Technical signal${code ? ` · ${code}` : ''}`}
      technicalBody={signal.message || undefined}
    />
  );
}

function SimilarEvidenceRow({
  severity,
  evidence,
}: {
  severity: Severity;
  evidence: FailureZoneEvidenceView[];
}) {
  const copy = getSimilarEvidenceCopy(severity);
  const technicalBody = evidence.length > 0
    ? `Past cases this banner is based on: ${evidence.slice(0, 3).map((item) => item.label).join(', ')}`
    : undefined;
  return (
    <GuidanceCard
      whatsHappening={copy.whatsHappening}
      nextAction={copy.nextAction}
      technicalLabel="Why this fired"
      technicalBody={technicalBody}
    />
  );
}

export function FailureZoneBanner({
  failureZone,
  failureSignals,
  similarFailureEvidence,
}: {
  failureZone: FailureZoneView | null;
  failureSignals: FailureZoneSignalView[];
  similarFailureEvidence: FailureZoneEvidenceView[];
}) {
  const severity = resolveSeverity(failureZone);
  const visuals = severityVisuals(severity);
  const summary = summarizeFailureZone({
    severity,
    signals: failureSignals,
    hasSimilarEvidence: similarFailureEvidence.length > 0,
  });

  return (
    <div className={`rounded-2xl border p-4 ${visuals.containerClass}`}>
      <div className="flex items-start gap-3">
        <svg
          className={`w-5 h-5 shrink-0 mt-0.5 ${visuals.iconClass}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={visuals.iconPath} />
        </svg>
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-black uppercase tracking-widest ${visuals.eyebrowClass}`}>
            {visuals.title}
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-800">{summary}</div>

          {failureSignals.length > 0 ? (
            <div className="mt-3 space-y-2">
              {failureSignals.slice(0, 3).map((signal) => (
                <SignalRow key={`${signal.code || ''}:${signal.message || ''}`} signal={signal} />
              ))}
              {failureSignals.length > 3 ? (
                <div className="text-[11px] font-semibold text-slate-500">
                  +{failureSignals.length - 3} more signal{failureSignals.length - 3 === 1 ? '' : 's'} — open the policy feed for the full list.
                </div>
              ) : null}
              {similarFailureEvidence.length > 0 ? (
                <div className="text-[11px] font-semibold text-slate-500">
                  Similar past cases: {similarFailureEvidence.slice(0, 3).map((item) => item.label).join(', ')}
                </div>
              ) : null}
            </div>
          ) : similarFailureEvidence.length > 0 ? (
            <div className="mt-3">
              <SimilarEvidenceRow severity={severity} evidence={similarFailureEvidence} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

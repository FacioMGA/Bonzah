import type { ProductManifest } from '@facio/products';
import { readPath, hasMeaningfulValue } from './manifestHelpers';

export type RiskPoint = { pts: number; kind: 'pos' | 'neg' | 'warn' | 'miss'; why: string; conf: 'High' | 'Med' | 'Low' };
export type RiskFlag = { severity: 'decline' | 'refer' | 'followup'; label: string; why: string; key?: string };

export type RiskModelResult = {
  total: number;
  decision: 'Accept' | 'Decline';
  confidence: 'High' | 'Med' | 'Low';
  completeness: { answered: number; total: number };
  strengths: Array<{ key: string } & RiskPoint>;
  risks: Array<{ key: string } & RiskPoint>;
  flags: RiskFlag[];
  points: Record<string, RiskPoint>;
  hasFollowups: boolean;
  hasRefer: boolean;
};

const EMPTY_RESULT: RiskModelResult = {
  total: 0,
  decision: 'Accept',
  confidence: 'Low',
  completeness: { answered: 0, total: 0 },
  strengths: [],
  risks: [],
  flags: [],
  points: {},
  hasFollowups: false,
  hasRefer: false,
};

/**
 * Product-manifest-driven UW risk model.
 *
 * Replaces the old motor-specific `computeAutoRiskModel`. Uses:
 *   - `manifest.riskModelHints.requiredForUw` — fields that must be answered
 *   - `manifest.riskModelHints.referralFlags` — boolean flags that trigger referral
 *
 * Authoritative UW lanes/triggers/pricing explanation still come from backend
 * `underwritingAnalysis` on the quoteResponse. This function only produces the
 * lightweight chips for the BO questionnaire UI.
 */
export function computeRiskModel(
  manifest: ProductManifest | null,
  riskData: unknown,
): RiskModelResult {
  if (!manifest) return EMPTY_RESULT;

  const points: Record<string, RiskPoint> = {};
  const flags: RiskFlag[] = [];

  for (const entry of manifest.riskModelHints.requiredForUw) {
    const v = readPath(riskData, entry.path);
    if (!hasMeaningfulValue(v)) {
      points[entry.path] = { pts: 0, kind: 'miss', why: `Missing ${entry.label}.`, conf: 'Med' };
      flags.push({ severity: 'followup', label: `Missing ${entry.label}`, why: 'Required to complete underwriting.', key: entry.path });
    }
  }

  for (const flag of manifest.riskModelHints.referralFlags) {
    const v = readPath(riskData, flag.path);
    if (v === true) {
      points[flag.path] = {
        pts: flag.points ?? -10,
        kind: 'warn',
        why: `${flag.label} declared (review required).`,
        conf: 'High',
      };
      flags.push({
        severity: 'refer',
        label: `${flag.label} declared`,
        why: flag.reason || `${flag.label} requires underwriting review.`,
        key: flag.path,
      });
    }
  }

  const total = Object.values(points).reduce((acc, x) => acc + (x?.pts || 0), 0);
  const hasDecline = flags.some((f) => f.severity === 'decline');
  const hasRefer = flags.some((f) => f.severity === 'refer');
  const hasFollowups = flags.some((f) => f.severity === 'followup');

  const answered = manifest.riskModelHints.requiredForUw
    .filter((e) => hasMeaningfulValue(readPath(riskData, e.path)))
    .length;
  const totalRequired = manifest.riskModelHints.requiredForUw.length;
  const confidence: 'High' | 'Med' | 'Low' =
    (answered >= totalRequired && !hasRefer && !hasFollowups) ? 'High'
      : (answered >= Math.ceil(totalRequired * 0.7)) ? 'Med'
        : 'Low';

  const contributors = Object.entries(points)
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));

  return {
    total,
    decision: hasDecline ? 'Decline' : 'Accept',
    confidence,
    completeness: { answered, total: totalRequired },
    strengths: contributors.filter((x) => x.pts > 0).slice(0, 3),
    risks: contributors.filter((x) => x.pts < 0 || x.kind === 'warn').slice(0, 3),
    flags,
    points,
    hasFollowups,
    hasRefer,
  };
}

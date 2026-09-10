import type { RecommendationItem } from './step4QuoteApi';

export type BundleSelection = {
  excess: number;
  claimProtection: boolean;
  vipRoadside: boolean;
};

export type BundleCopy = {
  title: string;
  tagline: string;
  shortTitle: string;
  badges: Array<{ kind: 'excess' | 'ncb' | 'vip'; label: string }>;
};

const EXCESS_LABELS: Array<{ max: number; label: string }> = [
  { max: 300, label: 'Standard' },
  { max: 600, label: 'Balanced' },
  { max: 900, label: 'Comfort' },
  { max: Infinity, label: 'Value Saver' },
];

export function parseExcess(raw: unknown): number {
  const parsed = parseInt(String(raw || '').replace(/[^0-9]/g, '') || '0', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 250;
}

/**
 * Referral pricing is a derived UI projection of the canonical Motor quote
 * response. It deliberately does not calculate, round, or otherwise alter
 * the premium: only a finite, positive referral amount may be shown as an
 * indicative price while an underwriter review is pending.
 */
export function getIndicativeReferralPremium(args: {
  status: unknown;
  annualPremium: unknown;
}): number | null {
  if (String(args.status || '').trim().toLowerCase() !== 'referral') return null;
  const premium = Number(args.annualPremium);
  return Number.isFinite(premium) && premium > 0 ? premium : null;
}

/**
 * Approved production requirement (Peter, 2026-07-21): breakdown cover
 * (`COV-ROADSIDE`) is never a standalone purchase — it is included
 * automatically in comprehensive Motor / Van / Motorbike / Motor-Caravan
 * cover. The VIP roadside upgrade remains an optional extra, and selecting it
 * implies the base breakdown cover. Single source of truth for the inclusion
 * rule so the Step-4 controller and the recompute API cannot drift.
 */
export function isBreakdownCoverIncluded(args: {
  isComprehensiveCover: boolean;
  vipRoadsideSelected: boolean;
  alreadyOnQuote: boolean;
}): boolean {
  return args.isComprehensiveCover || args.vipRoadsideSelected || args.alreadyOnQuote;
}

function formatEurInt(value: number): string {
  return `€${Math.round(Number(value || 0)).toLocaleString('en-IE')}`;
}

function excessLabel(excess: number): string {
  const found = EXCESS_LABELS.find((item) => excess <= item.max) || EXCESS_LABELS[EXCESS_LABELS.length - 1]!;
  return `${found.label} (${formatEurInt(excess)})`;
}

export function generateBundleCopy(opts: { excess: number; hasNcb: boolean; hasVip: boolean }): BundleCopy {
  const ex = Number(opts.excess || 0) || 250;
  const exLabel = excessLabel(ex);
  const modifiers: string[] = [];
  if (opts.hasNcb) modifiers.push('NCB Protect');
  if (opts.hasVip) modifiers.push('VIP Roadside');
  const title = opts.hasNcb && opts.hasVip
    ? `Ultimate Protection — ${exLabel}`
    : modifiers.length === 1
      ? `${exLabel} + ${modifiers[0]}`
      : exLabel;
  const taglineParts: string[] = [];
  if (!opts.hasNcb && !opts.hasVip) {
    taglineParts.push('Simple comprehensive cover with standard excess.');
  } else {
    if (opts.hasNcb) taglineParts.push('No‑Claim Bonus protected for small claims.');
    if (opts.hasVip) taglineParts.push('VIP roadside: priority recovery & concierge.');
  }
  const badges: BundleCopy['badges'] = [
    { kind: 'excess', label: `Excess: ${formatEurInt(ex)}` },
    ...(opts.hasNcb ? [{ kind: 'ncb' as const, label: 'NCB Protect' }] : []),
    ...(opts.hasVip ? [{ kind: 'vip' as const, label: 'VIP Roadside' }] : []),
  ];
  const shortTitle = opts.hasNcb && opts.hasVip
    ? `Ultimate — ${EXCESS_LABELS.find((item) => ex <= item.max)?.label || 'Plan'}`
    : modifiers.length
      ? `${EXCESS_LABELS.find((item) => ex <= item.max)?.label || 'Plan'} — ${modifiers.join(' + ')}`
      : `${EXCESS_LABELS.find((item) => ex <= item.max)?.label || 'Plan'}`;
  return { title, tagline: taglineParts.join(' '), badges, shortTitle };
}

export function sameBundle(a: BundleSelection, b: BundleSelection): boolean {
  return (
    Number(a.excess) === Number(b.excess) &&
    Boolean(a.claimProtection) === Boolean(b.claimProtection) &&
    Boolean(a.vipRoadside) === Boolean(b.vipRoadside)
  );
}

export function formatDelta(delta: number | null): string {
  if (delta === null) return 'Unavailable';
  const rounded = Math.round(delta * 100) / 100;
  const sign = rounded >= 0 ? '+' : '−';
  return `${sign}€${Math.abs(rounded).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDateEu(iso: string | undefined): string {
  const value = String(iso || '').trim();
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function parseDateOnlyLocal(value: string): Date | null {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function formatDateTimeEu(date: Date): string {
  const datePart = date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timePart = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${datePart} ${timePart}`;
}

export function getPolicyPeriod(renewalDate: string | undefined): { start: string; end: string; days: number } {
  if (!renewalDate) return { start: '-', end: '-', days: 0 };
  const start = parseDateOnlyLocal(renewalDate) || new Date(renewalDate);
  if (Number.isNaN(start.getTime())) return { start: '-', end: '-', days: 0 };
  const end = new Date(start);
  end.setDate(end.getDate() + 365);
  end.setHours(12, 0, 0, 0);
  return {
    start: formatDateTimeEu(start),
    end: formatDateTimeEu(end),
    days: 365,
  };
}

export function formatDateOfBirthEu(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${String(year)}`;
    }
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

export type RecommendationCardModel = {
  rec: RecommendationItem;
  bundleId: string;
  selection: BundleSelection;
  copy: BundleCopy;
  annualPremium: number;
  isSelected: boolean;
  isOriginal: boolean;
  isBusy: boolean;
};

export function deriveRecommendationCards(args: {
  recommendations: RecommendationItem[] | undefined;
  baseBundle: BundleSelection;
  currentBundle: BundleSelection;
  applyingBundleId: string | null;
}): RecommendationCardModel[] {
  const items = Array.isArray(args.recommendations) ? args.recommendations : [];
  const minExcess = Number(args.baseBundle.excess || 0);
  const mapped = items
    .map((rec) => {
      const opt = rec?.quoteOption;
      if (!opt) return null;
      const bundleId = String(rec?.bundleId || '');
      const attrs = rec?.attrs || {};
      const ex = Number(attrs?.excess ?? opt?.voluntaryExcess ?? opt?.totalExcess ?? 0) || 250;
      if (ex < minExcess) return null;
      const selection: BundleSelection = {
        excess: ex,
        claimProtection: Boolean(attrs?.claimProtection),
        vipRoadside: Boolean(attrs?.vipRoadside),
      };
      return {
        rec,
        bundleId,
        selection,
        copy: generateBundleCopy({
          excess: selection.excess,
          hasNcb: selection.claimProtection,
          hasVip: selection.vipRoadside,
        }),
        annualPremium: Number(opt.annualPremium || 0),
        isSelected: sameBundle(args.currentBundle, selection),
        isOriginal: sameBundle(args.baseBundle, selection),
        isBusy: args.applyingBundleId === bundleId,
      } satisfies RecommendationCardModel;
    })
    .filter(Boolean) as RecommendationCardModel[];

  return mapped
    .sort((a, b) => {
      if (a.isOriginal !== b.isOriginal) return a.isOriginal ? 1 : -1;
      return 0;
    })
    .slice(0, 4);
}

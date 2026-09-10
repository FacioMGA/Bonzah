/**
 * TravelQuoteSidebar — shared sticky right-hand panel used in Steps 4, 5, 6.
 *
 * ABY-264 — consumes `quoteResponse.primaryOption.breakdown.lines`
 * (the canonical `TravelBreakdownLine[]` produced by the rate engine)
 * as the single source of truth for the order summary. Every other
 * surface that renders the same breakdown — payment step, BO Premium
 * tab, PDF schedule — reads the same array, so the customer sees an
 * identical base → addons → tax → admin fee → total breakdown on
 * every step. The admin-fee line in particular MUST be visible on
 * every step (the client confirmed surfacing it only on the payment
 * step caused customer-facing confusion — see ABY-264 discussion).
 *
 * Styling is intentionally aligned with the Motor wizard's Order Summary card.
 */

import { Phone, Mail, FileText, Check } from 'lucide-react';
import { getSupportContact } from '@/src/shared/lib/tenant/supportContact';

const POLICY_DOCUMENTS = [
  { label: 'Insurance Product Information (IPID)', href: '/api/public/ipid/travel' },
  { label: 'Terms of Business', href: '#' },
  { label: 'Policy Wording', href: '#' },
  { label: 'Privacy Notice', href: '#' },
];

const eur = (v: number) =>
  `€${Number(v || 0).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type TravelQuoteSidebarLineKind = 'base' | 'addon' | 'loading' | 'discount' | 'tax' | 'fee' | 'total';

export type TravelQuoteSidebarLine = {
  code: string;
  label: string;
  amount: number;
  kind: TravelQuoteSidebarLineKind;
};

export interface TravelQuoteSidebarProps {
  /** Resolved destination area label (e.g. "Worldwide excluding USA and Canada"). */
  areaLabel: string;
  /** Selected plan + type (e.g. "Platinum Single Trip"). */
  coverLevelLabel: string;
  /** Cover type display (e.g. "Individual", "A Couple"). */
  coveringLabel: string;
  /** Formatted trip start date (DD/MM/YYYY). */
  startDate: string;
  /** Formatted trip end date (DD/MM/YYYY). */
  endDate: string;
  /**
   * Canonical breakdown — pre-ordered base → addons (catalogue order)
   * → tax → admin fee → total, with zero-amount lines already omitted.
   * Source: `quoteResponse.primaryOption.breakdown.lines` (the
   * `TravelBreakdownLine[]` produced by `travelCalculator.ts`).
   *
   * When omitted (e.g. Step 4 plan picker before a plan is selected),
   * the sidebar only renders the trip info above and no price block.
   */
  breakdownLines?: ReadonlyArray<TravelQuoteSidebarLine>;
  /** Show Policy Documents section (steps 5 + 6). */
  showDocs?: boolean;
  /** Show Contact Us section (all steps). */
  showContact?: boolean;
}

export function TravelQuoteSidebar({
  areaLabel,
  coverLevelLabel,
  coveringLabel,
  startDate,
  endDate,
  breakdownLines,
  showDocs = false,
  showContact = true,
}: TravelQuoteSidebarProps) {
  const lines = breakdownLines ?? [];
  const totalLine = lines.find((line) => line.code === 'total' || line.kind === 'total');
  const baseLine = lines.find((line) => line.kind === 'base');
  const addonLines = lines.filter((line) => line.kind === 'addon');
  // ADR-0035 — the underwriting profit loading (canonical label
  // "Premium adjustment") is part of the price the customer pays. It was
  // previously dropped here, so the rows visibly failed to add up to the
  // total (a +€10 add-on appeared to raise the total by ~€11). Render it
  // in the charges block, before tax, matching the canonical line order.
  // ADR-0056 — `discount` is the negative counterpart (BDX declared-premium
  // alignment); it renders in the same block so rows still sum to the total.
  const loadingLines = lines.filter((line) => line.kind === 'loading' || line.kind === 'discount');
  const taxLines = lines.filter((line) => line.kind === 'tax');
  const feeLines = lines.filter((line) => line.kind === 'fee');
  const hasBreakdown = lines.length > 0;
  const hasAddons = addonLines.length > 0;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
        <h3 className="text-[15px] font-semibold text-gray-900 mb-5">Quote Summary</h3>

        <div className="space-y-2.5 mb-5">
          <SummaryRow label="Destination" value={areaLabel} />
          {coverLevelLabel ? <SummaryRow label="Cover Level" value={coverLevelLabel} /> : null}
          <SummaryRow label="Covering" value={coveringLabel} />
          {startDate && endDate && (
            <SummaryRow label="Trip Length" value={`${startDate} to ${endDate}`} />
          )}
          {baseLine && (
            <SummaryRow label={baseLine.label} value={eur(baseLine.amount)} />
          )}
        </div>

        {hasAddons && (
          <>
            <div className="h-px bg-gray-100 w-full mb-4" />
            <p className="text-[10px] uppercase tracking-widest text-gray-400 font-bold mb-2.5">
              Extra cover
            </p>
            <div className="space-y-2 mb-5">
              {addonLines.map((line) => (
                <div key={line.code} className="flex items-center justify-between text-sm py-0.5">
                  <span className="text-gray-500 flex items-center gap-1.5">
                    <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                    {line.label}
                  </span>
                  <span className="text-gray-900 font-medium">{eur(line.amount)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {(loadingLines.length > 0 || taxLines.length > 0 || feeLines.length > 0) && (
          <>
            <div className="h-px bg-gray-100 w-full mb-4" />
            <div className="space-y-2 mb-5">
              {loadingLines.map((line) => (
                <div key={line.code} className="flex items-center justify-between text-sm py-0.5">
                  <span className="text-gray-500">{line.label}</span>
                  <span className="text-gray-900 font-medium">{eur(line.amount)}</span>
                </div>
              ))}
              {taxLines.map((line) => (
                <div key={line.code} className="flex items-center justify-between text-sm py-0.5">
                  <span className="text-gray-500">{line.label}</span>
                  <span className="text-gray-900 font-medium">{eur(line.amount)}</span>
                </div>
              ))}
              {feeLines.map((line) => (
                <div key={line.code} className="flex items-center justify-between text-sm py-0.5">
                  <span className="text-gray-500">{line.label}</span>
                  <span className="text-gray-900 font-medium">{eur(line.amount)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {hasBreakdown && totalLine && (
          <>
            <div className="h-px bg-gray-100 w-full mb-5" />
            <div className="flex flex-col items-end gap-1">
              <span className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">
                {totalLine.label || 'Total Price'}
              </span>
              <span className="text-[32px] font-bold text-[#004a8a] tracking-tight hover:scale-[1.02] transition-transform origin-right cursor-default">
                {eur(totalLine.amount)}
              </span>
            </div>
            {taxLines.length > 0 && (
              <p className="text-right text-[11px] text-gray-400 mt-1">
                Inclusive of Insurance Premium Tax at current rate.
              </p>
            )}
          </>
        )}
      </div>

      {showDocs && (
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-5">
          <p className="text-[13px] font-semibold text-gray-900 mb-3">Policy Documents</p>
          <div className="space-y-2">
            {POLICY_DOCUMENTS.map((doc) => (
              <a
                key={doc.label}
                href={doc.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[12px] font-medium text-[#004a8a] hover:underline"
              >
                <FileText size={11} className="shrink-0 text-[#004a8a]" />
                {doc.label}
              </a>
            ))}
          </div>
        </div>
      )}

      {showContact && (
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-5">
          <p className="text-[13px] font-semibold text-gray-900 mb-1">Contact Us</p>
          <p className="text-[11px] text-gray-500 mb-3 leading-relaxed">
            By email, or by telephone we are here to help
          </p>
          <div className="space-y-2.5">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                Call us
              </p>
              <a
                href={`tel:${getSupportContact().officeTel}`}
                className="flex items-center gap-1.5 text-[13px] font-medium text-gray-800 hover:text-[#004a8a] transition-colors"
              >
                <Phone size={12} className="text-[#004a8a] shrink-0" />
                {getSupportContact().officeDisplay}
              </a>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                Email us
              </p>
              <a
                href={`mailto:${getSupportContact().email}`}
                className="flex items-center gap-1.5 text-[13px] font-medium text-gray-800 hover:text-[#004a8a] transition-colors"
              >
                <Mail size={12} className="text-[#004a8a] shrink-0" />
                {getSupportContact().email}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm py-0.5">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-gray-900 font-medium text-right leading-snug">{value}</span>
    </div>
  );
}

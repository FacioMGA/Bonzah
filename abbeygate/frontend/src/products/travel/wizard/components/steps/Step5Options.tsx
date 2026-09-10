import { useFormContext } from 'react-hook-form';
import { CheckCircle2, PlusCircle, Shield } from 'lucide-react';
import { travelDestinationAreaLabel } from '@facio/products';
import { SectionCard } from '@/src/shared/ui';
import { TravelQuoteSidebar } from '../TravelQuoteSidebar';
import { formatTravelDateForDisplay } from '../../formatTravelDateForDisplay';
import {
  readTravelBreakdownLines,
  TRAVEL_ADDONS as CANONICAL_TRAVEL_ADDONS,
} from '../../travelAddons';
import type { TravelAddon } from '../../travelAddons';

// ---------------------------------------------------------------------------
// Addon definitions — aligned with TRAVEL_ENDORSEMENT_TEMPLATES codes and
// the applyTravelEndorsementsToQuoteData CODE_TO_FLAG mapping in runtime.ts.
//
// ABY-272 — card prices come from `quoteResponse.addonPrices[key]`, which
// the backend rate calculator emits with the EXACT same number that will
// appear on the breakdown's addon line when the customer adds the option.
// One calculator, one writer, one number. The historical
// `addonGrossPrices` (Δ grossPremium across the whole quote) is gone —
// it silently rolled admin-fee and IPT swings into the card price and
// made the card disagree with the order summary on the same screen.
// ---------------------------------------------------------------------------

// ABY-241 — canonical catalogue lives in `../../travelAddons.ts`
// (single source of truth shared by Step5, Step6, and the wizard's
// payment summary). Re-exported here so existing imports
// (`TravelQuoteWizard.tsx`) keep working without a surface change.
type AddonDef = TravelAddon;
export const TRAVEL_ADDONS = CANONICAL_TRAVEL_ADDONS;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const US_LIKE = new Set(['USA', 'United States', 'Canada', 'Mexico', 'Caribbean']);
const EUROPE = new Set([
  'Cyprus', 'Greece', 'Spain', 'Portugal', 'Italy', 'France', 'Germany', 'Belgium',
  'Netherlands', 'Austria', 'Switzerland', 'UK', 'United Kingdom', 'Ireland', 'Sweden',
  'Norway', 'Denmark', 'Finland', 'Malta', 'Poland', 'Czechia',
]);

function destinationAreaLabel(destinations: string[]): string {
  if (!destinations.length) return '—';
  const explicitArea = destinations.map(travelDestinationAreaLabel).find((label): label is string => Boolean(label));
  if (explicitArea) return explicitArea;
  if (destinations.some((d) => US_LIKE.has(d))) return 'Worldwide including USA and Canada';
  if (destinations.every((d) => EUROPE.has(d))) return 'Europe';
  return 'Worldwide excluding USA and Canada';
}

function planDisplayLabel(plan: string, planType: string): string {
  const tier = plan.charAt(0).toUpperCase() + plan.slice(1);
  const type = planType === 'annual_multi_trip' ? 'Annual Multi-Trip' : 'Single Trip';
  return `${tier} ${type}`;
}

function coverTypeLabel(coverType: string): string {
  if (coverType === 'couple') return 'A Couple';
  if (coverType === 'family') return 'A Family';
  if (coverType === 'single_parent_family') return 'Single Parent Family';
  return 'Single Person';
}

// ABY-239 — canonical formatter lives in
// `../../formatTravelDateForDisplay.ts` and is imported above.
// Local alias preserves the existing call sites below without
// touching them.
const formatIsoDate = formatTravelDateForDisplay;

function fmtCurrency(amount: number): string {
  return `€${amount.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface Step5OptionsProps {
  quoteResponse: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Addon card
// ---------------------------------------------------------------------------

interface AddonCardProps {
  addon: AddonDef;
  price: number | null;
  selected: boolean;
  onToggle: (key: string, value: boolean) => void;
}

function AddonCard({ addon, price, selected, onToggle }: AddonCardProps) {
  return (
    <div
      className={`group rounded-2xl border bg-white p-5 transition-all duration-300 ${
        selected
          ? 'border-brand-primary ring-2 ring-brand-primary/20 shadow-[0_4px_20px_-4px_rgba(var(--brand-primary-rgb,0,74,138),0.18)]'
          : 'border-slate-200/80 hover:border-slate-300 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)] hover:shadow-[0_6px_20px_-4px_rgba(0,0,0,0.10)]'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <h3 className="text-[15px] font-bold text-slate-900 tracking-tight">{addon.label}</h3>
            {price !== null && (
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold transition-colors duration-200 ${selected ? 'bg-brand-primary/10 text-brand-primary' : 'bg-slate-100 text-slate-600'}`}>
                +{fmtCurrency(price)} (plus tax)
              </span>
            )}
          </div>
          <p className="text-[12px] text-slate-500 leading-relaxed">{addon.description}</p>
        </div>
        <button
          type="button"
          onClick={() => onToggle(addon.key, !selected)}
          className={`shrink-0 flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-all duration-200 ${
            selected
              ? 'bg-brand-primary text-white hover:bg-brand-primary/90 shadow-[0_4px_14px_-4px_rgba(0,74,138,0.35)]'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 group-hover:bg-slate-150'
          }`}
        >
          {selected ? (
            <>
              <CheckCircle2 size={14} />
              Added
            </>
          ) : (
            <>
              <PlusCircle size={14} />
              Add
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Step5Options({ quoteResponse }: Step5OptionsProps) {
  const { watch, setValue } = useFormContext();

  const addons = (watch('addons') || {}) as Record<string, boolean>;
  const trip = (watch('trip') || {}) as Record<string, unknown>;
  const travellers = (watch('travellers') || {}) as Record<string, unknown>;
  const quote = (watch('quote') || {}) as Record<string, unknown>;

  const selectedPlan = String(quote.selectedPlan || 'silver');
  const planType = String(trip.planType || 'single_trip');
  const destinations = Array.isArray(trip.destinations) ? (trip.destinations as string[]) : [];
  const coverType = String(travellers.coverType || 'single');
  const startDate = formatIsoDate(String(trip.startDate || ''));
  const endDate = formatIsoDate(String(trip.endDate || ''));

  // ABY-272 — `addonPrices[flag]` is the canonical per-addon line price
  // emitted by the backend calculator (same number used inside
  // `breakdown.lines`). The card and the breakdown row always agree.
  const addonPrices = ((quoteResponse?.addonPrices ?? {}) as Record<string, number>);

  // ABY-264 — order-summary sidebar reads the canonical breakdown
  // lines (base → addons → tax → admin fee → total) emitted by the
  // travel rate calculator. Every step (4, 5, 6) consumes the same
  // shape, so the customer sees the same lines — including the
  // admin-fee row — on every step.
  const breakdownLines = readTravelBreakdownLines(quoteResponse);

  const handleToggle = (key: string, value: boolean) => {
    setValue(`addons.${key}` as Parameters<typeof setValue>[0], value, { shouldDirty: true });
  };

  return (
    <div className="lg:grid lg:grid-cols-[1fr_240px] lg:gap-6 lg:items-start">
      {/* ── Main content ── */}
      <div className="space-y-5">
        <SectionCard title="Additional Cover Options" icon={<Shield className="w-5 h-5" />}>
          <p className="text-[14px] text-slate-500 leading-relaxed max-w-xl -mt-2">
            Below there are more cover options so that you can tailor your policy to your needs.
            When reviewing the options please read the relevant section of the Policy Wording pages
            in order to fully understand the cover, terms and conditions which will apply to each option.
          </p>
        </SectionCard>

        <div className="space-y-3">
          {TRAVEL_ADDONS.map((addon) => (
            <AddonCard
              key={addon.key}
              addon={addon}
              price={addonPrices[addon.key] ?? null}
              selected={!!addons[addon.key]}
              onToggle={handleToggle}
            />
          ))}
        </div>
      </div>

      {/* ── Sticky sidebar ── */}
      <div className="hidden lg:block lg:sticky lg:top-6">
        <TravelQuoteSidebar
          areaLabel={destinationAreaLabel(destinations)}
          coverLevelLabel={planDisplayLabel(selectedPlan, planType)}
          coveringLabel={coverTypeLabel(coverType)}
          startDate={startDate}
          endDate={endDate}
          breakdownLines={breakdownLines}
          showDocs
          showContact
        />
      </div>

      {/* ── Mobile summary (below cards) ── */}
      <div className="lg:hidden mt-6">
        <TravelQuoteSidebar
          areaLabel={destinationAreaLabel(destinations)}
          coverLevelLabel={planDisplayLabel(selectedPlan, planType)}
          coveringLabel={coverTypeLabel(coverType)}
          startDate={startDate}
          endDate={endDate}
          breakdownLines={breakdownLines}
          showDocs
          showContact
        />
      </div>
    </div>
  );
}

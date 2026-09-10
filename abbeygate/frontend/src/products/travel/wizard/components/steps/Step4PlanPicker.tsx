import { useEffect, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { travelDestinationAreaLabel } from '@facio/products';
import { TravelQuoteSidebar } from '../TravelQuoteSidebar';
import { QuoteLoading } from '@/src/shared/lib/wizard';
import { formatTravelDateForDisplay } from '../../formatTravelDateForDisplay';
import {
  BENEFIT_SECTIONS,
  PLAN_DOCUMENTS,
  STANDARD_EXCESS_ITEM,
  type PlanId,
  type BenefitItem,
} from './step4PlanPicker.data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlanOption {
  premium: number;
  breakdown: Record<string, number>;
}

interface QuoteResponse {
  status?: string;
  planOptions?: Record<PlanId, PlanOption | null>;
  annualMinPremium?: number | null;
  primaryOption?: { annualPremium?: number } | null;
}

export interface Step4PlanPickerProps {
  loading: boolean;
  quoteResponse: Record<string, unknown> | null;
  onRate: () => void;
  /** Called with the chosen plan — sets the form value AND advances the step. */
  onSelectPlan?: (plan: PlanId) => void;
}

// ---------------------------------------------------------------------------
// Static tables
// ---------------------------------------------------------------------------

const PLAN_LABELS: Record<PlanId, string> = {
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
};

/** One thin accent stripe + button colour per plan. Cards always stay light. */
const PLAN_COLORS: Record<PlanId, { stripe: string; btn: string; selectedBorder: string; selectedRing: string }> = {
  silver: {
    stripe: 'bg-slate-500',
    btn: 'bg-slate-700 hover:bg-slate-600 text-white',
    selectedBorder: 'border-slate-400',
    selectedRing: 'ring-slate-200',
  },
  gold: {
    stripe: 'bg-amber-500',
    btn: 'bg-amber-700 hover:bg-amber-600 text-white',
    selectedBorder: 'border-amber-400',
    selectedRing: 'ring-amber-100',
  },
  platinum: {
    stripe: 'bg-brand-primary',
    btn: 'bg-brand-primary hover:bg-brand-primary/90 text-white',
    selectedBorder: 'border-brand-primary',
    selectedRing: 'ring-brand-primary/10',
  },
};

const PLANS: PlanId[] = ['silver', 'gold', 'platinum'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEur(amount: number): string {
  return `€${amount.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ABY-239 — single canonical owner lives in
// `../../formatTravelDateForDisplay.ts`. Re-exported here so the
// existing `Step4PlanPicker.test.tsx` import keeps working without
// touching a known-good test surface.
export { formatTravelDateForDisplay } from '../../formatTravelDateForDisplay';

const COVER_TYPE_LABELS: Record<string, string> = {
  single: 'Individual',
  couple: 'Couple',
  family: 'Family',
  single_parent_family: 'Single Parent Family',
};

function destinationAreaLabel(destinations: string[]): string {
  if (!destinations || destinations.length === 0) return '—';
  const explicitArea = destinations.map(travelDestinationAreaLabel).find((label): label is string => Boolean(label));
  if (explicitArea) return explicitArea;
  const US_LIKE = new Set(['USA', 'United States', 'Canada', 'Mexico', 'Caribbean']);
  const EUROPE = new Set([
    'Cyprus', 'Greece', 'Spain', 'Portugal', 'Italy', 'France', 'Germany', 'Belgium',
    'Netherlands', 'Austria', 'Switzerland', 'UK', 'United Kingdom', 'Ireland', 'Sweden',
    'Norway', 'Denmark', 'Finland', 'Malta', 'Poland', 'Czechia', 'Albania', 'Andorra',
    'Azores', 'Balearic Islands', 'Bosnia Herzegovina', 'Bulgaria', 'Canary Islands',
    'Corsica', 'Croatia', 'Czech Republic', 'Egypt', 'Estonia', 'Georgia', 'Gibraltar',
    'Hungary', 'Iceland', 'Irish Republic', 'Latvia', 'Liechtenstein', 'Lithuania',
    'Luxembourg', 'Madeira', 'Moldova', 'Monaco', 'Montenegro', 'Morocco', 'North Macedonia',
    'Romania', 'San Marino', 'Serbia', 'Slovakia', 'Slovenia', 'Tunisia', 'Turkey',
    'Vatican City',
  ]);
  if (destinations.some((x) => US_LIKE.has(x))) return 'Worldwide including USA and Canada';
  if (destinations.every((x) => EUROPE.has(x))) return 'Europe';
  return 'Worldwide excluding the USA and Canada';
}

function quoteReasons(qr: QuoteResponse): string[] {
  const uw = (qr as { uwDecision?: unknown }).uwDecision;
  const reasons = uw && typeof uw === 'object' && Array.isArray((uw as { reasons?: unknown }).reasons)
    ? (uw as { reasons: unknown[] }).reasons
    : [];
  return reasons
    .map((reason) => {
      if (typeof reason === 'string') return reason;
      if (reason && typeof reason === 'object') return String((reason as { message?: unknown }).message || '').trim();
      return '';
    })
    .filter(Boolean);
}

function TravelOutcomePanel({ tone, title, reasons }: { tone: 'referral' | 'declined'; title: string; reasons: string[] }) {
  const isReferral = tone === 'referral';
  const styles = isReferral
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : 'border-rose-200 bg-rose-50 text-rose-900';
  const bodyStyle = isReferral ? 'text-amber-800' : 'text-rose-800';
  const fallback = isReferral
    ? 'A specialist needs to review this trip before we can confirm the right cover.'
    : 'One or more trip details falls outside the online travel quote rules.';
  return (
    <div className={`rounded-2xl border px-5 py-5 ${styles}`}>
      <p className="text-base font-bold">{title}</p>
      <p className={`mt-2 text-sm leading-relaxed ${bodyStyle}`}>
        {isReferral
          ? 'We will not show selectable plans for this trip until the referral is reviewed.'
          : 'Please adjust the trip details or contact us for assistance.'}
      </p>
      <div className="mt-4 rounded-xl bg-white/65 p-4">
        <p className={`text-[10px] font-black uppercase tracking-widest ${bodyStyle}`}>Reason</p>
        <ul className={`mt-2 space-y-1 text-sm font-semibold ${bodyStyle}`}>
          {(reasons.length > 0 ? reasons : [fallback]).map((reason) => (
            <li key={reason}>• {reason}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BenefitRow — stacked layout avoids label/amount collision in narrow cards
// ---------------------------------------------------------------------------

interface BenefitRowProps {
  item: BenefitItem;
  plan: PlanId;
}

function BenefitRow({ item, plan }: BenefitRowProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-slate-100 last:border-0 py-2.5">
      {/* Label */}
      <p className="text-[12px] font-medium text-slate-700 leading-snug">{item.label}</p>
      {item.sublabel && (
        <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{item.sublabel}</p>
      )}
      {/* Amount on its own line — no collision with the label */}
      <p className="text-[13px] font-bold text-slate-900 mt-0.5 tabular-nums">{item.amounts[plan]}</p>

      {/* Expandable detail */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-0.5 mt-1 text-[11px] font-medium text-brand-primary hover:text-brand-primary/80 transition-colors"
      >
        view details
        {open ? <ChevronUp size={10} strokeWidth={2} /> : <ChevronDown size={10} strokeWidth={2} />}
      </button>
      {open && (
        <p className="mt-1.5 text-[11px] text-slate-500 leading-relaxed border-l-2 border-brand-primary/25 pl-2">
          {item.detail}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlanCard
// ---------------------------------------------------------------------------

interface PlanCardProps {
  plan: PlanId;
  premium: number | null;
  isSelected: boolean;
  connectedTop?: boolean;
  tripTypeLabel: string;
  onSelect: () => void;
}

function PlanCard({ plan, premium, isSelected, connectedTop = false, tripTypeLabel, onSelect }: PlanCardProps) {
  const c = PLAN_COLORS[plan];

  return (
    <div
      className={`flex flex-col overflow-hidden transition-all duration-200 ${connectedTop ? 'rounded-b-2xl rounded-t-none !border-t-0' : 'rounded-2xl'} ${
        isSelected
          ? `border-2 ${c.selectedBorder} ring-4 ${c.selectedRing} shadow-md`
          : 'border border-slate-200 bg-white shadow-sm hover:shadow-md'
      }`}
    >
      {/* Accent stripe */}
      <div className={`h-[3px] ${c.stripe}`} />

      {/* Card header */}
      <div className="px-4 pt-4 pb-3.5 border-b border-slate-100 bg-white">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{tripTypeLabel}</p>
        <h3 className="text-[17px] font-bold text-slate-800 mt-0.5">{PLAN_LABELS[plan]}</h3>
        {premium !== null ? (
          <p className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums">{formatEur(premium)}</p>
        ) : (
          <p className="text-sm text-slate-400 italic mt-1.5">Price unavailable</p>
        )}
        <button
          type="button"
          onClick={onSelect}
          disabled={premium === null}
          className={`mt-3 w-full rounded-lg py-2 text-sm font-semibold transition-all duration-150 ${c.btn} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          Select
        </button>
      </div>

      {/* Document links */}
      <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/50 space-y-1">
        {PLAN_DOCUMENTS.map((doc) => (
          <a
            key={doc.label}
            href={doc.href}
            className="flex items-start gap-1.5 text-[11px] font-medium text-brand-primary hover:underline leading-snug"
            target="_blank"
            rel="noopener noreferrer"
          >
            <FileText size={10} className="shrink-0 mt-px text-brand-primary/60" />
            {doc.label}
          </a>
        ))}
      </div>

      {/* Benefits */}
      <div className="flex-1 bg-white px-4 py-0.5">
        <BenefitRow item={STANDARD_EXCESS_ITEM} plan={plan} />
        {BENEFIT_SECTIONS.map((section) =>
          section.items.map((item) => <BenefitRow key={item.id} item={item} plan={plan} />),
        )}
      </div>

      {/* Bottom select */}
      <div className="bg-white px-4 pb-4 pt-2.5">
        <button
          type="button"
          onClick={onSelect}
          disabled={premium === null}
          className={`w-full rounded-lg py-2 text-sm font-semibold transition-all duration-150 ${c.btn} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          Select
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Header banner — quote results text + annual/single-trip toggle panel
// ---------------------------------------------------------------------------

const ANNUAL_MAX_DAYS_OPTIONS = [17, 31, 45] as const;
type MaxTripDays = typeof ANNUAL_MAX_DAYS_OPTIONS[number];

interface HeaderBannerProps {
  isAnnual: boolean;
  annualMinPremium: number | null;
  maxTripDays: MaxTripDays;
  onCompareAnnual: () => void;
  onCompareSingle: () => void;
  onMaxTripDaysChange: (days: MaxTripDays) => void;
}

function HeaderBanner({
  isAnnual,
  annualMinPremium,
  maxTripDays,
  onCompareAnnual,
  onCompareSingle,
  onMaxTripDaysChange,
}: HeaderBannerProps) {
  return (
    <div className="rounded-2xl overflow-hidden flex flex-col sm:flex-row border border-slate-200 shadow-sm">
      {/* Left — descriptive text, always white bg */}
      <div className="flex-1 bg-slate-50 px-5 sm:px-6 py-4 sm:py-5">
        <h2 className="text-xl font-bold text-slate-900">Your quote results</h2>
        <p className="text-[13px] text-slate-600 mt-1.5 leading-relaxed">
          All cover levels and excesses below are per person named on the policy.
        </p>
        {!isAnnual && annualMinPremium !== null && annualMinPremium > 0 && (
          <p className="text-[13px] text-slate-600 mt-2 leading-relaxed">
            If you are travelling more than once in the next 12 months why not compare our annual
            multi-trip policies starting from{' '}
            <span className="font-bold text-slate-900">{formatEur(annualMinPremium)}</span>
          </p>
        )}
        {isAnnual && (
          <p className="text-[13px] text-slate-600 mt-2 leading-relaxed">
            Our standard policy allows individual trips of up to{' '}
            <span className="font-bold text-slate-900">{maxTripDays} days</span> per trip.
            Please select the level of cover required.
          </p>
        )}
      </div>

      {/* Right — CTA panel on brand-primary dark background.
          All <p> tags need !text-white to beat .brand-flow p { color: #6b7280 }
          ABY-39: stretches full-width on mobile (stacked beneath the
          copy block) and stays at fixed 12rem on tablet+. */}
      <div className="w-full sm:w-48 shrink-0 bg-brand-primary flex flex-col items-center justify-center gap-3 px-4 py-4 sm:py-5 text-center">
        {isAnnual ? (
          <>
            <p className="text-[12px] font-bold !text-white leading-snug">
              Maximum duration per trip for annual policies
            </p>
            <select
              value={maxTripDays}
              onChange={(e) => onMaxTripDaysChange(Number(e.target.value) as MaxTripDays)}
              className="w-full rounded-lg border border-white/40 bg-white/15 px-3 py-1.5 text-sm font-semibold !text-white appearance-none text-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/40"
            >
              {ANNUAL_MAX_DAYS_OPTIONS.map((d) => (
                <option key={d} value={d} className="text-slate-900 bg-white">
                  {d} days
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onCompareSingle}
              className="w-full rounded-lg border-2 border-white/50 bg-transparent px-3 py-2 text-[12px] font-semibold !text-white hover:bg-white/15 transition-all"
            >
              Compare single trip policies
            </button>
          </>
        ) : (
          <>
            <p className="text-[15px] font-bold !text-white leading-snug">Save with an Annual Trip</p>
            <button
              type="button"
              onClick={onCompareAnnual}
              className="w-full rounded-lg border-2 border-white/50 bg-transparent px-3 py-2 text-[12px] font-semibold !text-white hover:bg-white/15 transition-all"
            >
              Compare annual policies
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Step4PlanPicker({ loading, quoteResponse, onRate, onSelectPlan }: Step4PlanPickerProps) {
  const { watch, setValue, clearErrors } = useFormContext();
  const selectedPlan = (watch('quote.selectedPlan') as PlanId | '') || '';

  // Local max-days-per-trip state for annual mode (default 17). Stored in form
  // as `quote.maxTripDays` so saveDraft picks it up before re-rating.
  const [maxTripDays, setMaxTripDays] = useState<MaxTripDays>(17);
  // ABY-39: on mobile we render only ONE plan card at a time (the
  // "viewing" plan), with a price-aware chip selector at the top so
  // the customer can compare prices at a glance and tap to dive into
  // each tier without losing context across screens of scroll. On
  // md+ screens this state is unused — the 3-column grid takes over.
  const [viewingPlan, setViewingPlan] = useState<PlanId>(selectedPlan || 'silver');
  useEffect(() => {
    // Keep the mobile viewer aligned with the canonical form
    // selection (e.g. when a desktop user picks Gold then resizes
    // their window, or when default selection is hydrated from
    // session draft).
    if (selectedPlan) setViewingPlan(selectedPlan);
  }, [selectedPlan]);

  const qr = (quoteResponse || {}) as QuoteResponse;
  const status = qr.status || '';
  const isTerminalQuoteOutcome = status === 'DECLINED' || status === 'REFERRAL';
  const planOptions = qr.planOptions ?? null;
  const annualMinPremium = qr.annualMinPremium ?? null;

  const formValues = watch() as Record<string, unknown>;
  const trip = (formValues.trip || {}) as Record<string, unknown>;
  const travellers = (formValues.travellers || {}) as Record<string, unknown>;

  const planTypeRaw = String(trip.planType || 'single_trip');
  const isAnnual = planTypeRaw === 'annual_multi_trip';
  const tripTypeLabel = isAnnual ? 'Annual Multi-Trip' : 'Single Trip';

  const destinations = Array.isArray(trip.destinations) ? (trip.destinations as string[]) : [];
  const areaLabel = destinationAreaLabel(destinations);
  const coverLabel = COVER_TYPE_LABELS[String(travellers.coverType || 'single')] ?? 'Individual';
  const startDate = formatTravelDateForDisplay(String(trip.startDate || ''));
  const endDate = formatTravelDateForDisplay(String(trip.endDate || ''));

  const getPlanPremium = (plan: PlanId): number | null => {
    if (planOptions) return planOptions[plan]?.premium ?? null;
    if (selectedPlan && plan === selectedPlan) {
      const legacy = Number(qr.primaryOption?.annualPremium ?? 0);
      return legacy > 0 ? legacy : null;
    }
    return null;
  };

  function handleSelectPlan(plan: PlanId) {
    clearErrors('quote.selectedPlan');
    setValue('quote.selectedPlan', plan, { shouldDirty: true, shouldValidate: true });
    onSelectPlan?.(plan);
  }

  /** Switch to annual (default 17-day max) and re-rate. */
  function handleCompareAnnual() {
    const days: MaxTripDays = 17;
    setMaxTripDays(days);
    setValue('trip.planType', 'annual_multi_trip');
    setValue('quote.maxTripDays', days);
    onRate();
  }

  /** Switch back to single trip and re-rate. */
  function handleCompareSingle() {
    setValue('trip.planType', 'single_trip');
    setValue('quote.maxTripDays', undefined);
    onRate();
  }

  /** Change the max-days-per-trip for annual policies and re-rate. */
  function handleMaxTripDaysChange(days: MaxTripDays) {
    setMaxTripDays(days);
    setValue('quote.maxTripDays', days);
    onRate();
  }

  if (loading) return <QuoteLoading variant="plane" title="Calculating your travel plans..." />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_232px] gap-5 items-start">

      {/* ------------------------------------------------------------------ */}
      {/* Main column                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div className="space-y-4 min-w-0">

        {!isTerminalQuoteOutcome ? (
          <HeaderBanner
            isAnnual={isAnnual}
            annualMinPremium={annualMinPremium}
            maxTripDays={maxTripDays}
            onCompareAnnual={handleCompareAnnual}
            onCompareSingle={handleCompareSingle}
            onMaxTripDaysChange={handleMaxTripDaysChange}
          />
        ) : null}

        {/* Decline / referral */}
        {status === 'DECLINED' && (
          <TravelOutcomePanel
            tone="declined"
            title="We can't offer an online travel quote for these details"
            reasons={quoteReasons(qr)}
          />
        )}
        {status === 'REFERRAL' && (
          <TravelOutcomePanel
            tone="referral"
            title="This trip needs specialist review"
            reasons={quoteReasons(qr)}
          />
        )}

        {status === 'QUOTED' && (
          <>
            {/*
              ABY-39 / ABY-64: mobile compare strip + active card. The
              previous chips + card felt like two disconnected pieces;
              now a thin coloured "shelf" inherits the active plan's
              accent and physically joins the chip row to the card,
              giving the section a premium, cohesive feel without
              forking PlanCard. The card itself keeps its own selected
              treatment so the visual hierarchy of "viewing vs
              committed" still reads.
            */}
            <div className="md:hidden">
              <div
                role="tablist"
                aria-label="Compare travel plans"
                className="grid grid-cols-3 overflow-hidden rounded-t-2xl border border-slate-200 border-b-0 bg-slate-50 shadow-sm"
              >
                {PLANS.map((plan) => {
                  const premium = getPlanPremium(plan);
                  const isViewing = viewingPlan === plan;
                  const isCommitted = selectedPlan === plan;
                  const c = PLAN_COLORS[plan];
                  return (
                    <button
                      key={plan}
                      type="button"
                      role="tab"
                      aria-selected={isViewing}
                      aria-controls={`plan-card-${plan}`}
                      onClick={() => setViewingPlan(plan)}
                      className={`relative flex flex-col items-center gap-0.5 px-2 py-3 text-center transition-all ${
                        isViewing ? 'bg-white' : 'active:bg-white/60'
                      }`}
                    >
                      <span className={`mb-0.5 inline-block h-1 w-10 rounded-full ${c.stripe} ${isViewing ? 'opacity-100' : 'opacity-50'}`} />
                      <span className={`text-[12px] font-bold ${isViewing ? 'text-slate-900' : 'text-slate-600'}`}>
                        {PLAN_LABELS[plan]}
                      </span>
                      <span className={`text-[14px] font-bold tabular-nums ${isViewing ? 'text-slate-900' : 'text-slate-700'}`}>
                        {premium !== null ? formatEur(premium) : '—'}
                      </span>
                      {isCommitted && (
                        <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-700">
                          Selected
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {/* Coloured shelf — visually joins chip strip to card */}
              <div className={`h-1.5 border-x border-slate-200 ${PLAN_COLORS[viewingPlan].stripe}`} aria-hidden />
              <div id={`plan-card-${viewingPlan}`} role="tabpanel" className="-mt-px">
                <PlanCard
                  plan={viewingPlan}
                  premium={getPlanPremium(viewingPlan)}
                  isSelected={selectedPlan === viewingPlan}
                  connectedTop
                  tripTypeLabel={tripTypeLabel}
                  onSelect={() => handleSelectPlan(viewingPlan)}
                />
              </div>
            </div>

            {/* Desktop / tablet — full 3-column comparison grid. */}
            <div className="hidden md:grid md:grid-cols-3 gap-3 items-start">
              {PLANS.map((plan) => (
                <PlanCard
                  key={plan}
                  plan={plan}
                  premium={getPlanPremium(plan)}
                  isSelected={selectedPlan === plan}
                  tripTypeLabel={tripTypeLabel}
                  onSelect={() => handleSelectPlan(plan)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Sticky sidebar                                                      */}
      {/* ------------------------------------------------------------------ */}
      {!isTerminalQuoteOutcome ? (
        <div className="sticky top-6">
          <TravelQuoteSidebar
            areaLabel={areaLabel}
            coverLevelLabel=""
            coveringLabel={coverLabel}
            startDate={startDate}
            endDate={endDate}
            showContact
          />
        </div>
      ) : null}
    </div>
  );
}

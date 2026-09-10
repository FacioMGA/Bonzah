import type { ReactElement, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Phone, Shield } from 'lucide-react';
import { WizardButton as Button } from '@/src/shared/ui';
import {
  AnimatedQuoteBackground,
  type QuoteBackgroundPalette,
} from './AnimatedQuoteBackground';
import {
  QuoteHeroHeader,
  type QuoteHeroHeaderProps,
  type QuoteHeroHeaderVariants,
} from './QuoteHeroHeader';
import { QuoteLoadingGate } from './QuoteLoadingGate';
import type { QuoteLoadingVariant } from '../components/QuoteLoading';
import {
  QuoteSuccessCelebration,
  type QuoteSuccessCelebrationVariant,
} from './QuoteSuccessCelebration';

const DEFAULT_VARIANTS: QuoteHeroHeaderVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: 'easeOut' as const },
  }),
};

export type QuoteStatus = 'QUOTED' | 'REFERRAL' | 'DECLINED' | 'PENDING' | string;

/**
 * Referral content is deliberately a small renderable contract. `ReactNode`
 * carries React's broad `any`-based internals, which is suitable for the
 * long-standing general-purpose slots but not for a new product boundary.
 */
type ReferralPresentation = ReactElement<unknown> | string | number | boolean | null;

export interface QuotePresentationShellSlots {
  /** The premium card and any product-specific block beneath it (extras, recommendations). */
  primary: ReactNode;
  /** Right column (summary cards). */
  sidebar?: ReactNode;
  /** Optional warnings rendered between primary and sidebar. */
  warnings?: ReactNode;
  /**
   * Product-owned, non-bindable information shown on a referral outcome.
   * The shell only provides placement; products own both the copy and the
   * decision to opt in, so referral rules never leak into shared UI.
   */
  referral?: ReferralPresentation;
}

export interface QuotePresentationShellProps {
  /** Underlying quote response (may be null while loading or before first rate). */
  quoteResponse: Record<string, unknown> | null;
  /** Status string from `quoteResponse.status`. Falls back to `quoteResponse?.status` when omitted. */
  status?: QuoteStatus;
  /** External rating-in-progress signal. */
  rating?: boolean;
  /** Hero header props (eyebrow, headline, subline, etc.). */
  hero: Omit<QuoteHeroHeaderProps, 'variants'> & { variants?: QuoteHeroHeaderVariants };
  /** Background palette for the persistent animated layer. */
  background: QuoteBackgroundPalette;
  /** Celebration variant for the success moment. Defaults to `'subtle'`. */
  celebration?: QuoteSuccessCelebrationVariant;
  /** Loader headline shown while gating. */
  loadingTitle?: string;
  /** Loader artwork variant (e.g. `'vehicle'` for motor, `'plane'` for travel). */
  loadingArtwork?: QuoteLoadingVariant;
  /** Extra readiness signals required before the gate opens. */
  extraReadinessSignals?: boolean[];
  /** Minimum loading delay (ms). */
  minDelayMs?: number;
  /** Triggered when the user clicks "Get my quote" on the pre-rate state. */
  onRate?: () => void | Promise<void>;
  /** Pre-rate CTA label. */
  preRateCtaLabel?: string;
  /** Slots for the rendered quote body. */
  slots: QuotePresentationShellSlots;
  /** Phone number presented in the declined state. */
  declinedSpecialistPhone?: string;
  /** Callback for the referral state primary action. */
  onReferralCallback?: () => void | Promise<void>;
  /** Whether the referral callback is in flight / resolved. */
  referralState?: { busy?: boolean; requested?: boolean; error?: string | null };
}

function getQuoteReference(quoteResponse: Record<string, unknown> | null): string {
  return String(quoteResponse?.reference || '').trim();
}

// ABY-202 — DECLINED/REFERRAL screens previously hid `quoteResponse.warnings`
// (the UW automation reasons returned by the rate API), so motorcycle and other
// "silent" UW declines surfaced as a generic "We are unable to quote online"
// with no clue about which input triggered it. Surfacing the reasons here lets
// the customer see e.g. "Motorcycle over 200cc with no No Claims Discount
// evidence" and self-correct (or at least understand the call to a specialist).
function getQuoteReasonMessages(quoteResponse: Record<string, unknown> | null): string[] {
  if (!quoteResponse) return [];
  const raw = (quoteResponse as { warnings?: unknown }).warnings;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const text = String(entry || '').trim();
    if (text) out.push(text);
  }
  return out;
}

/**
 * Composes the domain-neutral quote presentation primitives into the
 * full premium-grade review surface (background + hero + price card +
 * sidebar + celebration + 3s min-delay gate). Product-specific blocks
 * (motor extras / recommendations, home inclusions panel, travel plan
 * picker) flow in via `slots.primary` so the same shell serves all
 * three products without leaking domain language into shared.
 */
export function QuotePresentationShell({
  quoteResponse,
  status,
  rating = false,
  hero,
  background,
  celebration = 'subtle',
  loadingTitle,
  loadingArtwork,
  extraReadinessSignals,
  minDelayMs,
  onRate,
  preRateCtaLabel = 'Get my quote',
  slots,
  declinedSpecialistPhone,
  onReferralCallback,
  referralState,
}: QuotePresentationShellProps) {
  const resolvedStatus = String(status || quoteResponse?.status || '').toUpperCase();
  const quoteReference = getQuoteReference(quoteResponse);
  const quoteReasonMessages = getQuoteReasonMessages(quoteResponse);
  const heroVariants = hero.variants || DEFAULT_VARIANTS;

  if (rating) {
    return (
      <QuoteLoadingGate
        triggerKey={`rating-${quoteReference || 'pending'}`}
        ready={false}
        title={loadingTitle}
        variant={loadingArtwork}
        minDelayMs={minDelayMs}
      >
        {null}
      </QuoteLoadingGate>
    );
  }

  if (resolvedStatus === 'DECLINED') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-3xl mx-auto px-6 py-16"
      >
        <div className="bg-white rounded-2xl p-12 text-center shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-gray-100">
          <div className="flex justify-center mb-8">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center border border-red-100">
              <Shield className="w-10 h-10 text-red-500" />
            </div>
          </div>
          <h2 className="text-3xl font-light text-gray-900 mb-4 tracking-tight">
            We are unable to quote online
          </h2>
          <p className="text-lg text-gray-500 mb-6 max-w-lg mx-auto leading-relaxed">
            Based on the details provided, we cannot offer cover for this specific risk through our online system at this time.
          </p>
          {quoteReasonMessages.length > 0 ? (
            <div className="bg-red-50/60 border border-red-100 rounded-xl p-5 mb-10 max-w-xl mx-auto text-left">
              <p className="text-[10px] uppercase tracking-widest text-red-500 font-semibold mb-2">Why we couldn't quote</p>
              <ul className="text-sm text-red-700 space-y-1.5">
                {quoteReasonMessages.map((reason, idx) => (
                  <li key={idx} className="flex gap-2"><span className="text-red-400">•</span><span>{reason}</span></li>
                ))}
              </ul>
            </div>
          ) : null}
          {quoteReference ? (
            <div className="bg-gray-50 rounded-xl p-6 max-w-sm mx-auto mb-10 border border-gray-100/50">
              <p className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-2">Reference</p>
              <p className="text-xl font-mono text-gray-900 tracking-wide">{quoteReference}</p>
            </div>
          ) : null}
          {declinedSpecialistPhone ? (
            <div className="border-t border-gray-100 pt-10">
              <p className="text-sm text-gray-400 mb-6 font-medium">Believe this is incorrect?</p>
              <div className="flex justify-center">
                <a href={`tel:${declinedSpecialistPhone}`} className="group">
                  <Button variant="outline" className="!rounded-full hover:!border-gray-900 transition-all duration-300">
                    <Phone className="w-4 h-4 mr-2" />
                    Speak to a specialist
                  </Button>
                </a>
              </div>
            </div>
          ) : null}
        </div>
      </motion.div>
    );
  }

  if (resolvedStatus === 'REFERRAL') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="max-w-3xl mx-auto px-6 py-12"
      >
        <div className="bg-white border border-blue-100 rounded-2xl p-12 text-center shadow-[0_8px_32px_rgba(0,74,138,0.06)]">
          <div className="flex justify-center mb-8">
            <div className="w-20 h-20 bg-blue-50/80 rounded-full flex items-center justify-center border border-blue-100">
              <Phone className="w-9 h-9 text-[#004a8a]" />
            </div>
          </div>
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">We've received your referral</h2>
          <p className="text-lg text-gray-600 mb-6 max-w-lg mx-auto leading-relaxed">
            Your details are with our team for review. You do not need to repeat the quote; a specialist will contact you if anything else is needed.
          </p>
          {slots.referral ? (
            <div className="bg-blue-50/50 border border-blue-100/50 rounded-xl p-6 text-left max-w-xl mx-auto mb-8">
              {slots.referral}
            </div>
          ) : null}
          {quoteReasonMessages.length > 0 ? (
            <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-5 mb-8 max-w-xl mx-auto text-left">
              <p className="text-[10px] uppercase tracking-widest text-[#004a8a] font-semibold mb-2">What our underwriter will check</p>
              <ul className="text-sm text-[#004a8a]/90 space-y-1.5">
                {quoteReasonMessages.map((reason, idx) => (
                  <li key={idx} className="flex gap-2"><span className="text-[#004a8a]/50">•</span><span>{reason}</span></li>
                ))}
              </ul>
            </div>
          ) : null}
          {quoteReference ? (
            <div className="bg-blue-50/50 border border-blue-100/50 rounded-xl p-6 text-left max-w-xl mx-auto mb-10">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-[#004a8a]">
                <div>
                  <span className="block text-xs uppercase text-blue-400 mb-1 font-bold tracking-wider">Reference</span>
                  <span className="font-mono text-lg">{quoteReference}</span>
                </div>
                <div className="text-right">
                  <span className="block text-xs uppercase text-blue-400 mb-1 font-bold tracking-wider">Response Time</span>
                  <span className="font-medium">Within 2 business hours</span>
                </div>
              </div>
            </div>
          ) : null}
          {onReferralCallback ? (
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                variant="primary"
                disabled={Boolean(referralState?.busy) || Boolean(referralState?.requested)}
                onClick={() => { void onReferralCallback(); }}
                className="!px-8 !py-3 !text-base shadow-lg shadow-blue-900/10"
              >
                {referralState?.requested
                  ? 'Callback requested'
                  : referralState?.busy
                    ? 'Requesting…'
                    : 'Request Callback'}
              </Button>
            </div>
          ) : null}
          {(referralState?.requested || referralState?.error) ? (
            <div className="mt-6 max-w-xl mx-auto">
              {referralState?.requested ? (
                <div className="text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-5 py-3">
                  We've received your request. A specialist will call you within 2 business hours.
                </div>
              ) : null}
              {referralState?.error ? (
                <div className="text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-5 py-3">
                  {referralState.error}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </motion.div>
    );
  }

  if (!quoteResponse || !quoteResponse.primaryOption) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <div className="text-base font-black text-slate-900">Ready for your quote</div>
          <div className="mt-2 text-sm font-semibold text-slate-500">
            We've got everything we need. Hit calculate and we'll come back with your price in seconds.
          </div>
          {onRate ? (
            <Button
              type="button"
              onClick={() => void onRate()}
              variant="primary"
              className="mt-5 !rounded-xl !h-12 px-8"
            >
              {preRateCtaLabel}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <QuoteLoadingGate
      triggerKey={quoteReference || 'quoted'}
      ready={resolvedStatus === 'QUOTED'}
      extraReadinessSignals={extraReadinessSignals}
      minDelayMs={minDelayMs}
      title={loadingTitle}
      variant={loadingArtwork}
    >
      <div className="max-w-5xl mx-auto px-5 py-2 md:py-12 relative z-10">
        <QuoteHeroHeader {...hero} variants={heroVariants} />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          <div className="lg:col-span-7 space-y-8">
            {slots.primary}

            {slots.warnings ? (
              <motion.div
                custom={3}
                initial="hidden"
                animate="visible"
                variants={heroVariants}
                className="bg-amber-50/50 border border-amber-100 rounded-xl p-4 flex gap-3"
              >
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-900/80">{slots.warnings}</div>
              </motion.div>
            ) : null}
          </div>

          {slots.sidebar ? (
            <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-8">{slots.sidebar}</div>
          ) : null}
        </div>
      </div>

      <AnimatedQuoteBackground palette={background} />
      <QuoteSuccessCelebration variant={celebration} triggerKey={quoteReference} />
    </QuoteLoadingGate>
  );
}

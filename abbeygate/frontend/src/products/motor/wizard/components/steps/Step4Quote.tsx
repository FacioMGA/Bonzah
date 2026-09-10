import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Car, ShieldCheck, Star, User } from 'lucide-react';
import { QuoteData, QuoteResponse } from '../../types';
import {
  PremiumCard,
  QuotePresentationShell,
  QuoteSummarySidebar,
  formatPremium,
  type PremiumCardBadge,
  type QuoteSummaryCard,
} from '@/src/shared/lib/wizard';
import { asRecord } from '@/src/shared/lib/record';
import { resolvePresentationProfile } from '@/src/products/catalog';
import { REGION_CONFIG } from '../../config/region';
import { EmailOtpVerifyModal } from '../EmailOtpVerifyModal';
import { useStep4QuoteController } from './useStep4QuoteController';
import { Step4DebugModal } from './Step4DebugModal';
import { Step4ExtrasCards } from './Step4ExtrasCards';
import { Step4RecommendationsPanel } from './Step4RecommendationsPanel';
import {
  deriveRecommendationCards,
  formatDelta,
  formatDateEu,
  generateBundleCopy,
  getIndicativeReferralPremium,
  getPolicyPeriod,
  formatDateOfBirthEu,
  parseExcess,
  type BundleSelection,
} from './step4QuoteDomain';

interface Step4Props {
  data: QuoteData;
  quote: QuoteResponse | null;
  policyId: string;
  onRequestEdit: (step: number) => void;
  onProceedToPayment: () => void;
  onSelectedOptionNameChange?: (name: string) => void;
  onRequestCall: () => Promise<void>;
  onRatedQuote: (raw: unknown) => void;
}

const fadeIn = {
  hidden: { opacity: 0, y: 10 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: (i as number) * 0.1, duration: 0.5, ease: 'easeOut' as const },
  }),
};

const MOTOR_PRESENTATION = resolvePresentationProfile('motor');
const MOTOR_DECLINED_PHONE = '+35726934455';
const CABRIO_ADDITIONAL_EXCESS_NOTICE =
  'Additional Excess 500 Euro, Applicable to convertible mechanism in its entirety.';

function isCabrioSelected(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'yes' || normalized === 'true' || normalized === '1';
}

export function Step4Quote({
  data,
  quote,
  policyId,
  onRequestEdit,
  onProceedToPayment,
  onSelectedOptionNameChange,
  onRequestCall,
  onRatedQuote,
}: Step4Props) {
  const [showDebug, setShowDebug] = useState(false);
  const [isEmailIconHovered, setIsEmailIconHovered] = useState(false);

  const quoteStatus = String(quote?.status || '').trim().toLowerCase();
  const quoteReference = String(quote?.reference || '');
  const isDeclined = quoteStatus === 'declined';
  const isReferral = quoteStatus === 'referral';
  const indicativeAnnualPremium = getIndicativeReferralPremium({
    status: quoteStatus,
    annualPremium: quote?.primaryOption?.annualPremium,
  });

  const currentExcessFromQuote =
    Number(quote?.primaryOption?.voluntaryExcess || 0) ||
    Number(quote?.primaryOption?.totalExcess || 0) ||
    parseExcess(data.requiredExcess);
  const currentTraceSteps = quote?.primaryOption?.calculationTrace?.steps || [];
  const currentHasNcbFromQuote =
    currentTraceSteps.some((s) => String(s?.id || '') === 'endorsement.premium.CV 172') ||
    Boolean(data.protectNCB);
  const currentHasRoadsideFromQuote = currentTraceSteps.some((s) => String(s?.id || '') === 'endorsement.premium.COV-ROADSIDE');
  const currentHasVipFromQuote = currentTraceSteps.some((s) => String(s?.id || '') === 'endorsement.premium.COV-ROADSIDE-VIP');
  const isComprehensiveCover = String(data.coverRequired || '').trim() !== 'Third Party Liability';

  const step4Controller = useStep4QuoteController({
    policyId,
    quoteStatus,
    quoteReference,
    quote,
    data,
    isComprehensiveCover,
    currentHasNcbFromQuote,
    currentHasVipFromQuote,
    currentHasRoadsideFromQuote,
    onProceedToPayment,
    onRequestCall,
    onRatedQuote,
  });
  const recs = step4Controller.recommendations.payload;
  const recsLoading = step4Controller.recommendations.loading;
  const recsError = step4Controller.recommendations.error;
  const initialRecsDone = step4Controller.recommendations.initialDone;
  const extrasPricing = step4Controller.extras.pricing;
  const initialExtrasDone = step4Controller.extras.initialDone;
  const downloading = step4Controller.communications.downloading;
  const showVerifyCode = step4Controller.communications.showVerifyCode;
  const setShowVerifyCode = step4Controller.communications.setShowVerifyCode;
  const sendingQuoteEmail = step4Controller.communications.sendingQuoteEmail;
  const emailQuoteStatus = step4Controller.communications.emailQuoteStatus;
  const setEmailQuoteStatus = step4Controller.communications.setEmailQuoteStatus;
  const requestingCallback = step4Controller.communications.requestingCallback;
  const callbackRequested = step4Controller.communications.callbackRequested;
  const callbackError = step4Controller.communications.callbackError;
  const applyingBundleId = step4Controller.selection.applyingBundleId;

  const defaultBundle = useMemo<BundleSelection>(() => ({
    excess:
      Number(quote?.primaryOption?.voluntaryExcess || 0) ||
      Number(quote?.primaryOption?.totalExcess || 0) ||
      parseExcess(data.requiredExcess),
    claimProtection: false,
    vipRoadside: false,
  }), [data.requiredExcess, quote?.primaryOption?.totalExcess, quote?.primaryOption?.voluntaryExcess]);

  const [baseBundle, setBaseBundle] = useState<BundleSelection>(defaultBundle);
  const [currentBundle, setCurrentBundle] = useState<BundleSelection>(defaultBundle);
  const baselineInitializedForQuoteRef = useRef<string | null>(null);

  useEffect(() => {
    const quoteRef = String(quote?.reference || '').trim();
    if (!quoteRef) return;
    if (baselineInitializedForQuoteRef.current === quoteRef) return;
    baselineInitializedForQuoteRef.current = quoteRef;
    setBaseBundle({
      excess:
        Number(quote?.primaryOption?.voluntaryExcess || 0) ||
        Number(quote?.primaryOption?.totalExcess || 0) ||
        parseExcess(data.requiredExcess),
      claimProtection: Boolean(currentHasNcbFromQuote),
      vipRoadside: Boolean(currentHasVipFromQuote),
    });
  }, [quote?.reference, quote?.primaryOption?.totalExcess, quote?.primaryOption?.voluntaryExcess, data.requiredExcess, currentHasNcbFromQuote, currentHasVipFromQuote]);

  useEffect(() => {
    const next = {
      excess: currentExcessFromQuote,
      claimProtection: Boolean(currentHasNcbFromQuote),
      vipRoadside: Boolean(currentHasVipFromQuote),
    };
    setCurrentBundle((prev) => {
      if (
        Number(prev.excess) === Number(next.excess) &&
        Boolean(prev.claimProtection) === Boolean(next.claimProtection) &&
        Boolean(prev.vipRoadside) === Boolean(next.vipRoadside)
      ) {
        return prev;
      }
      return next;
    });
  }, [currentExcessFromQuote, currentHasNcbFromQuote, currentHasVipFromQuote]);

  const policyPeriod = getPolicyPeriod(data.renewalDate);
  const selectedExcess = Number(currentBundle.excess ?? 0) || defaultBundle.excess;
  const selectedHasNcbProtection = Boolean(currentBundle.claimProtection);
  const selectedHasVipRoadside = Boolean(currentBundle.vipRoadside);
  const mainCopy = generateBundleCopy({
    excess: selectedExcess,
    hasNcb: selectedHasNcbProtection,
    hasVip: selectedHasVipRoadside,
  });

  useEffect(() => {
    const summary = `${mainCopy.shortTitle} Coverage`;
    onSelectedOptionNameChange?.(summary);
  }, [mainCopy.shortTitle, onSelectedOptionNameChange]);

  const currentOption = quote?.primaryOption;

  const activeExcess = Number(currentBundle.excess || 0) || Number(baseBundle.excess || 0) || defaultBundle.excess;
  const baseSelection: BundleSelection = {
    excess: activeExcess,
    claimProtection: false,
    vipRoadside: false,
  };
  const targetVipSelection: BundleSelection = {
    ...baseSelection,
    claimProtection: selectedHasNcbProtection,
    vipRoadside: true,
  };
  const targetVipOffSelection: BundleSelection = {
    ...baseSelection,
    claimProtection: selectedHasNcbProtection,
    vipRoadside: false,
  };
  const targetNcbSelection: BundleSelection = {
    ...baseSelection,
    vipRoadside: selectedHasVipRoadside,
    claimProtection: true,
  };
  const targetNcbOffSelection: BundleSelection = {
    ...baseSelection,
    vipRoadside: selectedHasVipRoadside,
    claimProtection: false,
  };
  const baseAnnualPremium = Number(extrasPricing.baseAnnual ?? 0);
  const vipDelta =
    extrasPricing.vipAnnual !== null && baseAnnualPremium > 0
      ? (extrasPricing.vipAnnual - baseAnnualPremium)
      : null;
  const ncbDelta =
    extrasPricing.ncbAnnual !== null && baseAnnualPremium > 0
      ? (extrasPricing.ncbAnnual - baseAnnualPremium)
      : null;
  const showVipExtra = selectedHasVipRoadside || vipDelta !== null;
  // ABY-326 — No Claim Bonus Protection is not offered on motorbike risks.
  const isMotorcycle = (() => {
    const vt = String(data.vehicleType || '').toLowerCase();
    return vt.includes('motorbike') || vt.includes('motorcycle');
  })();
  const showNcbExtra = !isMotorcycle && (selectedHasNcbProtection || ncbDelta !== null);
  const hasAnyExtraCard = showVipExtra || showNcbExtra;
  const recommendationCards = deriveRecommendationCards({
    recommendations: recs?.recommendations,
    baseBundle,
    currentBundle,
    applyingBundleId,
  });

  const shellLoading = !quote || (isDeclined === false && isReferral === false && !currentOption);

  if (!quote) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-12 flex justify-center">
        <div className="flex flex-col items-center animate-pulse gap-4">
          <div className="w-12 h-12 rounded-full bg-gray-100" />
          <div className="h-4 w-48 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  const subline = MOTOR_PRESENTATION.heroSubline(data);
  const showWindscreenCover = data.coverRequired !== 'Third Party Liability';

  const badges: PremiumCardBadge[] = [
    { label: `Excess €${Number(selectedExcess || 0).toLocaleString('en-IE')}`, tone: 'neutral' },
  ];
  if (selectedHasNcbProtection) {
    badges.push({
      label: 'NCB protection',
      icon: <ShieldCheck className="w-3.5 h-3.5" />,
      tone: 'emerald',
    });
  }
  if (selectedHasVipRoadside) {
    badges.push({
      label: 'VIP roadside (non-refundable)',
      icon: <Star className="w-3.5 h-3.5" />,
      tone: 'sky',
    });
  }

  const inclusions = [
    { label: 'Comprehensive Protection' },
    { label: 'Legal Liability & Assistance' },
    ...(showWindscreenCover ? [{ label: 'Windscreen Cover Included (up to €1,250)' }] : []),
    ...(isCabrioSelected(data.cabrio) ? [{ label: CABRIO_ADDITIONAL_EXCESS_NOTICE }] : []),
  ];

  const sidebarCards: QuoteSummaryCard[] = [
    {
      id: 'driver',
      icon: <User className="w-4 h-4 text-[#004a8a]" />,
      label: 'Main Driver',
      primary: `${data.proposer?.firstName || ''} ${data.proposer?.lastName || ''}`.trim() || '—',
      secondary: `${data.licenseYears} years licence · ${formatDateOfBirthEu(data.proposer?.dateOfBirth || '')}`,
      onEdit: () => onRequestEdit(1),
    },
    {
      id: 'vehicle',
      icon: <Car className="w-4 h-4 text-[#004a8a]" />,
      label: 'Vehicle',
      primary: `${data.year} ${data.make} ${data.model}`.trim(),
      secondary: (
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-gray-500 bg-gray-50 px-2 py-0.5 rounded">{data.fuelType}</span>
          <span className="text-xs text-gray-500 bg-gray-50 px-2 py-0.5 rounded">
            €{data.vehicleValue?.toLocaleString()} Indicative value by client
          </span>
        </div>
      ),
      onEdit: () => onRequestEdit(2),
    },
    {
      id: 'period',
      icon: <Calendar className="w-4 h-4 text-[#004a8a]" />,
      label: 'Period',
      primary: `${policyPeriod.start} — ${policyPeriod.end}`,
      secondary: `${policyPeriod.days} days covered`,
      onEdit: () => onRequestEdit(2),
    },
  ];

  const warningsContent = Array.isArray(quote?.warnings) && quote.warnings.length > 0 ? (
    <>
      {quote.warnings.map((w, i) => (<p key={i}>• {w}</p>))}
    </>
  ) : null;

  const validUntilDisplay = formatDateEu(quote.validUntil);

  return (
    <>
      <QuotePresentationShell
        quoteResponse={asRecord(quote)}
        rating={shellLoading}
        hero={{
          eyebrow: MOTOR_PRESENTATION.heroEyebrow,
          eyebrowTone: 'emerald',
          eyebrowIcon: <ShieldCheck className="w-5 h-5" />,
          headline: MOTOR_PRESENTATION.heroHeadline,
          subline,
          statusLabel: 'Active',
        }}
        background={MOTOR_PRESENTATION.background}
        celebration={MOTOR_PRESENTATION.celebration.variant}
        loadingTitle={MOTOR_PRESENTATION.loadingTitle}
        loadingArtwork={MOTOR_PRESENTATION.loadingArtwork}
        extraReadinessSignals={[initialRecsDone, initialExtrasDone, !recsLoading]}
        declinedSpecialistPhone={MOTOR_DECLINED_PHONE}
        onReferralCallback={() => step4Controller.actions.requestCallback()}
        referralState={{
          busy: requestingCallback,
          requested: callbackRequested,
          error: callbackError,
        }}
        slots={{
          referral: indicativeAnnualPremium !== null ? (
            <div data-testid="motor-referral-indicative-premium">
              <p className="text-xs uppercase text-blue-400 mb-1 font-bold tracking-wider">Indicative annual premium</p>
              <p className="text-3xl font-bold text-[#004a8a] tracking-tight">
                {formatPremium(indicativeAnnualPremium, quote?.currency || 'EUR')}
              </p>
              <p className="mt-2 text-sm text-gray-600">
                This is an indicative premium only and remains subject to underwriting approval. You cannot purchase cover until the review is complete.
              </p>
            </div>
          ) : null,
          primary: currentOption ? (
            <>
              <PremiumCard
                variants={fadeIn}
                title={`${mainCopy.shortTitle} Coverage`}
                badges={badges}
                annualPremium={currentOption.annualPremium}
                currency="EUR"
                inclusions={inclusions}
                actions={{
                  primaryLabel: 'Secure this price',
                  onPrimary: () => step4Controller.actions.proceedToPayment(),
                  onInfo: () => setShowDebug(true),
                  email: {
                    onClick: () => {
                      setIsEmailIconHovered(false);
                      setEmailQuoteStatus(null);
                      void step4Controller.actions.triggerQuoteEmail();
                    },
                    busy: sendingQuoteEmail,
                    isHovered: isEmailIconHovered,
                    onHoverChange: setIsEmailIconHovered,
                  },
                  download: {
                    onClick: () => { void step4Controller.actions.downloadQuotePdf(); },
                    busy: downloading,
                  },
                }}
                footnotePrimary="No payment taken until you confirm on the next step."
                footnoteSecondary="Add-ons (Roadside, ULR, VIP) are non-refundable and charged separately from insurer premium."
              />

              {REGION_CONFIG.defaultRegionCode === 'CY' ? (
                <p className="text-center text-sm text-slate-600">
                  <a
                    href="/api/public/ipid/motor"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[#004a8a] hover:underline"
                  >
                    View the Insurance Product Information Document (IPID)
                  </a>
                </p>
              ) : null}

              <Step4ExtrasCards
                variants={fadeIn}
                hasAnyExtraCard={hasAnyExtraCard}
                showVipExtra={showVipExtra}
                showNcbExtra={showNcbExtra}
                selectedHasVipRoadside={selectedHasVipRoadside}
                selectedHasNcbProtection={selectedHasNcbProtection}
                extrasLoading={extrasPricing.loading}
                applyingBundleId={applyingBundleId}
                vipDelta={vipDelta}
                ncbDelta={ncbDelta}
                formatDelta={formatDelta}
                onToggleVip={() => {
                  if (extrasPricing.loading || applyingBundleId === 'extra-vip') return;
                  const minAllowedExcess = Number(baseBundle.excess || 0) || step4Controller.actions.parseExcess(data.requiredExcess);
                  void step4Controller.actions.applyBundleSelection({
                    bundleId: 'extra-vip',
                    selection: selectedHasVipRoadside ? targetVipOffSelection : targetVipSelection,
                    currentBundle,
                    setCurrentBundle,
                    minAllowedExcess,
                  });
                }}
                onToggleNcb={() => {
                  if (extrasPricing.loading || applyingBundleId === 'extra-ncb') return;
                  const minAllowedExcess = Number(baseBundle.excess || 0) || step4Controller.actions.parseExcess(data.requiredExcess);
                  void step4Controller.actions.applyBundleSelection({
                    bundleId: 'extra-ncb',
                    selection: selectedHasNcbProtection ? targetNcbOffSelection : targetNcbSelection,
                    currentBundle,
                    setCurrentBundle,
                    minAllowedExcess,
                  });
                }}
              />

              <Step4RecommendationsPanel
                variants={fadeIn}
                error={recsError}
                showLoading={!initialRecsDone || !initialExtrasDone || recsLoading}
                recommendationCards={recommendationCards}
                onSelectRecommendation={(card) => {
                  const { bundleId, selection, rec, isBusy } = card;
                  if (!bundleId || isBusy) return;
                  const minAllowedExcess = Number(baseBundle.excess || 0) || step4Controller.actions.parseExcess(data.requiredExcess);
                  void step4Controller.actions.applyBundleSelection({
                    bundleId,
                    selection,
                    rec,
                    currentBundle,
                    setCurrentBundle,
                    minAllowedExcess,
                  });
                }}
              />
            </>
          ) : null,
          warnings: warningsContent,
          sidebar: (
            <QuoteSummarySidebar
              variants={fadeIn}
              reference={quote.reference}
              validUntil={validUntilDisplay}
              cards={sidebarCards}
              footnote="Price includes all taxes and fees. By proceeding you confirm the details above are accurate."
            />
          ),
        }}
      />

      {currentOption ? (
        <Step4DebugModal
          isOpen={showDebug}
          onClose={() => setShowDebug(false)}
          option={currentOption}
          quoteReference={quote.reference}
        />
      ) : null}

      {emailQuoteStatus ? (
        <div
          className={`fixed left-1/2 -translate-x-1/2 top-6 z-[120] rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg max-w-[92vw] ${emailQuoteStatus.kind === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : emailQuoteStatus.kind === 'info'
              ? 'border-sky-200 bg-sky-50 text-sky-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
        >
          {emailQuoteStatus.message}
        </div>
      ) : null}

      <EmailOtpVerifyModal
        isOpen={showVerifyCode}
        email={String(data?.proposer?.email || '').trim()}
        title="Verify Code"
        subtitle="Enter the 6-digit code sent to"
        verifyButtonLabel="Verify"
        verifyingLabel="Verifying…"
        postVerifyPendingLabel="Sending…"
        redirectTo=""
        requestPayload={{ flow: 'QUOTE_EMAIL' }}
        verifyPayload={{ flow: 'QUOTE_EMAIL' }}
        requireAuthToken={false}
        onVerified={async (payload) => {
          await step4Controller.actions.sendVerifiedQuoteEmail(payload);
        }}
        onClose={() => setShowVerifyCode(false)}
      />
    </>
  );
}

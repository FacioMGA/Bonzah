import { useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import { Calendar, Coins, Home as HomeIcon } from 'lucide-react';
import {
  PremiumCard,
  QuotePresentationShell,
  QuoteSummarySidebar,
  type PremiumCardInclusion,
  type QuoteSummaryCard,
} from '@/src/shared/lib/wizard';
import {
  resolvePresentationProfile,
  type WizardPresentationProfile,
} from '@/src/products/catalog';
import type { HomeFormValues } from '../../quoteWizard.constants';

export interface HomeQuoteStepProps {
  /** Quote response from `POST /api/public/home/session/:token/rate`. */
  quoteResponse: Record<string, unknown> | null;
  /** True while a rate request is in flight. */
  rating: boolean;
  /** Re-rate trigger (recalculate). */
  onRate: () => void | Promise<void>;
  /** Proceed-to-acceptance handler (used by the shell's primary CTA). */
  onProceed: () => void;
  /** Optional override of the presentation profile. */
  presentationOverride?: WizardPresentationProfile;
}

const HOME_PRESENTATION = resolvePresentationProfile('home');

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatDateDisplay(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Home quote review step. Composes the shared `QuotePresentationShell`
 * with the home presentation profile and the home-specific summary
 * sidebar (Property / Cover / Period). No motor-specific extras
 * (NCB/VIP/recommendations); home stays calm by design.
 */
export function HomeQuoteStep({
  quoteResponse,
  rating,
  onRate,
  onProceed,
  presentationOverride,
}: HomeQuoteStepProps) {
  const { getValues } = useFormContext<HomeFormValues>();
  const presentation = presentationOverride || HOME_PRESENTATION;
  const formValues = getValues();

  const primaryOption = asRecord(quoteResponse?.primaryOption);
  const annualPremium = Number(primaryOption.annualPremium || 0);
  const currency = String(quoteResponse?.currency || 'EUR');
  const reference = String(quoteResponse?.reference || '').trim() || undefined;
  const validUntil = formatDateDisplay(quoteResponse?.validUntil) || undefined;

  const property = asRecord(formValues.property);
  const propertyAddress = asRecord(property.address);
  const coverage = asRecord(formValues.coverage);
  const policy = asRecord(formValues.policy);

  const propertyTitle = String(property.propertyType || 'Home').trim();
  const propertyCity = String(propertyAddress.city || '').trim();
  const propertyCountry = String(propertyAddress.country || '').trim();
  const buildings = Number(coverage.buildings || 0);
  const contents = Number(coverage.contents || 0);
  const adBuildings = coverage.accidentalDamageBuildings === true;
  const adContents = coverage.accidentalDamageContents === true;
  const startDateDisplay = formatDateDisplay(policy.startDate) || '—';

  const subline = useMemo(
    () => presentation.heroSubline(formValues),
    [formValues, presentation],
  );

  // ABY-36: surface accidental-damage cover on the quote summary so the
  // customer can SEE that the box they ticked on Step 4 actually made it
  // into the policy they're about to bind. We extend the static
  // presentation inclusions with the customer's actual choices instead
  // of inventing a parallel "extras" panel — same rendering pipeline,
  // one source of truth, no duplicate copy.
  const inclusions: PremiumCardInclusion[] = useMemo(() => {
    const base = presentation.inclusions.map((label) => ({ label }));
    const extras: PremiumCardInclusion[] = [];
    if (adBuildings) extras.push({ label: 'Accidental damage to buildings' });
    if (adContents) extras.push({ label: 'Accidental damage to contents' });
    return [...base, ...extras];
  }, [presentation.inclusions, adBuildings, adContents]);

  // ABY-36: extend the right-rail "Cover" card with an Accidental damage
  // sub-line so it's visible at a glance next to Buildings & Contents.
  const coverSecondary = useMemo(() => {
    const lines: string[] = [];
    if (contents > 0) lines.push(`Contents €${contents.toLocaleString('en-IE')}`);
    if (adBuildings && adContents) lines.push('Accidental damage: buildings & contents');
    else if (adBuildings) lines.push('Accidental damage: buildings');
    else if (adContents) lines.push('Accidental damage: contents');
    if (lines.length === 0) return undefined;
    return (
      <div className="space-y-0.5">
        {lines.map((line) => <div key={line}>{line}</div>)}
      </div>
    );
  }, [contents, adBuildings, adContents]);

  const sidebarCards: QuoteSummaryCard[] = useMemo(() => [
    {
      id: 'property',
      icon: <HomeIcon className="w-4 h-4 text-[#004a8a]" />,
      label: 'Property',
      primary: propertyTitle,
      secondary: [propertyCity, propertyCountry].filter(Boolean).join(', ') || undefined,
    },
    {
      id: 'cover',
      icon: <Coins className="w-4 h-4 text-[#004a8a]" />,
      label: 'Cover',
      primary: `Buildings €${buildings.toLocaleString('en-IE')}`,
      secondary: coverSecondary,
    },
    {
      id: 'period',
      icon: <Calendar className="w-4 h-4 text-[#004a8a]" />,
      label: 'Start date',
      primary: startDateDisplay,
      secondary: '12 months cover',
    },
  ], [buildings, coverSecondary, propertyCity, propertyCountry, propertyTitle, startDateDisplay]);

  return (
    <QuotePresentationShell
      quoteResponse={quoteResponse}
      rating={rating}
      hero={{
        eyebrow: presentation.heroEyebrow,
        eyebrowTone: 'emerald',
        headline: presentation.heroHeadline,
        subline,
        statusLabel: 'Active',
      }}
      background={presentation.background}
      celebration={presentation.celebration.variant}
      loadingTitle={presentation.loadingTitle}
      loadingArtwork={presentation.loadingArtwork}
      // Home rates upstream in the wizard controller (during the Security →
      // Quote `onNext`), which already shows a 3s polished loader. Skip the
      // gate's own min-delay so the quote reveals as soon as the user lands
      // on the review step instead of waiting another 3s.
      minDelayMs={0}
      preRateCtaLabel="Get my quote"
      onRate={onRate}
      slots={{
        primary: (
          <>
          <PremiumCard
            variants={{
              hidden: { opacity: 0, y: 10 },
              visible: (i: number) => ({
                opacity: 1,
                y: 0,
                transition: { delay: (i as number) * 0.1, duration: 0.5, ease: 'easeOut' as const },
              }),
            }}
            title={`${propertyTitle} Coverage`}
            badges={buildings > 0 ? [{ label: `Buildings €${buildings.toLocaleString('en-IE')}`, tone: 'neutral' }] : []}
            annualPremium={annualPremium}
            currency={currency}
            inclusions={inclusions}
            actions={{
              primaryLabel: 'Continue to acceptance',
              onPrimary: onProceed,
            }}
            footnotePrimary="No payment taken until you confirm on the next step."
          />
          <div className="text-center mt-3 space-y-1">
            <a
              href="/api/public/ipid/home"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-brand-primary hover:underline"
            >
              View the Insurance Product Information Document (IPID)
            </a>
            <p className="text-xs text-slate-600">
              We email your quotation, IPID, and Terms of Business as soon as your quote is ready.
            </p>
          </div>
          </>
        ),
        sidebar: (
          <QuoteSummarySidebar
            variants={{
              hidden: { opacity: 0, y: 10 },
              visible: (i: number) => ({
                opacity: 1,
                y: 0,
                transition: { delay: (i as number) * 0.1, duration: 0.5, ease: 'easeOut' as const },
              }),
            }}
            reference={reference}
            validUntil={validUntil}
            cards={sidebarCards}
            footnote="Price includes all taxes and fees. By proceeding you confirm the details above are accurate."
          />
        ),
      }}
    />
  );
}

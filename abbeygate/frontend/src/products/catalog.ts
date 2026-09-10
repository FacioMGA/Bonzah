import type { ProductManifest } from '@facio/products';
import { businessManifest, healthManifest, homeManifest, motorManifest, openMarketManifest, travelManifest } from '@facio/products';
import type {
  QuoteBackgroundPalette,
  QuoteLoadingVariant,
  QuoteSuccessCelebrationVariant,
} from '@/src/shared/lib/wizard';

/**
 * Frontend-only presentation profile for a product's quote review surface.
 *
 * Lives alongside the catalog (NOT inside `@facio/products`) because tone /
 * gradient / celebration variant are pure UX concerns that vary by surface
 * and brand and have no business shape. Backend manifests stay untouched.
 */
export type WizardPresentationProfile = {
  /** Display label used in headlines / loaders (e.g. "motor insurance"). */
  productLabel: string;
  /** Eyebrow chip text on the quote hero (e.g. "Online Quote Ready"). */
  heroEyebrow: string;
  /** Big headline (e.g. "Your Motor Insurance Quote"). */
  heroHeadline: string;
  /**
   * Sub-headline factory. Receives the form snapshot (typed `unknown` because
   * the catalog is product-agnostic) so each product can safely narrow it via
   * `asRecord` and render contextual copy (make/model, city, trip days).
   */
  heroSubline: (formValues: unknown) => string;
  /** Persistent animated background gradient. */
  background: QuoteBackgroundPalette;
  /** Quote-success celebration moment. */
  celebration: { variant: QuoteSuccessCelebrationVariant };
  /** Default inclusions list for the premium card. */
  inclusions: string[];
  /** Loader title shown while the quote is calculating. */
  loadingTitle: string;
  /**
   * Artwork shown on the calculating loader. The shared loader maps these
   * presentation tokens to icons + motion (e.g. `'vehicle'` → driving car,
   * `'plane'` → flying plane, `'house'` → home with protection rings).
   */
  loadingArtwork: QuoteLoadingVariant;
};

export type FrontendProductCatalogEntry = {
  manifest: ProductManifest;
  publicEntryPath: string;
  firstStep: string;
  publicSessionSlug: string;
  presentation: WizardPresentationProfile;
  /**
   * ISO-3166-1 alpha-2 country codes where this product is actually sold.
   *
   * Mirrors the canonical backend jurisdiction product config
   * (`backend/modules/jurisdiction/domain/productConfiguration.ts` — e.g.
   * only a `CY/HEALTH` entry exists) and the product's UW appetite. This
   * is a read-only UI projection of that authority, NOT a second source of
   * truth: the server still declines an out-of-appetite risk.
   *
   * Omit to mean "offered in every operating jurisdiction" (the current
   * default for the mature products). When set, the public product picker
   * and quote-start routes hide the product on hosts whose country is not
   * listed, so we never invite a customer into a quote underwriting can
   * only decline (ABY-361: Immigration Medical is Cyprus-only).
   */
  availableCountryCodes?: string[];
};

function getNested(values: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (current, key) => (current && typeof current === 'object'
      ? (current as Record<string, unknown>)[key]
      : undefined),
    values,
  );
}

const motorPresentation: WizardPresentationProfile = {
  productLabel: 'motor insurance',
  heroEyebrow: 'Online Quote Ready',
  heroHeadline: 'Your Motor Insurance Quote',
  heroSubline: (values) => {
    const make = String(getNested(values, 'make') || '').trim();
    const model = String(getNested(values, 'model') || '').trim();
    if (make || model) return `Tailored cover for your ${[make, model].filter(Boolean).join(' ')}`;
    return 'Tailored cover for your vehicle';
  },
  // Energetic blue sky — the existing motor look.
  background: { from: '#f0f9ff', via: '#ffffff', to: '#e0f2fe' },
  celebration: { variant: 'confetti' },
  inclusions: [
    'Comprehensive Protection',
    'Legal Liability & Assistance',
  ],
  loadingTitle: 'Calculating your motor insurance quote…',
  loadingArtwork: 'vehicle',
};

const homePresentation: WizardPresentationProfile = {
  productLabel: 'home insurance',
  heroEyebrow: 'Your home is covered',
  heroHeadline: 'Your Home Insurance Quote',
  heroSubline: (values) => {
    const city = String(getNested(values, 'property.address.city') || '').trim();
    if (city) return `Tailored protection for your home in ${city}`;
    const propertyType = String(getNested(values, 'property.propertyType') || '').trim();
    if (propertyType) return `Tailored protection for your ${propertyType.toLowerCase()}`;
    return 'Tailored protection for your home';
  },
  // Calmer warm gradient — protection / trust over carnival energy.
  background: { from: '#fefce8', via: '#ffffff', to: '#ecfdf5' },
  celebration: { variant: 'subtle' },
  inclusions: [
    'Buildings & contents covered as standard',
    '24/7 claims support — speak to a real person',
    '14-day cooling-off period',
  ],
  loadingTitle: 'Calculating your home insurance quote…',
  loadingArtwork: 'house',
};

const travelPresentation: WizardPresentationProfile = {
  productLabel: 'travel insurance',
  heroEyebrow: 'Your trip is covered',
  heroHeadline: 'Your Travel Insurance Quote',
  heroSubline: (values) => {
    const destinations = getNested(values, 'trip.destinations');
    if (Array.isArray(destinations) && destinations.length > 0) {
      return `Cover for your trip to ${destinations.join(', ')}`;
    }
    return 'Cover tailored to your trip';
  },
  background: { from: '#eff6ff', via: '#ffffff', to: '#fef3c7' },
  celebration: { variant: 'subtle' },
  inclusions: [
    'Medical & emergency assistance',
    '24/7 multilingual support',
    '14-day cooling-off period',
  ],
  loadingTitle: 'Calculating your travel insurance quote…',
  loadingArtwork: 'plane',
};

const healthPresentation: WizardPresentationProfile = {
  productLabel: 'immigration medical insurance',
  heroEyebrow: 'Approved Lloyd\u2019s medical cover',
  heroHeadline: 'Your Immigration Medical Cover',
  heroSubline: (values) => {
    const insureds = getNested(values, 'insureds.persons');
    if (Array.isArray(insureds) && insureds.length > 0) {
      const count = insureds.length;
      return `${count} insured ${count === 1 ? 'person' : 'persons'} resident in Cyprus`;
    }
    return 'Brit Immigration Medical Insurance — Cyprus only';
  },
  // Calm teal/emerald gradient — medical/trust tone, distinct from travel's blue/amber.
  background: { from: '#ecfdf5', via: '#ffffff', to: '#e0f2fe' },
  celebration: { variant: 'subtle' },
  inclusions: [
    'Inpatient & emergency hospitalisation',
    'Outpatient extension for GESY beneficiaries',
    '14-day cooling-off period',
  ],
  loadingTitle: 'Calculating your immigration medical cover…',
  // No medical artwork variant exists yet — `sparkle` keeps the loader
  // brand-neutral. New artwork would require a shared QuoteLoading change.
  loadingArtwork: 'sparkle',
};

const businessPresentation: WizardPresentationProfile = {
  productLabel: 'business insurance',
  heroEyebrow: 'Commercial cover request',
  heroHeadline: 'Your Business Insurance Request',
  heroSubline: (values) => {
    const businessType = String(getNested(values, 'business.typeOfBusiness') || '').trim();
    return businessType ? `Manual commercial review for ${businessType}` : 'Manual commercial review by Abbeygate staff';
  },
  background: { from: '#f8fafc', via: '#ffffff', to: '#e0f2fe' },
  celebration: { variant: 'subtle' },
  inclusions: [
    'Property, liability and business interruption options',
    'Manual underwriting review',
    'Staff-assisted proposal',
  ],
  loadingTitle: 'Preparing your business insurance request...',
  loadingArtwork: 'sparkle',
};

const openMarketPresentation: WizardPresentationProfile = {
  productLabel: 'open market',
  heroEyebrow: 'Manual proposal',
  heroHeadline: 'Open Market Submission',
  heroSubline: () => 'Coverage rows and premium values are assembled manually by staff',
  background: { from: '#f8fafc', via: '#ffffff', to: '#ede9fe' },
  celebration: { variant: 'subtle' },
  inclusions: [
    'Manual market placement',
    'Editable coverage and pricing rows',
    'No automated price shown to customers',
  ],
  loadingTitle: 'Preparing your open market submission...',
  loadingArtwork: 'sparkle',
};

export const productCatalog: FrontendProductCatalogEntry[] = [
  {
    manifest: motorManifest,
    publicEntryPath: '/quote/motor/new',
    firstStep: 'policy-holder',
    publicSessionSlug: 'motor',
    presentation: motorPresentation,
  },
  {
    manifest: homeManifest,
    publicEntryPath: '/quote/home/new',
    firstStep: 'policy-holder',
    publicSessionSlug: 'home',
    presentation: homePresentation,
  },
  {
    manifest: travelManifest,
    publicEntryPath: '/quote/travel/new',
    firstStep: 'eligibility',
    publicSessionSlug: 'travel',
    presentation: travelPresentation,
  },
  {
    manifest: healthManifest,
    publicEntryPath: '/quote/health/new',
    firstStep: 'your-details',
    publicSessionSlug: 'health',
    presentation: healthPresentation,
    // Brit Immigration Medical is Cyprus-only (Phase 1): the jurisdiction
    // config only has a CY/HEALTH entry and UW allowedResidenceCountries is
    // ['Cyprus']. Don't offer it on PT/GR/ES sites where it can only decline.
    availableCountryCodes: ['CY'],
  },
  {
    manifest: businessManifest,
    publicEntryPath: '/quote/business/new',
    firstStep: 'proposer',
    publicSessionSlug: 'business',
    presentation: businessPresentation,
  },
  {
    manifest: openMarketManifest,
    publicEntryPath: '/quote/open-market/new',
    firstStep: 'intake',
    publicSessionSlug: 'open-market',
    presentation: openMarketPresentation,
  },
];

/**
 * Lightweight quick-start entry tiles (ABY-335).
 *
 * Some vehicle classes deserve their own entry point on the product
 * picker even though they are rated through the existing motor product.
 * These are pure frontend shortcuts: each links into the canonical motor
 * quote-start route with a `vehicleType` seed (consumed by
 * `GenericQuoteStartPage.createSeedForProduct`). No new product, manifest,
 * route handler, or backend surface is introduced.
 */
export type QuickStartEntry = {
  key: string;
  label: string;
  path: string;
  blurb: string;
};

export const QUICK_START_ENTRIES: QuickStartEntry[] = [
  {
    key: 'motorbike',
    label: 'Motorbike',
    path: '/quote/motor/new?vehicleType=Motorbike',
    blurb: 'Motorbikes, scooters and mopeds.',
  },
];

/**
 * Whether a catalog product should be offered on the public surface for the
 * given operating country code (from `getOperatingCountryFromHost`).
 *
 * - No `availableCountryCodes` → offered everywhere (the mature products).
 * - `countryCode === null` (unknown host: localhost / preview deploys) →
 *   offered; we do not constrain when the jurisdiction is unknown rather
 *   than silently defaulting to a country (`no-defensive-fallbacks`).
 * - Otherwise → only when the code is listed for that product.
 */
export function isProductAvailableInCountry(
  entry: FrontendProductCatalogEntry,
  countryCode: string | null,
): boolean {
  if (!entry.availableCountryCodes) return true;
  if (!countryCode) return true;
  return entry.availableCountryCodes.includes(countryCode);
}

/** Resolve the active presentation profile by `publicSessionSlug`. */
export function resolvePresentationProfile(slug: string): WizardPresentationProfile {
  const entry = productCatalog.find((p) => p.publicSessionSlug === slug);
  if (!entry) {
    // Defensive fallback: never crash a wizard if the catalog is misconfigured.
    return motorPresentation;
  }
  return entry.presentation;
}

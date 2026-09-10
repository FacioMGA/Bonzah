import { parseRecord, quoteCurrency, quotePrimaryAnnualPremium } from '../../../platform/utils/mappingHelpers.js';
import { ProductRegistry } from '../domain/ProductRegistry.js';

/**
 * Shape we extract off a loaded Policy (with `stateCurrent`) to hydrate the
 * `QUOTE_STANDARD` email template. Every caller of `sendQuoteEmail` should
 * run the Policy through `buildQuoteEmailContext` so that `quote.reference`,
 * `quote.premium`, `quote.excess`, and `policy.registration` are populated
 * from authoritative sources instead of being defaulted to `''` — which
 * the template renderer treats as "missing" and causes the whole dispatch
 * to be silently skipped.
 */
export interface QuoteEmailContext {
  quote: { reference: string; premium: string; excess: string; productLabel: string };
  policy: { registration: string; vehicleDescription: string };
}

export interface PolicyForQuoteEmail {
  policyNumber: string;
  quoteResponse: unknown;
  quoteData: unknown;
  productType?: string | null;
  vehicleInfo: unknown;
  /** Normalised column; not present on every Policy select. */
  vehicleRegistrationNumber?: string | null;
  /** Normalised column; not present on every Policy select. */
  excessAmount?: { toString(): string } | null;
  stateCurrent: { snapshot: unknown } | null;
}

/**
 * Best-effort money formatter for email bodies (e.g. "EUR 250.38").
 * Returns empty when we truly have no amount — `sendQuoteEmail` then
 * substitutes an em-dash placeholder so the email still ships rather
 * than silently dropping on a missing-variable validation.
 */
function formatMoneyForEmail(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount) || amount <= 0) return '';
  const ccy = String(currency || 'EUR').trim().toUpperCase() || 'EUR';
  return `${ccy} ${amount.toFixed(2)}`;
}

function productLabelForEmail(productType: unknown): string {
  const normalized = String(productType || '').trim().toUpperCase();
  if (normalized === 'BUSINESS') return 'business insurance proposal';
  if (normalized === 'OPEN_MARKET') return 'open market proposal';
  if (normalized === 'HOME') return 'home insurance quote';
  if (normalized === 'TRAVEL') return 'travel insurance quote';
  if (normalized === 'HEALTH') return 'health insurance quote';
  return 'motor insurance quote';
}

export function buildQuoteEmailContext(policy: PolicyForQuoteEmail): QuoteEmailContext {
  const snap = parseRecord(policy.stateCurrent?.snapshot);
  const qd = parseRecord(snap.quoteData || policy.quoteData);
  const vehicle = parseRecord(policy.vehicleInfo);

  const currency = quoteCurrency(policy.quoteResponse, 'EUR');
  const premiumNumber = quotePrimaryAnnualPremium(policy.quoteResponse);
  const premium = formatMoneyForEmail(premiumNumber, currency);

  const registrationRaw = String(
    qd.registrationNumber ?? vehicle.registrationNumber ?? policy.vehicleRegistrationNumber ?? ''
  ).trim();

  const excessRaw = String(qd.requiredExcess ?? '').trim();
  const excessFromColumn = policy.excessAmount != null
    ? `${currency} ${Number(policy.excessAmount.toString()).toFixed(2)}`
    : '';
  const excess = excessRaw || excessFromColumn;

  const vehicleDescription = [qd.make ?? vehicle.make, qd.model ?? vehicle.model]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ');
  const businessName = [parseRecord(qd.proposer).firstName, parseRecord(qd.proposer).lastName]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ');
  const property = parseRecord(qd.property);
  const propertyAddress = parseRecord(property.address);
  const homeDescription = [
    property.propertyType,
    propertyAddress.line1 || propertyAddress.line || propertyAddress.street,
    propertyAddress.city || propertyAddress.town,
  ]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ');
  const adapter = ProductRegistry.getInstance().getAdapter(String(policy.productType || '').trim().toUpperCase());
  const productPresentation = adapter?.buildQuoteEmailPresentation?.(qd);

  return {
    quote: {
      reference: String(policy.policyNumber || '').trim(),
      premium,
      excess: productPresentation ? productPresentation.excessLabel : excess,
      productLabel: productLabelForEmail(policy.productType),
    },
    policy: {
      registration: registrationRaw,
      vehicleDescription: productPresentation
        ? productPresentation.coverLabel
        : (String(policy.productType || '').trim().toUpperCase() === 'HOME'
          ? homeDescription
          : (vehicleDescription || businessName)),
    },
  };
}

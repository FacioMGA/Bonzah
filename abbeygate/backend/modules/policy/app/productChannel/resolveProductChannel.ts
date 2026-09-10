/**
 * Product channel switches resolver (ADR-0046).
 *
 * Resolves, for the current operating tenant, the three public-journey gates
 * for a product:
 *   - `questions` → may the public open/fill the quote wizard
 *   - `quote`     → may the public run rating / see a price
 *   - `payment`   → may the public pay online (CardCorp checkout)
 *
 * The canonical store is the tenant-scoped `ProductChannelSetting` table. When
 * a row is absent (a freshly added tenant/product), we fall back to a reviewed
 * in-code default map so a missing row never silently enables payment.
 *
 * Single owner of the concept. Callers (public session/rate/checkout handlers,
 * the public projection endpoint, the BO settings screen) MUST go through here
 * rather than reading the table directly.
 */
import { tenantScopedPrisma } from '../../../../platform/db/connection.js';

export type ProductChannel = {
  questions: boolean;
  quote: boolean;
  payment: boolean;
};

export type ProductChannelGate = keyof ProductChannel;

/** Canonical product codes that have a public journey. */
export const PRODUCT_CHANNEL_CODES = [
  'MOTOR',
  'HOME',
  'TRAVEL',
  'HEALTH',
  'BUSINESS',
  'OPEN_MARKET',
] as const;

export type ProductChannelCode = (typeof PRODUCT_CHANNEL_CODES)[number];

/**
 * Reviewed launch defaults — mirror the seeded migration rows. Payment is OFF
 * unless a product is explicitly online (travel, health). Used only when no DB
 * row exists for the (tenant, product) pair.
 */
const DEFAULT_PRODUCT_CHANNELS: Record<string, ProductChannel> = {
  MOTOR: { questions: true, quote: true, payment: false },
  // HOME opened for full online purchase (ADR-0046 amendment 2026-07-01).
  HOME: { questions: true, quote: true, payment: true },
  TRAVEL: { questions: true, quote: true, payment: true },
  HEALTH: { questions: true, quote: true, payment: true },
  BUSINESS: { questions: true, quote: true, payment: false },
  OPEN_MARKET: { questions: true, quote: false, payment: false },
};

/** Fallback for an unrecognised product: quote allowed, payment closed. */
const UNKNOWN_PRODUCT_DEFAULT: ProductChannel = { questions: true, quote: true, payment: false };

function normalizeCode(productCode: string): string {
  return String(productCode || '').trim().toUpperCase();
}

function defaultChannelFor(code: string): ProductChannel {
  return DEFAULT_PRODUCT_CHANNELS[code] ?? UNKNOWN_PRODUCT_DEFAULT;
}

/**
 * Resolve the channel switches for a single product in the current operating
 * tenant. Reads the tenant-scoped row (operatingTenantId injected by the Prisma
 * extension); falls back to the in-code default when absent.
 */
export async function resolveProductChannel(productCode: string): Promise<ProductChannel> {
  const code = normalizeCode(productCode);
  const row = await tenantScopedPrisma.productChannelSetting.findFirst({
    where: { productCode: code },
  });
  if (!row) return defaultChannelFor(code);
  return {
    questions: row.questionsEnabled,
    quote: row.quoteEnabled,
    payment: row.paymentEnabled,
  };
}

/**
 * Resolve the channel switches for every known product in the current
 * operating tenant. DB rows win; missing products fall back to defaults. Used
 * by the public projection endpoint and the Back Office settings screen.
 */
export async function resolveAllProductChannels(): Promise<Record<ProductChannelCode, ProductChannel>> {
  const rows = await tenantScopedPrisma.productChannelSetting.findMany();
  const byCode = new Map<string, ProductChannel>();
  for (const row of rows) {
    byCode.set(normalizeCode(row.productCode), {
      questions: row.questionsEnabled,
      quote: row.quoteEnabled,
      payment: row.paymentEnabled,
    });
  }
  const out: Partial<Record<ProductChannelCode, ProductChannel>> = {};
  for (const code of PRODUCT_CHANNEL_CODES) {
    out[code] = byCode.get(code) ?? defaultChannelFor(code);
  }
  return out as Record<ProductChannelCode, ProductChannel>;
}

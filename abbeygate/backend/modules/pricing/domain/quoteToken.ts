import jwt from 'jsonwebtoken';
import { sha256Hex, stableStringify } from '../../policy/domain/hashes.js';

export type QuoteTokenProductType = string;

export type QuoteTokenPayloadV1 = {
  v: 1;
  pt: QuoteTokenProductType;
  ih: string; // inputHash
  p: number; // annual premium
  c: string; // currency
  iat: number;
  exp: number;
};

function resolveSecret(): string {
  // ADR-0019 (PR 2): quote-token signing reads its own dedicated secret.
  // The legacy session-secret fallback has been deleted so a session-secret
  // rotation never silently invalidates outstanding quote tokens (and vice
  // versa). Production must seed `QUOTE_TOKEN_SECRET` separately;
  // `startupValidation.ts` enforces presence at boot.
  const secret = process.env.QUOTE_TOKEN_SECRET;
  if (!secret) {
    throw new Error('FATAL: QUOTE_TOKEN_SECRET is not defined.');
  }
  return secret;
}

function resolveTtlSeconds(): number {
  const raw = process.env.QUOTE_TOKEN_TTL_SECONDS;
  const n = raw ? Number(raw) : NaN;
  // Default 14 days
  return Number.isFinite(n) && n > 60 ? Math.floor(n) : 14 * 24 * 60 * 60;
}

export function resolveEffectiveExcess(quoteData: Record<string, unknown>, overrideExcess?: number | string | null): number | null {
  const fromOverride = overrideExcess !== undefined && overrideExcess !== null ? Number(overrideExcess) : NaN;
  if (Number.isFinite(fromOverride) && fromOverride > 0) return Math.floor(fromOverride);
  const fromQuote = quoteData?.requiredExcess !== undefined && quoteData?.requiredExcess !== null ? Number(quoteData.requiredExcess) : NaN;
  if (Number.isFinite(fromQuote) && fromQuote > 0) return Math.floor(fromQuote);
  return null;
}

export function computeQuoteInputHash(args: {
  productType: QuoteTokenProductType;
  quoteData: Record<string, unknown>;
  overrideExcess?: number | string | null;
  currency: string;
}): string {
  const effectiveExcess = resolveEffectiveExcess(args.quoteData, args.overrideExcess);
  return sha256Hex(
    stableStringify({
      v: 1,
      pt: args.productType,
      currency: String(args.currency || 'EUR'),
      effectiveExcess,
      quoteData: args.quoteData || {},
    })
  );
}

export function signQuoteToken(args: {
  productType: QuoteTokenProductType;
  quoteData: Record<string, unknown>;
  overrideExcess?: number | string | null;
  premium: number;
  currency: string;
}): { token: string; payload: QuoteTokenPayloadV1 } {
  const secret = resolveSecret();
  const ttl = resolveTtlSeconds();
  const now = Math.floor(Date.now() / 1000);

  const ih = computeQuoteInputHash({
    productType: args.productType,
    quoteData: args.quoteData,
    overrideExcess: args.overrideExcess,
    currency: args.currency,
  });

  const payload: QuoteTokenPayloadV1 = {
    v: 1,
    pt: args.productType,
    ih,
    p: Number(args.premium || 0),
    c: String(args.currency || 'EUR'),
    iat: now,
    exp: now + ttl,
  };

  const token = jwt.sign(payload, secret, { algorithm: 'HS256' });
  return { token, payload };
}

export function verifyQuoteToken(token: string): QuoteTokenPayloadV1 {
  const secret = resolveSecret();
  const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  if (!decoded || typeof decoded !== 'object') throw new Error('Invalid quote token');
  const rec = decoded as Record<string, unknown>;
  if (rec.v !== 1) throw new Error('Unsupported quote token version');
  if (!rec.pt || !rec.ih) throw new Error('Malformed quote token');
  const productType = String(rec.pt);
  if (!productType) throw new Error('Malformed quote token: missing product type');
  return {
    v: 1,
    pt: productType,
    ih: String(rec.ih),
    p: Number(rec.p || 0),
    c: String(rec.c || 'EUR'),
    iat: Number(rec.iat || 0),
    exp: Number(rec.exp || 0),
  };
}

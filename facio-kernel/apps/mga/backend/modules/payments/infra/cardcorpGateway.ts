import crypto from 'crypto';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';

type UnknownRecord = Record<string, unknown>;
const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
const toInputJsonValue = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;

const cardcorpResultSchema = z
  .object({
    code: z.string().optional(),
    description: z.string().optional(),
  })
  .optional();

const cardcorpResponseSchema = z.object({
  id: z.string().optional(),
  integrity: z.string().optional(),
  result: cardcorpResultSchema,
  amount: z.string().optional(),
  currency: z.string().optional(),
});

export type CardcorpCreateCheckoutInput = {
  entityId: string;
  bearerToken: string;
  baseUrl: string;
  amount: string;
  currency: string;
  paymentType: 'DB' | 'PA' | 'CD';
  merchantTransactionId: string;
  integrity?: boolean;
  testMode?: 'EXTERNAL' | 'INTERNAL';
  shopperResultUrl?: string;
  customer?: {
    email?: string;
    givenName?: string;
    surname?: string;
    phone?: string;
    merchantCustomerId?: string;
    ip?: string;
  };
  billing?: {
    street1?: string;
    city?: string;
    country?: string;
    postcode?: string;
  };
  threeDSecure?: {
    challengeIndicator?: string;
  };
  customParameters?: Record<string, string | number | boolean>;
};

export type CardcorpCreateCheckoutResult = {
  id: string;
  integrity?: string;
  result?: { code?: string; description?: string };
  raw: Prisma.InputJsonValue;
};

export type CardcorpPaymentStatusResult = {
  ok: boolean;
  code?: string;
  description?: string;
  paymentId?: string;
  amount?: string;
  currency?: string;
  raw: Prisma.InputJsonValue;
};

export type CardcorpRefundPaymentInput = {
  baseUrl: string;
  entityId: string;
  bearerToken: string;
  referencePaymentId: string;
  amount: string;
  currency: string;
  merchantTransactionId: string;
  testMode?: 'EXTERNAL' | 'INTERNAL';
};

function toFormUrlEncoded(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.append(k, String(v));
  }
  return sp.toString();
}

export async function cardcorpCreateCheckout(input: CardcorpCreateCheckoutInput): Promise<CardcorpCreateCheckoutResult> {
  const url = new URL('/v1/checkouts', input.baseUrl).toString();
  const payload: Record<string, string | number | boolean | undefined> = {
    entityId: input.entityId,
    amount: input.amount,
    currency: input.currency,
    paymentType: input.paymentType,
    integrity: input.integrity ? 'true' : undefined,
    merchantTransactionId: input.merchantTransactionId,
    shopperResultUrl: input.shopperResultUrl,
    testMode: input.testMode,
    'threeDSecure.challengeIndicator': input.threeDSecure?.challengeIndicator,
    ...(input.customer?.email ? { 'customer.email': input.customer.email } : {}),
    ...(input.customer?.givenName ? { 'customer.givenName': input.customer.givenName } : {}),
    ...(input.customer?.surname ? { 'customer.surname': input.customer.surname } : {}),
    ...(input.customer?.phone ? { 'customer.phone': input.customer.phone } : {}),
    ...(input.customer?.merchantCustomerId ? { 'customer.merchantCustomerId': input.customer.merchantCustomerId } : {}),
    ...(input.customer?.ip ? { 'customer.ip': input.customer.ip } : {}),
    ...(input.billing?.street1 ? { 'billing.street1': input.billing.street1 } : {}),
    ...(input.billing?.city ? { 'billing.city': input.billing.city } : {}),
    ...(input.billing?.country ? { 'billing.country': input.billing.country } : {}),
    ...(input.billing?.postcode ? { 'billing.postcode': input.billing.postcode } : {}),
  };
  if (input.customParameters) {
    for (const [k, v] of Object.entries(input.customParameters)) payload[`customParameters[${k}]`] = v;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Authorization: `Bearer ${input.bearerToken}`,
    },
    body: toFormUrlEncoded(payload),
  });
  const rawUnknown: unknown = await res.json().catch(() => ({}));
  const raw = asRecord(rawUnknown);
  const parsed = cardcorpResponseSchema.safeParse(raw);
  const response = parsed.success ? parsed.data : {};
  if (!res.ok) {
    const msg = response.result?.description || String(raw.error || '') || `HTTP ${res.status}`;
    throw new Error(`CardCorp create checkout failed: ${msg}`);
  }
  return {
    id: String(response.id || ''),
    integrity: response.integrity,
    result: response.result,
    raw: toInputJsonValue(raw),
  };
}

export async function cardcorpGetPaymentStatus(params: {
  baseUrl: string;
  entityId: string;
  bearerToken: string;
  checkoutId: string;
}): Promise<CardcorpPaymentStatusResult> {
  const url = new URL(`/v1/checkouts/${encodeURIComponent(params.checkoutId)}/payment`, params.baseUrl);
  url.searchParams.set('entityId', params.entityId);
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${params.bearerToken}` },
  });
  const rawUnknown: unknown = await res.json().catch(() => ({}));
  const raw = asRecord(rawUnknown);
  const parsed = cardcorpResponseSchema.safeParse(raw);
  const response = parsed.success ? parsed.data : {};
  if (!res.ok) {
    const msg = response.result?.description || String(raw.error || '') || `HTTP ${res.status}`;
    throw new Error(`CardCorp payment status failed: ${msg}`);
  }
  const code = String(response.result?.code || '');
  const ok = code.startsWith('000.');
  return {
    ok,
    code,
    description: response.result?.description,
    paymentId: response.id,
    amount: response.amount,
    currency: response.currency,
    raw: toInputJsonValue(raw),
  };
}

export async function cardcorpGetPaymentStatusByResourcePath(params: {
  baseUrl: string;
  entityId: string;
  bearerToken: string;
  resourcePath: string;
}): Promise<CardcorpPaymentStatusResult> {
  const rp = String(params.resourcePath || '').trim();
  if (!rp.startsWith('/v1/') || rp.includes('..') || rp.includes('\\')) {
    throw new Error('CardCorp payment status failed: invalid resourcePath');
  }
  const url = new URL(rp, params.baseUrl);
  url.searchParams.set('entityId', params.entityId);
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${params.bearerToken}` },
  });
  const rawUnknown: unknown = await res.json().catch(() => ({}));
  const raw = asRecord(rawUnknown);
  const parsed = cardcorpResponseSchema.safeParse(raw);
  const response = parsed.success ? parsed.data : {};
  if (!res.ok) {
    const msg = response.result?.description || String(raw.error || '') || `HTTP ${res.status}`;
    throw new Error(`CardCorp payment status failed: ${msg}`);
  }
  const code = String(response.result?.code || '');
  const ok = code.startsWith('000.');
  return {
    ok,
    code,
    description: response.result?.description,
    paymentId: response.id,
    amount: response.amount,
    currency: response.currency,
    raw: toInputJsonValue(raw),
  };
}

export async function cardcorpRefundPayment(input: CardcorpRefundPaymentInput): Promise<CardcorpPaymentStatusResult> {
  const ref = String(input.referencePaymentId || '').trim();
  if (!ref) throw new Error('CardCorp refund failed: missing referencePaymentId');
  const url = new URL(`/v1/payments/${encodeURIComponent(ref)}`, input.baseUrl).toString();
  const payload: Record<string, string | number | boolean | undefined> = {
    entityId: input.entityId,
    amount: input.amount,
    currency: input.currency,
    paymentType: 'RF',
    merchantTransactionId: input.merchantTransactionId,
    testMode: input.testMode,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Authorization: `Bearer ${input.bearerToken}`,
    },
    body: toFormUrlEncoded(payload),
  });
  const rawUnknown: unknown = await res.json().catch(() => ({}));
  const raw = asRecord(rawUnknown);
  const parsed = cardcorpResponseSchema.safeParse(raw);
  const response = parsed.success ? parsed.data : {};
  if (!res.ok) {
    const msg = response.result?.description || String(raw.error || '') || `HTTP ${res.status}`;
    throw new Error(`CardCorp refund failed: ${msg}`);
  }
  const code = String(response.result?.code || '');
  const ok = code.startsWith('000.');
  return {
    ok,
    code,
    description: response.result?.description,
    paymentId: response.id,
    amount: response.amount,
    currency: response.currency,
    raw: toInputJsonValue(raw),
  };
}

export function formatAmountEUR(amount: number): string {
  const n = Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
  return n.toFixed(2);
}

export function safeMerchantTxId(prefix: string): string {
  const rand = crypto.randomBytes(6).toString('hex');
  return `${prefix}-${Date.now()}-${rand}`.slice(0, 64);
}

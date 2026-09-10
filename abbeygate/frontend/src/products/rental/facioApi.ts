export type FacioField = {
  key: string;
  label: string;
  type: string;
  answerPath: string[];
  required?: boolean;
  readOnly?: boolean;
  help?: string;
  body?: string;
  options?: Array<string | { value: string; label: string }>;
  sourceCollection?: {
    key: string;
    itemLabel: string;
    minimumItems: number;
    maximumItems: number;
    fields: FacioField[];
  };
  exactTime?: { dateAnswerPath: string[]; timeZone?: string };
  requiredAtStages?: string[];
};
export type FacioCoverage = {
  coverage: string;
  label: string;
  description?: string;
  selectable: boolean;
  unavailableReason?: string;
  requires: string[];
  termsMode?: string;
  maxLimit?: number | null;
  minExcess?: number | null;
  benefitTerms?: unknown;
};
export type FacioIntake = {
  title: string;
  currency: string;
  initialQuoteData: Record<string, unknown>;
  questionnaire: { sections: Array<{ id: string; title: string; questions: FacioField[] }> };
  coverageAnswerPath: string[];
  coverageQuestionKey: string;
  coverageOptions: FacioCoverage[];
};
export type FacioQuote = {
  quoteId: string;
  receipt: string | null;
  status: string;
  bindable: boolean;
  premiumCalculated?: number;
  currency?: string;
  expiresAt?: string;
  quoteResponse: Record<string, unknown>;
};
export type FacioReview = {
  receipt: string;
  review: {
    premium: number;
    currency: string;
    offerId: string;
    quoteVersionId: string;
    paymentMode: 'SIMULATED';
  };
};
export type FacioPolicy = {
  policyId: string;
  status: string;
  policyNumber?: string | null;
  issuedAt?: string | null;
  riskTransactionId?: string | null;
  receipt: string;
  documentsStatus: string;
  documents: Array<{ id: string; filename: string; status: string }>;
};
export async function facioRequest<T>(
  path: '/api/quote' | '/api/bind',
  body?: unknown,
  key?: string,
): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const fields = payload?.error?.fieldErrors;
    const detail = Array.isArray(fields)
      ? fields
          .map(
            (field: { key?: string; message?: string }) =>
              `${field.key || ''}: ${field.message || ''}`,
          )
          .join('; ')
      : '';
    throw new Error(
      [
        payload?.error?.message ||
          'Facio did not confirm the request. Retry without changing the details.',
        detail,
      ]
        .filter(Boolean)
        .join(' '),
    );
  }
  return payload.data as T;
}
export function readAnswer(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>(
    (current, key) =>
      current &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      Object.prototype.hasOwnProperty.call(current, key) &&
      !['__proto__', 'prototype', 'constructor'].includes(key)
        ? (current as Record<string, unknown>)[key]
        : undefined,
    value,
  );
}
export function writeAnswer(
  value: Record<string, unknown>,
  path: string[],
  answer: unknown,
): Record<string, unknown> {
  if (
    !path.length ||
    path.some((part) => !part || ['__proto__', 'prototype', 'constructor'].includes(part))
  )
    throw new Error('Unsupported configured field path.');
  const [first, ...rest] = path;
  const child = value[first];
  return {
    ...value,
    [first]: rest.length
      ? writeAnswer(
          child && typeof child === 'object' && !Array.isArray(child)
            ? (child as Record<string, unknown>)
            : {},
          rest,
          answer,
        )
      : answer,
  };
}

export async function downloadFacioDocument(
  receipt: string,
  documentId: string,
  filename: string,
): Promise<void> {
  const response = await fetch('/api/bind', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `document-${documentId}` },
    body: JSON.stringify({ action: 'document', receipt, documentId }),
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf')) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || 'The issued document could not be downloaded.');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

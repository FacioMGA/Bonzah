import { useCallback, useEffect, useMemo, useRef, useState, type HTMLAttributes } from 'react';
import { operatingRequestHeaders } from '@/src/shared/lib/tenant/requestHeaders';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, Check, ShieldCheck, Sparkles } from 'lucide-react';
import { WizardButton as Button } from '@/src/shared/ui';
import {
  loadCardCorpWidgetScript,
  mountPaymentWidgetsForm,
  removeCardCorpWidgetScript,
} from '@/src/shared/lib/payments/cardCorpWidget';
import { CARDCORP_WIDGET_CSS, CARDCORP_WIDGET_SCOPE_CLASS } from '@/src/modules/billing/cardcorpStyles';
import { PaymentProcessingCard } from '../components/PaymentProcessingCard';
import {
  fetchIssueReadinessForProduct,
  invalidateIssueReadinessCache,
  type IssueReadinessBlocker,
  type IssueReadinessDerived,
  type IssueReadinessPayload,
} from '../issueReadinessClient.js';
import { stripWizardUrlSearchParams } from '../utils/replaceWizardUrl';

/**
 * Universal payment step reused by Home, Travel, and any future product.
 *
 * Mounts the CardCorp payment widget (PCI-compliant iframe fields for card
 * number + CVV, native inputs for card holder + expiry) and handles the
 * full lifecycle:
 *   - Creates a checkout via POST /api/public/payments/cardcorp/auto/:token/checkout
 *     (the `/auto/` URL is legacy; the backend resolves by publicSessionToken
 *     and is product-agnostic).
 *   - Mounts the payment widget form into a scoped container.
 *   - Verifies status on return from the gateway redirect.
 *   - Polls issue-readiness from the product's public session route
 *     (/api/public/<productCode>/session/:token/issue-readiness).
 *   - Surfaces a processing card during payment / document generation.
 *
 * The summary is generic: total due + optional breakdown lines + optional
 * `selectedOptionName` badge. Product wizards (Home, Travel, Motor) compute
 * `breakdownLines` from their own quote shape and pass them in. There is no
 * product-specific PaymentStep — see `docs/architecture/contracts/canonical-ownership.md`.
 */

/**
 * ABY-265 — `included: true` renders the line as "Included" instead
 * of an euro amount. Used when a cover IS part of the premium but
 * carries no separate charge (e.g. Motor Windscreen Cover, which is
 * embedded in the core Comprehensive premium per Peter's directive).
 * Without this flag a customer-facing "€0.00" row reads as a glitch;
 * a "Included" label is unambiguous and matches the wording the
 * client confirmed on ABY-265.
 */
type BreakdownLine = {
  label: string;
  amount: number;
  included?: boolean;
};

type QuoteSummary = {
  amount: number;
  currency: string;
  breakdownLines?: BreakdownLine[];
  /** Optional product-side label (e.g. Motor's selected coverage option). */
  selectedOptionName?: string;
};

export interface PaymentStepProps {
  productCode: string;                // 'home' | 'travel' | 'motor' | future
  publicSessionToken: string;         // == policyId path for customer flows
  summary: QuoteSummary;
  onBack: () => void;
  /** Fired after the full lifecycle resolves. `issued=true` means docs + email ready. */
  onSubmit: (result: {
    status: 'paid' | 'failed';
    issued?: boolean;
    blockers?: Array<{ code: string; message: string }>;
  }) => void | Promise<void>;
}

type CheckoutInfo = {
  checkoutId: string;
  integrity?: string;
  widgetScriptUrl: string;
  shopperResultUrl: string;
  amount: string;
  currency: string;
  brands: string;
};

type PaymentPhase =
  | 'idle'
  | 'preparing_checkout'
  | 'ready_to_pay'
  | 'processing_payment'
  | 'payment_confirmed'
  | 'generating_documents'
  | 'sending_email'
  | 'finalising'
  /**
   * Card was charged successfully but issue-readiness has not reported
   * `customerOutcome === 'issued'` within the polling window. The
   * customer's money is captured and the policy will issue once the
   * worker drains; we surface this distinct state (PR-1D) so the user
   * can choose to re-check or continue to their dashboard rather than
   * being silently auto-advanced past the payment step.
   */
  | 'pending_issuance'
  /**
   * ADR-0017 — terminal failed state: payment captured AND the
   * issued-pack worker recorded a permanent failure. Surfaces the
   * operator-contact recovery card; we MUST NOT silently advance the
   * wizard from here (the bug behind ABY-97/98).
   */
  | 'documents_failed'
  | 'error';

// Issue-readiness types + dedupe / TTL cache live in
// `../issueReadinessClient.ts` (canonical-ownership.md "Issue-readiness HTTP" row).
const paymentStatusInFlight = new Map<string, Promise<{ response: Response; json: unknown }>>();

function toBlockers(value: unknown): Array<{ code: string; message: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const blocker = item && typeof item === 'object' ? (item as IssueReadinessBlocker) : {};
    return {
      code: String(blocker.code || ''),
      message: String(blocker.message || ''),
    };
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Surface a friendly message for the structured "missing required fields"
// error that `cardcorpCheckoutService` returns when issue-readiness blockers
// stop a checkout from starting. Falls back to `error.message` otherwise.
export function formatCheckoutError(payload: unknown, fallback: string): string {
  const root = asRecord(payload);
  const error = asRecord(root.error);
  const details = asRecord(error.details);
  const blocker = asRecord(details.blocker);
  const blockerDetails = asRecord(blocker.details);
  const missingFields = Array.isArray(blockerDetails.missingForIssuedPack)
    ? blockerDetails.missingForIssuedPack
    : Array.isArray(blockerDetails.missingFields)
      ? blockerDetails.missingFields
      : [];
  if (missingFields.length > 0) {
    const first = asRecord(missingFields[0]);
    const label = String(first.label || first.slug || '').trim();
    const sectionKey = String(first.customerHash || '').trim().replace(/-/g, ' ');
    const section = sectionKey ? `${sectionKey.charAt(0).toUpperCase()}${sectionKey.slice(1)}` : '';
    if (label && section) return `Please complete ${label} in ${section} before proceeding to payment.`;
    if (label) return `Please complete ${label} before proceeding to payment.`;
  }
  return String(error.message || root.message || fallback);
}

function formatMoney(amount: number | undefined, currency: string): string {
  const value = Number(amount || 0);
  const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'USD' ? '$' : '';
  return `${symbol}${value.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function fetchPaymentStatusOnce(key: string, url: string): Promise<{ response: Response; json: unknown }> {
  const existing = paymentStatusInFlight.get(key);
  if (existing) return await existing;
  const req = (async () => {
    const response = await fetch(url, {headers:operatingRequestHeaders()});
    const json = await response.json().catch(() => null);
    return { response, json };
  })();
  paymentStatusInFlight.set(key, req);
  try {
    return await req;
  } finally {
    paymentStatusInFlight.delete(key);
  }
}

export function PaymentStep({
  productCode,
  publicSessionToken,
  summary,
  onBack,
  onSubmit,
}: PaymentStepProps) {
  const [checkout, setCheckout] = useState<CheckoutInfo | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issueMsg, setIssueMsg] = useState<string | null>(null);
  const initialHasGatewayParams = (() => {
    try {
      const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
      return sp.has('id') || sp.has('resourcePath') || sp.has('result');
    } catch { return false; }
  })();
  const [phase, setPhase] = useState<PaymentPhase>(initialHasGatewayParams ? 'processing_payment' : 'idle');
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [pendingBlockers, setPendingBlockers] = useState<Array<{ code: string; message: string }>>([]);
  const [recheckBusy, setRecheckBusy] = useState(false);

  const initRef = useRef(false);
  const statusCheckRef = useRef(false);
  const widgetMountRef = useRef<HTMLDivElement | null>(null);

  const checkoutLsKey = publicSessionToken ? `facio.cardcorp.checkout.${publicSessionToken}` : '';
  const hasGatewayParams = (() => {
    try {
      const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
      return sp.has('id') || sp.has('resourcePath') || sp.has('result');
    } catch { return false; }
  })();

  const effectivePhase: PaymentPhase =
    phase === 'idle'
      ? (hasGatewayParams ? 'processing_payment' : (processing ? 'preparing_checkout' : 'idle'))
      : phase;

  const showProcessingCard =
    hasGatewayParams ||
    effectivePhase === 'processing_payment' ||
    effectivePhase === 'payment_confirmed' ||
    effectivePhase === 'generating_documents' ||
    effectivePhase === 'sending_email' ||
    effectivePhase === 'finalising' ||
    effectivePhase === 'pending_issuance' ||
    // ADR-0017 — terminal failed surface MUST keep the processing card
    // visible (with the documents-failed treatment) instead of
    // collapsing to the bare payment form behind it. Without this the
    // user would see the card flash, the surface disappear, and the
    // payment widget reappear — exactly the ABY-98 "silently reverts
    // to payment stage" bug.
    effectivePhase === 'documents_failed' ||
    (effectivePhase === 'preparing_checkout' && !checkout) ||
    (effectivePhase === 'error' && hasGatewayParams);

  const processingMessage =
    issueMsg ||
    (effectivePhase === 'preparing_checkout' ? 'Setting up your secure checkout…'
      : effectivePhase === 'processing_payment' ? 'Processing payment. If 3-D Secure appears, that\'s just your bank being careful.'
        : effectivePhase === 'payment_confirmed' ? 'Payment confirmed. Preparing your policy.'
          : effectivePhase === 'generating_documents' ? 'Generating your policy documents.'
            : effectivePhase === 'sending_email' ? 'Sending your welcome email with all PDF attachments.'
              : effectivePhase === 'finalising' ? 'Final checks.'
                // ADR-0017 — explicit failed copy fallback so the panel
                // never reads "Generating your policy documents." when
                // we already know generation failed.
                : effectivePhase === 'documents_failed'
                  ? 'We could not generate your policy documents automatically. Our team has been notified.'
                  : null);

  const fetchIssueReadiness = useCallback(async (): Promise<IssueReadinessPayload | null> => {
    if (!publicSessionToken) return null;
    return await fetchIssueReadinessForProduct(productCode, publicSessionToken);
  }, [productCode, publicSessionToken]);

  const applyReadinessProgressUI = useCallback((readiness: IssueReadinessPayload | null) => {
    // ADR-0017 — terminal failed state takes precedence over the
    // progress-based copy. Without this short-circuit the UI would
    // claim "Generating and validating your full document pack" while
    // the backend already knows the worker permanently failed.
    if (readiness?.customerOutcome === 'failed') {
      setPhase('documents_failed');
      const blockers = toBlockers(readiness?.blockers || []);
      const failedBlocker = blockers.find((b) => b.code === 'DOCUMENTS_GENERATION_FAILED');
      setIssueMsg(
        failedBlocker?.message ||
          'We could not generate your policy documents automatically. Our team has been notified and will reach out shortly.',
      );
      return;
    }
    const derived = (readiness?.derived || {}) as IssueReadinessDerived;
    if (!derived.hasBoundInceptionTransaction) {
      setPhase('payment_confirmed');
      setIssueMsg('Payment confirmed — preparing your policy.');
      return;
    }
    if (!derived.hasIssuedPackDocuments) {
      setPhase('generating_documents');
      setIssueMsg('Generating and validating your full document pack.');
      return;
    }
    if (!derived.hasWelcomeEmailSent) {
      setPhase('sending_email');
      setIssueMsg('Sending your welcome email with all PDF attachments.');
      return;
    }
    setPhase('finalising');
    setIssueMsg('Everything is verified. Finalising your success screen.');
  }, []);

  const waitForIssuanceReadiness = useCallback(async (opts?: { timeoutMs?: number; pollMs?: number; shouldStop?: () => boolean }) => {
    const timeoutMs = Math.max(5000, Number(opts?.timeoutMs || 90000));
    const pollMs = Math.max(500, Number(opts?.pollMs || 1600));
    const startedAt = Date.now();
    let latest: IssueReadinessPayload | null = null;

    while (Date.now() - startedAt < timeoutMs) {
      if (opts?.shouldStop?.()) break;
      latest = await fetchIssueReadiness();
      if (opts?.shouldStop?.()) break;
      applyReadinessProgressUI(latest);
      if (latest?.customerOutcome === 'issued') {
        return { issued: true, blockers: toBlockers(latest?.blockers || []), outcome: 'issued' as const };
      }
      // ADR-0017 — `failed` is terminal; stop polling immediately and
      // return so the caller can surface the recovery UI instead of
      // burning the rest of the 90s budget pretending we're "still
      // generating documents".
      if (latest?.customerOutcome === 'failed') {
        return { issued: false, blockers: toBlockers(latest?.blockers || []), outcome: 'failed' as const };
      }
      await new Promise((resolve) => window.setTimeout(resolve, pollMs));
    }

    return {
      issued: false,
      blockers: toBlockers(latest?.blockers || []),
      outcome: 'pending' as const,
    };
  }, [applyReadinessProgressUI, fetchIssueReadiness]);

  const loadWidgetScript = useCallback((url: string, integrity?: string) => {
    loadCardCorpWidgetScript({
      widgetScriptUrl: url,
      integrity,
      onReady: () => {
        setPhase((p) => (p === 'preparing_checkout' || p === 'idle') ? 'ready_to_pay' : p);
      },
      onError: (err: unknown) => {
        const errName = err && typeof err === 'object' && 'name' in err ? String((err as { name?: unknown }).name || '') : '';
        const msg = err instanceof Error ? err.message
          : errName === 'InvalidCheckoutIdError'
            ? 'Your payment session expired. Please start again.'
            : 'Payment widget error. Please try again.';
        setError(String(msg));
      },
    });
  }, []);

  const handlePay = useCallback(async () => {
    setError(null);
    setIssueMsg(null);
    if (!publicSessionToken) {
      setError('Missing policy session. Please return to the quote and try again.');
      setPhase('error');
      return;
    }

    setPhase('preparing_checkout');
    setProcessing(true);
    try {
      if (widgetMountRef.current) {
        while (widgetMountRef.current.firstChild) {
          widgetMountRef.current.removeChild(widgetMountRef.current.firstChild);
        }
      }

      const res = await fetch(`/api/public/payments/cardcorp/auto/${encodeURIComponent(publicSessionToken)}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...operatingRequestHeaders() },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        const code = String(json?.error?.code || '');
        if (res.status === 409 && code === 'ALREADY_PAID') {
          setIssueMsg('This payment has already been completed — verifying issuance readiness…');
          const { issued, blockers, outcome } = await waitForIssuanceReadiness({ timeoutMs: 30000, pollMs: 1200 });
          // ADR-0017 — never silently advance with `issued:false`. If the
          // worker has terminally failed, render the recovery surface
          // here in-place; if we just timed out, drop into pending_issuance
          // so the user can re-check or continue. Both paths used to call
          // `onSubmit({issued:false})` which the controller treated as
          // "advance with variant: pending" and the user got bounced
          // back to the payment step with no message (ABY-98).
          if (issued) {
            onSubmit({ status: 'paid', issued: true, blockers });
          } else if (outcome === 'failed') {
            setPendingBlockers(blockers);
            setIssueMsg(
              blockers.find((b) => b.code === 'DOCUMENTS_GENERATION_FAILED')?.message ||
                'We could not generate your policy documents automatically. Our team has been notified.',
            );
            setPhase('documents_failed');
          } else {
            setPendingBlockers(blockers);
            setIssueMsg(
              blockers[0]?.message ||
                'Your card was charged successfully. Documents and your welcome email are still being prepared.',
            );
            setPhase('pending_issuance');
          }
          return;
        }
        throw new Error(formatCheckoutError(json, 'Failed to start payment'));
      }

      const info: CheckoutInfo = json.data;
      setCheckout(info);
      try { localStorage.setItem(checkoutLsKey, info.checkoutId); } catch { /* ignore */ }
    } catch (e) {
      setError((e as Error)?.message || 'Payment could not be started.');
      setPhase('error');
    } finally {
      setProcessing(false);
    }
  }, [checkoutLsKey, onSubmit, publicSessionToken, waitForIssuanceReadiness]);

  // Mount the payment widget form and load the script when we have a checkout.
  useEffect(() => {
    if (!checkout) return;
    if (hasGatewayParams) return;

    const mount = widgetMountRef.current;
    if (!mount) return;

    mountPaymentWidgetsForm({
      mount,
      action: checkout.shopperResultUrl,
      brands: checkout.brands,
    });

    const schedule = (cb: () => void) => {
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => cb());
      } else {
        window.setTimeout(() => cb(), 0);
      }
    };
    schedule(() => loadWidgetScript(checkout.widgetScriptUrl, checkout.integrity));
  }, [checkout, hasGatewayParams, loadWidgetScript]);

  // Create a checkout as soon as the user lands on the payment step.
  useEffect(() => {
    if (!publicSessionToken) return;
    if (checkout) return;
    const sp = new URLSearchParams(window.location.search);
    const hasGatewayParamsLocal = sp.has('id') || sp.has('resourcePath') || sp.has('result');
    if (hasGatewayParamsLocal) return;

    if (initRef.current) return;
    initRef.current = true;

    (async () => {
      try {
        const readiness = await fetchIssueReadiness();
        if (readiness?.derived?.hasPaymentConfirmed) {
          const { issued, blockers, outcome } = await waitForIssuanceReadiness({ timeoutMs: 30000, pollMs: 1200 });
          // ADR-0017 — same fix as the ALREADY_PAID branch and the
          // gateway-return path: never silently advance with
          // `issued:false`. The previous code unconditionally called
          // `onSubmit({issued:false})` which produced ABY-98 (wizard
          // re-renders the payment step with no error message after a
          // failed issuance). Surface the explicit pending/failed
          // recovery card instead.
          if (issued) {
            onSubmit({ status: 'paid', issued: true, blockers });
            return;
          }
          if (outcome === 'failed') {
            setPendingBlockers(blockers);
            setIssueMsg(
              blockers.find((b) => b.code === 'DOCUMENTS_GENERATION_FAILED')?.message ||
                'We could not generate your policy documents automatically. Our team has been notified.',
            );
            setPhase('documents_failed');
            return;
          }
          setPendingBlockers(blockers);
          setIssueMsg(
            blockers[0]?.message ||
              'Your card was charged successfully. Documents and your welcome email are still being prepared.',
          );
          setPhase('pending_issuance');
          return;
        }
      } catch { /* ignore: fall through to checkout creation */ }
      void handlePay();
    })();
    return () => {
      removeCardCorpWidgetScript();
    };
  }, [checkout, fetchIssueReadiness, handlePay, onSubmit, publicSessionToken, waitForIssuanceReadiness]);

  // After redirect back from CardCorp, verify status server-side.
  useEffect(() => {
    if (!publicSessionToken) return;
    const sp = new URLSearchParams(window.location.search);
    const hasGatewayParamsLocal = sp.has('id') || sp.has('resourcePath') || sp.has('result');
    if (!hasGatewayParamsLocal) return;

    if (statusCheckRef.current) return;
    statusCheckRef.current = true;

    const stripGatewayParams = () => {
      stripWizardUrlSearchParams(['id', 'resourcePath', 'result']);
    };

    const urlCheckoutId = String(sp.get('id') || '').trim();
    const resourcePath = String(sp.get('resourcePath') || '').trim();
    const savedCheckoutId = (() => {
      try { return localStorage.getItem(checkoutLsKey) || ''; } catch { return ''; }
    })();
    const checkoutIdToVerify = resourcePath ? '' : (urlCheckoutId || savedCheckoutId);
    if (!resourcePath && !checkoutIdToVerify) return;

    let cancelled = false;
    let shouldResetProcessing = true;
    const maxAutoRetries = 3;
    const autoRetryDelayMs = (attempt: number) => Math.min(2500, 600 + attempt * 600);

    (async () => {
      try {
        setProcessing(true);
        setPhase('processing_payment');
        setError(null);
        const qs = resourcePath
          ? `resourcePath=${encodeURIComponent(resourcePath)}`
          : `checkoutId=${encodeURIComponent(checkoutIdToVerify)}`;
        const statusKey = `${publicSessionToken}|${qs}`;
        const { response: resp, json } = await fetchPaymentStatusOnce(
          statusKey,
          `/api/public/payments/cardcorp/auto/${encodeURIComponent(publicSessionToken)}/status?${qs}`,
        );
        const jsonObj = asRecord(json);
        const errorObj = asRecord(jsonObj.error);
        const dataObj = asRecord(jsonObj.data);
        if (!resp.ok || !Boolean(jsonObj.success)) {
          const code = String(errorObj.code || '');
          const msg = String(errorObj.message || '');
          const isNoSession = code === 'PAYMENT_NOT_VERIFIED' &&
            (msg.includes('No payment session found') || msg.includes('200.300.404'));
          if (isNoSession && statusAttempt < maxAutoRetries) {
            setIssueMsg('Finalising payment — this can take a moment…');
            setPhase('processing_payment');
            shouldResetProcessing = false;
            const delay = autoRetryDelayMs(statusAttempt);
            window.setTimeout(() => {
              if (!cancelled) {
                statusCheckRef.current = false;
                setStatusAttempt((n) => n + 1);
              }
            }, delay);
            return;
          }
          throw new Error(msg || 'Failed to verify payment');
        }
        if (cancelled) return;

        const ok = Boolean(dataObj.ok);
        try { localStorage.removeItem(checkoutLsKey); } catch { /* ignore */ }

        if (!ok) {
          setPhase('error');
          const code = String(dataObj.code || '');
          const desc = String(dataObj.description || '');
          setError(`Payment could not be verified (${code}). ${desc || 'Please try again.'}`);
          stripGatewayParams();
          onSubmit({ status: 'failed' });
          return;
        }

        setPhase('payment_confirmed');
        stripGatewayParams();

        try {
          const { issued, blockers, outcome } = await waitForIssuanceReadiness({
            timeoutMs: 90000, pollMs: 1600, shouldStop: () => cancelled,
          });
          if (issued) {
            setPhase('finalising');
            await new Promise((r) => window.setTimeout(r, 450));
            onSubmit({ status: 'paid', issued, blockers });
            return;
          }
          if (cancelled) return;
          // ADR-0017 — terminal failed: render the operator-contact
          // recovery card and STOP. Previously `failed` was
          // indistinguishable from `pending` and the user saw the
          // amber "still being prepared" surface forever.
          if (outcome === 'failed') {
            setPendingBlockers(blockers);
            setIssueMsg(
              blockers.find((b) => b.code === 'DOCUMENTS_GENERATION_FAILED')?.message ||
                'We could not generate your policy documents automatically. Our team has been notified and will reach out shortly.',
            );
            setPhase('documents_failed');
            return;
          }
          // PR-1D — payment captured but issuance has not completed
          // within the polling window. Surface a distinct, explicit
          // pending state so the customer can choose to re-check or
          // continue, instead of being silently auto-advanced past
          // the payment step (which is what made ABY-27/28/33/34
          // look like "documents never arrived").
          setPendingBlockers(blockers);
          setIssueMsg(
            blockers[0]?.message ||
              'Your card was charged successfully. Documents and your welcome email are still being prepared.',
          );
          setPhase('pending_issuance');
        } catch {
          if (cancelled) return;
          setPendingBlockers([]);
          setIssueMsg('Your card was charged successfully. We could not confirm document issuance in time.');
          setPhase('pending_issuance');
        }
      } catch (e) {
        if (!cancelled) {
          const rawMsg = (e as Error)?.message || 'Payment verification failed.';
          setError(rawMsg);
          setPhase('error');
        }
      } finally {
        if (!cancelled && shouldResetProcessing) setProcessing(false);
      }
    })();

    return () => {
      cancelled = true;
      statusCheckRef.current = false;
    };
  }, [checkoutLsKey, onSubmit, publicSessionToken, statusAttempt, waitForIssuanceReadiness]);

  // PR-1D — manual re-check from the pending-issuance UI. Bypasses
  // the 1.2 s recent-readiness cache by clearing it for this token,
  // so a customer who clicks "Re-check now" actually re-hits the
  // server. Re-applies the same UI transitions as the polling loop.
  const handleRecheckReadiness = useCallback(async () => {
    if (!publicSessionToken) return;
    setRecheckBusy(true);
    try {
      // Bypass the in-flight TTL cache: the recheck button is the
      // user's explicit "I want to know NOW" gesture.
      invalidateIssueReadinessCache(productCode, publicSessionToken);
      const latest = await fetchIssueReadinessForProduct(productCode, publicSessionToken);
      if (latest?.customerOutcome === 'issued') {
        setPendingBlockers([]);
        setPhase('finalising');
        await new Promise((r) => window.setTimeout(r, 350));
        onSubmit({ status: 'paid', issued: true, blockers: [] });
        return;
      }
      const blockers = toBlockers(latest?.blockers || []);
      setPendingBlockers(blockers);
      // ADR-0017 — re-check could discover the terminal failed state
      // (e.g. between the customer's previous look and now, BullMQ
      // exhausted retries and the worker recorded
      // ISSUED_PACK_GENERATION_FAILED). Promote the UI accordingly so
      // we don't keep telling them "still preparing" forever.
      if (latest?.customerOutcome === 'failed') {
        setIssueMsg(
          blockers.find((b) => b.code === 'DOCUMENTS_GENERATION_FAILED')?.message ||
            'We could not generate your policy documents automatically. Our team has been notified.',
        );
        setPhase('documents_failed');
        return;
      }
      setIssueMsg(
        blockers[0]?.message ||
          'Still preparing your documents. This usually finishes within a few minutes.',
      );
      applyReadinessProgressUI(latest);
      setPhase('pending_issuance');
    } finally {
      setRecheckBusy(false);
    }
  }, [applyReadinessProgressUI, onSubmit, productCode, publicSessionToken]);

  const handleContinueToDashboard = useCallback(() => {
    onSubmit({ status: 'paid', issued: false, blockers: pendingBlockers });
  }, [onSubmit, pendingBlockers]);

  const breakdownLines = useMemo(() => summary.breakdownLines || [], [summary.breakdownLines]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="max-w-4xl mx-auto"
    >
      <div className="flex items-center gap-4 mb-8">
        <Button
          type="button"
          onClick={onBack}
          disabled={processing || showProcessingCard}
          variant="secondary"
          className={[
            'group p-2 -ml-2 rounded-full transition-all',
            (processing || showProcessingCard) ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-100',
          ].join(' ')}
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Button>
        <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Confirm & Pay</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Payment card */}
        <div className="lg:col-span-7">
          <div className="relative">
            <div className="relative z-10">
              <style>{CARDCORP_WIDGET_CSS}</style>

              {showProcessingCard && (
                <PaymentProcessingCard
                  phase={effectivePhase === 'idle' ? 'preparing_checkout' : effectivePhase}
                  message={processingMessage}
                  error={effectivePhase === 'error' ? error : null}
                  onRetry={
                    effectivePhase === 'error' && hasGatewayParams
                      ? () => {
                        setError(null);
                        setIssueMsg(null);
                        statusCheckRef.current = false;
                        setStatusAttempt((n) => n + 1);
                      }
                      : null
                  }
                  onStartOver={
                    effectivePhase === 'error'
                      ? () => {
                        stripWizardUrlSearchParams(['id', 'resourcePath', 'result']);
                        setError(null);
                        setIssueMsg(null);
                        setPhase('preparing_checkout');
                        void handlePay();
                      }
                      : null
                  }
                  onRecheckReadiness={effectivePhase === 'pending_issuance' ? handleRecheckReadiness : null}
                  onContinueToDashboard={
                    effectivePhase === 'pending_issuance' || effectivePhase === 'documents_failed'
                      ? handleContinueToDashboard
                      : null
                  }
                  readinessBlockers={
                    effectivePhase === 'pending_issuance' || effectivePhase === 'documents_failed'
                      ? pendingBlockers
                      : undefined
                  }
                  recheckBusy={recheckBusy}
                  supportContactHref={effectivePhase === 'documents_failed' ? 'mailto:support@facio.io' : undefined}
                />
              )}

              {!showProcessingCard && error && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-5 mb-6 flex gap-4 items-start">
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-red-900">Payment Error</h4>
                    <p className="text-sm text-red-700 mt-1">{error}</p>
                    <Button
                      type="button"
                      onClick={() => {
                        stripWizardUrlSearchParams(['id', 'resourcePath', 'result']);
                        setError(null);
                        void handlePay();
                      }}
                      variant="secondary"
                      className="text-xs font-semibold text-red-800 underline mt-2 hover:text-red-900"
                    >
                      Start New Payment
                    </Button>
                  </div>
                </div>
              )}

              {!error && issueMsg && !showProcessingCard && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 mb-6">
                  <p className="text-sm text-blue-900 font-medium flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    {issueMsg}
                  </p>
                </div>
              )}

              {checkout && !hasGatewayParams && (() => {
                // ABY-409 / ABBEYGATE-REACT-2 — block interaction until the
                // CardCorp `wpwl` widget reports `onReady` (phase →
                // `ready_to_pay`). The widget's submit handler binds before
                // its CVV iframe completes registration; Sentry caught
                // `iframeCommunications['cvv_'+t].validateInput` TypeErrors
                // when users pressed Enter / autofilled early.
                // `pointer-events:none` alone does not block keyboard focus
                // or Enter-to-submit; `inert` closes that gap, and
                // `cardCorpWidget` sets OPPWA `disableSubmitOnEnter`.
                // Per the contract this stays in canonical `PaymentStep`.
                const widgetReady = effectivePhase === 'ready_to_pay';
                const mountLock: (HTMLAttributes<HTMLDivElement> & { inert?: boolean }) | undefined =
                  widgetReady
                    ? undefined
                    : {
                        inert: true,
                        'aria-busy': true,
                        style: { pointerEvents: 'none', opacity: 0.6 },
                      };
                return (
                  <div
                    ref={widgetMountRef}
                    className={CARDCORP_WIDGET_SCOPE_CLASS}
                    data-widget-ready={widgetReady ? '1' : '0'}
                    data-testid="cardcorp-widget-mount"
                    {...mountLock}
                  />
                );
              })()}

              <div className="mt-3 pt-3 border-t border-gray-100 flex flex-col items-center gap-2">
                <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  <span>Secured by CardCorp Secure Payments · PCI-DSS Level 1 Compliant</span>
                </div>
              </div>

              {!showProcessingCard && (error || !checkout) && (
                <div className="mt-6">
                  <Button
                    variant="primary"
                    onClick={handlePay}
                    disabled={processing}
                    className="w-full !rounded-xl !h-12 shadow-lg shadow-blue-900/10"
                  >
                    {processing ? 'Connecting…' : checkout ? 'Retry Load' : 'Load Secure Checkout'}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Summary sidebar */}
        <div className="lg:col-span-5 lg:sticky lg:top-8 space-y-6">
          <div className="bg-white border border-gray-100 rounded-3xl p-7 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
            <h3 className="text-lg font-semibold text-gray-900 mb-5">Order Summary</h3>
            {summary.selectedOptionName ? (
              <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-900">
                Selected option: {summary.selectedOptionName}
              </div>
            ) : null}
            <div className="space-y-2 mb-6">
              {breakdownLines.map((row, i) => (
                <div key={`${row.label}-${i}`} className="flex items-center justify-between text-sm py-1">
                  <span className="text-gray-500 flex items-center gap-1.5">
                    {row.label}
                    {(row.included || row.amount > 0) && <Check className="w-3 h-3 text-emerald-500" />}
                  </span>
                  <span className="text-gray-900 font-medium">
                    {row.included
                      ? <span className="text-emerald-700 text-xs font-bold uppercase tracking-wider">Included</span>
                      : formatMoney(row.amount, summary.currency)}
                  </span>
                </div>
              ))}
            </div>
            <div className="h-px bg-gray-100 w-full mb-6" />
            <div className="flex flex-col items-end gap-1 mb-2">
              <span className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">Total Due Now</span>
              <span className="text-4xl font-bold text-[#004a8a] tracking-tight">
                {formatMoney(summary.amount, summary.currency)}
              </span>
            </div>
            <div className="text-right text-xs text-gray-400">Includes all fees &amp; taxes</div>
          </div>

          <div className="bg-gray-50 border border-gray-100 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <Sparkles className="w-4 h-4 text-[#004a8a]" />
              <p className="text-sm font-bold text-gray-900">What happens next?</p>
            </div>
            <ul className="space-y-2.5">
              {[
                'We issue your documents immediately after payment.',
                'If additional review is needed, our team contacts you within 2 business hours.',
                'No charge if we can\'t offer cover.',
              ].map((t) => (
                <li key={t} className="flex items-start gap-3 text-sm text-gray-600">
                  <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <span className="leading-snug">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

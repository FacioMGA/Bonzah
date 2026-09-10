import { useState, useEffect, useRef, useCallback } from 'react';
import { billingApiClient as api } from '@/src/modules/billing/api/billingApiClient';

import { logger } from '@/src/shared/lib/logger';
import { asRecord, type UnknownRecord } from '@/src/shared/lib/record';
import { replaceWizardUrlIfChanged } from '@/src/shared/lib/wizard/utils/replaceWizardUrl';

type BillingCheckout = UnknownRecord & {
  widgetScriptUrl?: string;
  integrity?: string;
  brands?: string;
  shopperResultUrl?: string;
  paymentId?: string;
  checkoutId?: string;
  amount?: number | string;
};

interface UsePolicyBillingParams {
  selectedPortfolio: { id?: string } | null;
  activeTab: string;
  onToast: (message: string) => void;
}

export function usePolicyBilling({
  selectedPortfolio,
  activeTab,
  onToast,
}: UsePolicyBillingParams) {
  // Billing v2 (BO) state
  const [billingSummary, setBillingSummary] = useState<UnknownRecord | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [showChargeModal, setShowChargeModal] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [chargeAction, setChargeAction] = useState<'send_customer' | 'charge_bo'>('charge_bo');
  const [chargeAmount, setChargeAmount] = useState<string>('');
  const [refundAmount, setRefundAmount] = useState<string>('');
  const [applyToBalance, setApplyToBalance] = useState(true);
  const [billingCheckout, setBillingCheckout] = useState<BillingCheckout | null>(null);
  const [billingWidgetReady, setBillingWidgetReady] = useState(false);
  const [billingIsVerifyingGateway, setBillingIsVerifyingGateway] = useState(false);
  const [billingRefundReferenceId, setBillingRefundReferenceId] = useState<string>('');
  const billingWidgetMountRef = useRef<HTMLDivElement | null>(null);
  const cardcorpLastWidgetScriptUrlRef = useRef<string>('');
  const boBillingVerifyKeyRef = useRef<string>('');
  const boBillingVerifyAttemptsRef = useRef<number>(0);
  const [chargePhase, setBoChargePhase] = useState<'idle' | 'widget' | 'submitting' | 'verifying' | 'done' | 'error'>('idle');
  const [chargeError, setBoChargeError] = useState<string>('');
  const [chargeIntent, setBoChargeIntent] = useState<{ policyId: string; paymentId?: string; checkoutId?: string; amount?: number; createdAt: number; submittedAt?: number } | null>(null);

  const boChargeBlocking = chargePhase === 'submitting' || chargePhase === 'verifying';

  const CHARGE_INTENT_KEY = 'facio:bo:cardcorp:lastCharge';

  const writeBoChargeIntent = (next: { policyId: string; paymentId?: string; checkoutId?: string; amount?: number; createdAt: number; submittedAt?: number } | null) => {
    try {
      sessionStorage.setItem(CHARGE_INTENT_KEY, JSON.stringify(next || null));
    } catch {
      // ignore
    }
  };

  const readBoChargeIntent = (): { policyId: string; paymentId?: string; checkoutId?: string; amount?: number; createdAt: number; submittedAt?: number } | null => {
    try {
      const raw = sessionStorage.getItem(CHARGE_INTENT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  };

  const verifyPaymentWithRetry = async (args: { policyId: string; checkoutId?: string; resourcePath?: string }) => {
    const maxAttempts = 6;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const resp = await api.verifyBoCardcorpPayment(String(args.policyId), {
        checkoutId: args.checkoutId || undefined,
        resourcePath: args.resourcePath || undefined,
      });
      if (!resp?.success) throw new Error(resp?.error?.message || 'Payment verification failed');
      const data = resp?.data as { pending?: boolean; ok?: boolean; description?: string } | undefined;
      if (data?.pending) {
        // transient; wait and retry
        const delay = Math.min(3200, 600 + attempt * 450);
        await new Promise((r) => window.setTimeout(r, delay));
        continue;
      }
      return resp;
    }
    const pendingData: { pending?: boolean; ok?: boolean; description?: string } = { pending: true };
    return { success: true, data: pendingData };
  };

  const loadBillingSummary = useCallback(async () => {
    if (!selectedPortfolio?.id) return;
    try {
      setBillingLoading(true);
      // Billing tab defaults to policy-account view (lifetime ledger),
      // not the currently selected endorsement/version snapshot.
      const resp = await api.getBillingSummary(String(selectedPortfolio.id));
      if (!resp?.success) throw new Error(resp?.error?.message || 'Failed to load billing');
      setBillingSummary(resp?.data ? asRecord(resp.data) : null);
    } catch {
      setBillingSummary(null);
    } finally {
      setBillingLoading(false);
    }
  }, [selectedPortfolio?.id]);

  const openBillingCharge = (balance: number) => {
    setChargeAction('charge_bo');
    setChargeAmount(Math.max(0, Number(balance || 0)).toFixed(2));
    setBillingCheckout(null);
    setBillingWidgetReady(false);
    setBoChargePhase('idle');
    setBoChargeError('');
    setBoChargeIntent(null);
    writeBoChargeIntent(null);
    setShowChargeModal(true);
  };

  const openBillingRefund = (balance: number, lastChargeId: string) => {
    setRefundAmount(Math.abs(Math.min(Number(balance || 0), 0)).toFixed(2));
    setBillingRefundReferenceId(String(lastChargeId || ''));
    setShowRefundModal(true);
  };

  // Load billing data when the billing tab opens or version changes.
  useEffect(() => {
    if (activeTab !== 'Billing') return;
    if (!selectedPortfolio?.id) return;
    loadBillingSummary();
  }, [activeTab, selectedPortfolio?.id, loadBillingSummary]);

  // Billing gateway return: verify CardCorp result (BO) when redirected back with params.
  useEffect(() => {
    if (activeTab !== 'Billing') return;
    if (!selectedPortfolio?.id) return;
    try {
      // CardCorp can return params in the querystring, but if the shopperResultUrl contained a hash,
      // it may append them into the fragment (e.g. `#billing?id=...&resourcePath=...`).
      // Support BOTH shapes.
      const sp = new URLSearchParams(window.location.search || '');
      let resourcePath = sp.get('resourcePath') || '';
      let checkoutId = sp.get('id') || '';

      if (!resourcePath && !checkoutId) {
        const hash = String(window.location.hash || '');
        const qIdx = hash.indexOf('?');
        if (qIdx >= 0) {
          const hashQs = hash.slice(qIdx + 1);
          const hp = new URLSearchParams(hashQs);
          resourcePath = hp.get('resourcePath') || '';
          checkoutId = hp.get('id') || '';
        }
      }

      const hasGatewayParams = Boolean(resourcePath) || Boolean(checkoutId);
      if (!hasGatewayParams) return;

      const verifyKey = `${String(selectedPortfolio.id)}|${checkoutId}|${resourcePath}`;
      if (boBillingVerifyKeyRef.current === verifyKey) return;
      boBillingVerifyKeyRef.current = verifyKey;
      boBillingVerifyAttemptsRef.current = 0;

      // Debounce/guard
      if (billingIsVerifyingGateway) return;
      setBillingIsVerifyingGateway(true);

      // IMPORTANT UX:
      // The widget submit triggers a full page redirect (state resets), so on return we re-open
      // the Charge modal and visibly complete the handshake.
      setShowChargeModal(true);
      setBoChargePhase('verifying');
      setBoChargeError('');
      setBillingCheckout(null);
      setBillingWidgetReady(false);
      try {
        const stored = readBoChargeIntent();
        if (stored && String(stored.policyId || '') === String(selectedPortfolio.id)) {
          if (!checkoutId || String(stored.checkoutId || '') === String(checkoutId)) setBoChargeIntent(stored);
        }
      } catch {
        // ignore
      }

      let cancelled = false;
      const run = async () => {
        try {
          const verifyResp = await verifyPaymentWithRetry({
            policyId: String(selectedPortfolio.id),
            resourcePath: resourcePath || undefined,
            checkoutId: checkoutId || undefined,
          });
          await loadBillingSummary();

          const vData = verifyResp?.data as { ok?: boolean; pending?: boolean; description?: string } | undefined;
          if (vData?.ok) {
            setBoChargePhase('done');
            onToast('Payment verified');
            window.setTimeout(() => {
              if (cancelled) return;
              setShowChargeModal(false);
              setBoChargePhase('idle');
              setBoChargeError('');
              setBoChargeIntent(null);
              writeBoChargeIntent(null);
            }, 900);
          } else if (vData?.pending) {
            setBoChargePhase('verifying');
          } else {
            setBoChargePhase('error');
            setBoChargeError(String(vData?.description || 'Payment failed'));
          }
        } catch {
          setBoChargePhase('error');
          setBoChargeError('Payment verification failed. Please retry the charge.');
        } finally {
          // Clean URL (remove gateway params)
          try {
            replaceWizardUrlIfChanged((url) => {
              url.searchParams.delete('resourcePath');
              url.searchParams.delete('id');
              url.searchParams.delete('result');
              const cleanHash = String(url.hash || '').split('?')[0] || url.hash;
              url.hash = cleanHash;
            }, { state: {} });
          } catch { }
          setBillingIsVerifyingGateway(false);
        }
      };

      void run();

      return () => {
        cancelled = true;
      };
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedPortfolio?.id]);

  // Mount CardCorp widget inside BO Charge modal when checkout is created.
  useEffect(() => {
    if (!showChargeModal) return;
    if (!billingCheckout?.widgetScriptUrl) return;
    setBillingWidgetReady(false);

    // COPYandPAY widget integration:
    // - The <form class="paymentWidgets"> is rendered via React in the modal content (see below).
    // - Here we only load the external widget script, idempotently, to avoid StrictMode/HMR crashes.
    const cardcorpWindow = window as Window & {
      wpwlOptions?: Record<string, unknown>;
    };
    cardcorpWindow.wpwlOptions = {
      // Use COPYandPAY "plain" as base and apply our scoped .cardcorp-widget CSS as the skin.
      // "none" is not a documented style value in CardCorp customization docs.
      style: 'plain',
      onBeforeSubmit: () => {
        // User clicked Pay inside the widget
        setBoChargeError('');
        setBoChargePhase('submitting');
        try {
          if (selectedPortfolio?.id) {
            const next = {
              policyId: String(selectedPortfolio.id),
              paymentId: String(billingCheckout?.paymentId || ''),
              checkoutId: String(billingCheckout?.checkoutId || ''),
              amount: Number(billingCheckout?.amount || 0) || undefined,
              createdAt: Date.now(),
              submittedAt: Date.now(),
            };
            setBoChargeIntent(next);
            writeBoChargeIntent(next);
          }
        } catch {
          // ignore
        }
        return true;
      },
      onAfterSubmit: () => {
        // Widget submit typically triggers a full-page redirect (3DS / shopperResultUrl).
        // We complete the verification handshake on return (see Billing gateway return effect).
        setBoChargePhase('verifying');
      },
      iframeStyle: {
        'card-number-placeholder': {
          color: 'rgba(0, 0, 0, 0)',
          'font-size': '14px',
          'font-family': 'Arial, Helvetica, sans-serif',
          'font-weight': '500',
          'letter-spacing': '0.14px',
          'text-transform': 'uppercase',
        },
        'cvv-placeholder': {
          color: 'rgba(0, 0, 0, 0)',
          'font-size': '14px',
          'font-family': 'Arial, Helvetica, sans-serif',
          'font-weight': '500',
          'letter-spacing': '0.14px',
          'text-transform': 'uppercase',
        },
      },
      iframeStyles: {
        'card-number-placeholder': {
          color: 'rgba(0, 0, 0, 0)',
          'font-size': '14px',
          'font-family': 'Arial, Helvetica, sans-serif',
          'font-weight': '500',
          'letter-spacing': '0.14px',
          'text-transform': 'uppercase',
        },
        'cvv-placeholder': {
          color: 'rgba(0, 0, 0, 0)',
          'font-size': '14px',
          'font-family': 'Arial, Helvetica, sans-serif',
          'font-weight': '500',
          'letter-spacing': '0.14px',
          'text-transform': 'uppercase',
        },
      },
      onReady: () => {
        setBillingWidgetReady(true);
        setBoChargePhase('widget');

        // Brand badge: hide until a real brand is detected (prevents showing VISA too early).
        try {
          const brand = document.querySelector('.wpwl-brand-card') as HTMLElement | null;
          if (brand) {
            brand.removeAttribute('data-brand-card-visible');
            for (const cls of Array.from(brand.classList)) {
              if (cls.startsWith('wpwl-brand-') && cls !== 'wpwl-brand' && cls !== 'wpwl-brand-card') {
                brand.classList.remove(cls);
              }
            }
            const isRecognized = () =>
              Array.from(brand.classList).some(
                (c) => c.startsWith('wpwl-brand-') && c !== 'wpwl-brand' && c !== 'wpwl-brand-card',
              );
            const reveal = () => {
              if (brand.getAttribute('data-brand-card-visible') === '1') return;
              brand.setAttribute('data-brand-card-visible', '1');
            };
            const obs = new MutationObserver(() => {
              if (isRecognized()) {
                reveal();
                obs.disconnect();
              }
            });
            obs.observe(brand, { attributes: true, attributeFilter: ['class'] });
            const startedAt = Date.now();
            const timer = window.setInterval(() => {
              if (isRecognized()) {
                window.clearInterval(timer);
                reveal();
                return;
              }
              if (Date.now() - startedAt > 8000) window.clearInterval(timer);
            }, 250);
          }
        } catch {
          // ignore
        }

        // Mirror focus styles for cross-origin iframe fields (card number + cvv).
        try {
          const wireIframeFocus = (groupSelector: string) => {
            const group = document.querySelector(groupSelector) as HTMLElement | null;
            if (!group) return;
            const iframe = group.querySelector('iframe') as HTMLIFrameElement | null;
            if (!iframe) return;
            const set = (on: boolean) => group.classList.toggle('brand-iframe-focused', on);
            iframe.addEventListener('focus', () => set(true), true);
            iframe.addEventListener('blur', () => set(false), true);
          };
          wireIframeFocus('.wpwl-group-cardNumber');
          wireIframeFocus('.wpwl-group-cvv');
        } catch {
          // ignore
        }

        // Enforce exact placeholder copy for native fields.
        try {
          const cardHolderInput = document.querySelector('.wpwl-group-cardHolder input.wpwl-control') as HTMLInputElement | null;
          if (cardHolderInput) cardHolderInput.setAttribute('placeholder', '');
          const expiryInput = document.querySelector('.wpwl-group-expiry input.wpwl-control') as HTMLInputElement | null;
          if (expiryInput) expiryInput.setAttribute('placeholder', '');
        } catch {
          // ignore
        }
      },
      onError: (err: unknown) => {
        const errRecord = (err && typeof err === 'object') ? (err as Record<string, unknown>) : {};
        try {
          logger.error('[BO CardCorp Widget] onError', err);
        } catch {
          // ignore
        }
        onToast(String(errRecord.message || 'Payment widget error. Please try again.'));
        setBillingWidgetReady(false);
        setBoChargePhase('error');
        setBoChargeError(String(errRecord.message || 'Payment widget error. Please try again.'));
      },
    };

    const url = String(billingCheckout.widgetScriptUrl);
    const alreadyLoaded = cardcorpLastWidgetScriptUrlRef.current === url && Boolean(document.getElementById('bo-cardcorp-widgets'));
    if (alreadyLoaded) return;

    cardcorpLastWidgetScriptUrlRef.current = url;

    const schedule = (cb: () => void) => {
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => cb());
      } else {
        window.setTimeout(() => cb(), 0);
      }
    };

    schedule(() => {
      const existing = document.getElementById('bo-cardcorp-widgets');
      if (existing) existing.remove();

      const s = document.createElement('script');
      s.id = 'bo-cardcorp-widgets';
      s.src = url;
      if (billingCheckout.integrity) s.integrity = String(billingCheckout.integrity);
      s.crossOrigin = 'anonymous';
      document.body.appendChild(s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showChargeModal,
    billingCheckout?.widgetScriptUrl,
    billingCheckout?.integrity,
    billingCheckout?.brands,
    billingCheckout?.shopperResultUrl,
    selectedPortfolio?.id,
    onToast,
  ]);

  return {
    // State
    billingSummary,
    billingLoading,
    showChargeModal,
    showRefundModal,
    chargeAction,
    chargeAmount,
    refundAmount,
    applyToBalance,
    billingCheckout,
    billingWidgetReady,
    billingIsVerifyingGateway,
    billingRefundReferenceId,
    chargePhase,
    chargeError,
    chargeIntent,
    boChargeBlocking,
    // Refs
    billingWidgetMountRef,
    // Actions
    setShowChargeModal,
    setShowRefundModal,
    setChargeAction,
    setChargeAmount,
    setRefundAmount,
    setApplyToBalance,
    setBillingCheckout,
    setBillingWidgetReady,
    setBillingRefundReferenceId,
    setBoChargePhase,
    setBoChargeError,
    setBoChargeIntent,
    openBillingCharge,
    openBillingRefund,
    loadBillingSummary,
  };
}

export type UsePolicyBillingResult = ReturnType<typeof usePolicyBilling>;

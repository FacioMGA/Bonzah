import React from 'react';
import { Modal } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import { SearchableSelect as UiSearchableSelect } from '@/src/shared/ui';
import { billingApiClient as api } from '@/src/modules/billing/api/billingApiClient';
import type { UsePolicyBillingResult } from '../../billing/hooks/usePolicyBilling';
import { CARDCORP_WIDGET_CSS, CARDCORP_WIDGET_SCOPE_CLASS } from '@/src/modules/billing/cardcorpStyles';
import { asRecord } from '@/src/shared/lib/record';

type PolicyBillingModalProps = {
  selectedPortfolio: { id?: string } | null;
  billing: UsePolicyBillingResult;
  billingRiskTransactionId: string | null;
  setToastMessage: (message: string) => void;
  setShowToast: (show: boolean) => void;
};

export function PolicyBillingModals(props: PolicyBillingModalProps) {
  const {
    selectedPortfolio,
    billing,
    billingRiskTransactionId,
    setToastMessage,
    setShowToast,
  } = props;

  const [refundSubmitting, setRefundSubmitting] = React.useState(false);

  return (
    <>
      {/* Billing: Charge (CardCorp) */}
      <Modal
        isOpen={billing.showChargeModal}
        onClose={() => {
          if (billing.boChargeBlocking) {
            setToastMessage('Payment is being verified — please wait for confirmation.');
            setShowToast(true);
            return;
          }
          // If operator closes before completing payment, mark the attempt as abandoned so it doesn't remain PENDING forever.
          try {
            if (selectedPortfolio?.id && billing.billingCheckout?.paymentId) {
              void api.abandonBoCardcorpCheckout(String(selectedPortfolio.id), { paymentId: String(billing.billingCheckout.paymentId) });
            } else if (selectedPortfolio?.id && billing.billingCheckout?.checkoutId) {
              void api.abandonBoCardcorpCheckout(String(selectedPortfolio.id), { checkoutId: String(billing.billingCheckout.checkoutId) });
            }
          } catch {
            // ignore
          }
          billing.setShowChargeModal(false);
          billing.setBillingCheckout(null);
          billing.setBillingWidgetReady(false);
          billing.setBoChargePhase('idle');
          billing.setBoChargeError('');
        }}
        title="Charge"
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => {
                if (billing.boChargeBlocking) {
                  setToastMessage('Payment is being verified — please wait for confirmation.');
                  setShowToast(true);
                  return;
                }
                // Same abandon behavior on explicit Close.
                try {
                  if (selectedPortfolio?.id && billing.billingCheckout?.paymentId) {
                    void api.abandonBoCardcorpCheckout(String(selectedPortfolio.id), { paymentId: String(billing.billingCheckout.paymentId) });
                  } else if (selectedPortfolio?.id && billing.billingCheckout?.checkoutId) {
                    void api.abandonBoCardcorpCheckout(String(selectedPortfolio.id), { checkoutId: String(billing.billingCheckout.checkoutId) });
                  }
                } catch {
                  // ignore
                }
                billing.setShowChargeModal(false);
                billing.setBillingCheckout(null);
                billing.setBillingWidgetReady(false);
                billing.setBoChargePhase('idle');
                billing.setBoChargeError('');
              }}
              className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition bg-transparent"
            >
              Close
            </Button>
            {!billing.billingCheckout && (
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={async () => {
                  if (!selectedPortfolio?.id) return;
                  billing.setBoChargeError('');
                  const amt = Number(String(billing.chargeAmount || '').replace(/[^0-9.]/g, ''));
                  if (!Number.isFinite(amt) || amt <= 0) {
                    billing.setBoChargeError('Enter an amount greater than €0.00.');
                    setToastMessage('Enter a valid amount');
                    setShowToast(true);
                    return;
                  }
                  try {
                    if (billing.chargeAction === 'send_customer') {
                      const balanceSnapshot = Number(asRecord(billing.billingSummary).balance || 0);
                      const res = await api.sendPolicyPaymentRequest(String(selectedPortfolio.id), {
                        amount: amt,
                        riskTransactionId: billingRiskTransactionId,
                        balanceSnapshot: Number.isFinite(balanceSnapshot) ? balanceSnapshot : undefined,
                      });
                      if (!res?.success) throw new Error(res?.error?.message || 'Failed to send payment request');
                      setToastMessage('Payment request sent to customer');
                      setShowToast(true);
                      billing.setShowChargeModal(false);
                      billing.setBillingCheckout(null);
                      billing.setBillingWidgetReady(false);
                      billing.setBoChargePhase('idle');
                      billing.setBoChargeError('');
                      await billing.loadBillingSummary();
                      return;
                    }
                    const res = await api.createBoCardcorpCheckout(String(selectedPortfolio.id), {
                      amount: amt,
                      currency: 'EUR',
                      riskTransactionId: billingRiskTransactionId,
                    });
                    if (!res?.success) throw new Error(res?.error?.message || 'Failed to create checkout');
                    billing.setBillingCheckout(asRecord(res.data));
                    billing.setBoChargePhase('widget');
                  } catch (e) {
                    // A create/charge failure must return the operator to the
                    // amount form (with the error shown inline) — never leave the
                    // modal stuck in the post-submit "verifying" view. `error`
                    // phase is reserved for genuine post-submit verification.
                    setToastMessage((e as Error)?.message || 'Failed to continue');
                    setShowToast(true);
                    billing.setBoChargePhase('idle');
                    billing.setBoChargeError((e as Error)?.message || 'Failed to continue');
                  }
                }}
                className="bg-brand-primary text-white px-8 py-3 rounded-xl font-black shadow-lg hover:bg-brand-secondary transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {billing.chargeAction === 'send_customer' ? 'Send request' : 'Proceed'}
              </Button>
            )}
          </>
        }
      >
        <div className="p-4 space-y-5">
          <style>{CARDCORP_WIDGET_CSS}</style>
          {(!billing.billingCheckout && (billing.chargePhase === 'submitting' || billing.chargePhase === 'verifying' || billing.chargePhase === 'error') && (billing.chargeIntent || billing.chargeAmount)) ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
                <div className="min-w-col220">
                  <div className="text-[10px] font-extrabold text-slate-400 uppercase tracking-[0.16em]">
                    Charging
                  </div>
                  <div className="text-xl font-black text-slate-900">
                    €{Number(billing.chargeIntent?.amount ?? billing.chargeAmount ?? 0).toFixed(2)}
                  </div>
                </div>
                <div className="text-xs font-bold text-slate-500">
                  {billing.chargePhase === 'error'
                    ? 'Payment could not be completed.'
                    : 'Verifying CardCorp payment result…'}
                </div>
              </div>

              {(billing.chargePhase === 'verifying' || billing.chargePhase === 'submitting') && (
                <div className="mt-2 inline-flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200/60 text-xs font-bold text-slate-700">
                  <span className="inline-block h-3 w-3 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
                  Verifying payment… please keep this window open.
                </div>
              )}

              {billing.chargePhase === 'error' && Boolean(billing.chargeError) && (
                <div className="mt-2 px-4 py-3 rounded-2xl bg-red-50 border border-red-200 text-xs font-bold text-red-800">
                  {billing.chargeError}
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition"
                  onClick={() => {
                    // Allow operator to restart if verification failed/pending too long.
                    billing.setBoChargePhase('idle');
                    billing.setBoChargeError('');
                    billing.setBoChargeIntent(null);
                    try { sessionStorage.removeItem('facio:bo:cardcorp:lastCharge'); } catch { }
                  }}
                >
                  Start new charge
                </Button>
              </div>
            </>
          ) : !billing.billingCheckout ? (
            <>
              {Boolean(billing.chargeError) && (
                <div className="px-4 py-3 rounded-2xl bg-red-50 border border-red-200 text-xs font-bold text-red-800">
                  {billing.chargeError}
                </div>
              )}
              <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    billing.setChargeAction('send_customer');
                    billing.setBillingCheckout(null);
                    billing.setBillingWidgetReady(false);
                    billing.setBoChargePhase('idle');
                    billing.setBoChargeError('');
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition ${billing.chargeAction === 'send_customer'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                    }`}
                >
                  Send to customer
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    billing.setChargeAction('charge_bo');
                    billing.setBoChargePhase('idle');
                    billing.setBoChargeError('');
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition ${billing.chargeAction === 'charge_bo'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                    }`}
                >
                  Charge in BO
                </Button>
              </div>
              <div className="relative group/field max-w-sm">
                <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">
                  Amount
                </label>
                <Input
                  value={billing.chargeAmount}
                  onChange={(e) => {
                    billing.setChargeAmount(e.target.value);
                    if (billing.chargeError) billing.setBoChargeError('');
                  }}
                  variant="ui"
                  className="font-bold"
                  placeholder="e.g. 120.00"
                />
              </div>
              <label className="flex items-center gap-3 text-sm font-bold text-slate-700 select-none">
                <Input
                  type="checkbox"
                  checked={billing.applyToBalance}
                  onChange={(e) => billing.setApplyToBalance(e.target.checked)}
                  className="h-4 w-4"
                />
                Apply to balance (suggested)
              </label>
              <div className="text-xs text-slate-500 font-medium">
                {billing.chargeAction === 'send_customer'
                  ? 'Send a secure payment link to the customer for this amount.'
                  : 'Suggested default is the outstanding balance. You can override if needed.'}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
                <div className="min-w-col220">
                  <div className="text-[10px] font-extrabold text-slate-400 uppercase tracking-[0.16em]">
                    Charging
                  </div>
                  <div className="text-xl font-black text-slate-900">
                    €{Number(billing.billingCheckout?.amount ?? billing.chargeAmount ?? 0).toFixed(2)}
                  </div>
                </div>
                <div className="text-xs font-bold text-slate-500">
                  Secure CardCorp checkout. Complete payment to add a real ledger entry.
                </div>
              </div>

              {(billing.chargePhase === 'verifying' || billing.chargePhase === 'submitting') && (
                <div className="mt-2 inline-flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200/60 text-xs font-bold text-slate-700">
                  <span className="inline-block h-3 w-3 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
                  Verifying payment… please keep this window open.
                </div>
              )}

              {billing.chargePhase === 'error' && Boolean(billing.chargeError) && (
                <div className="mt-2 px-4 py-3 rounded-2xl bg-red-50 border border-red-200 text-xs font-bold text-red-800">
                  {billing.chargeError}
                </div>
              )}

              <div
                ref={billing.billingWidgetMountRef}
                className={`cardcorp-widget ${CARDCORP_WIDGET_SCOPE_CLASS}`}
              >
                <form
                  key={`${String(billing.billingCheckout?.checkoutId || '')}:${String(billing.billingCheckout?.widgetScriptUrl || '')}`}
                  action={String(billing.billingCheckout?.shopperResultUrl || '')}
                  className="paymentWidgets"
                  data-brands={String(billing.billingCheckout?.brands || 'VISA MASTER')}
                />
                {!billing.billingWidgetReady && (
                  <div className="mt-4 text-xs font-semibold text-slate-500">
                    Loading payment form…
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Billing: Refund (CardCorp) */}
      <Modal
        isOpen={billing.showRefundModal}
        onClose={() => {
          if (refundSubmitting) return;
          billing.setShowRefundModal(false);
        }}
        title="Refund"
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => {
                if (refundSubmitting) return;
                billing.setShowRefundModal(false);
              }}
              className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition"
              disabled={refundSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={async () => {
                if (!selectedPortfolio?.id) return;
                if (refundSubmitting) return;
                const amt = Number(String(billing.refundAmount || '').replace(/[^0-9.]/g, ''));
                if (!Number.isFinite(amt) || amt <= 0) {
                  setToastMessage('Enter a valid amount');
                  setShowToast(true);
                  return;
                }
                if (!billing.billingRefundReferenceId) {
                  setToastMessage('Select a reference payment to refund');
                  setShowToast(true);
                  return;
                }
                try {
                  setRefundSubmitting(true);
                  const res = await api.refundBoCardcorp(String(selectedPortfolio.id), {
                    referencePaymentId: String(billing.billingRefundReferenceId),
                    amount: amt,
                    currency: 'EUR',
                    riskTransactionId: billingRiskTransactionId,
                  });
                  if (!res?.success) throw new Error(res?.error?.message || 'Refund failed');
                  const providerPaymentId = String((res?.data as { providerPaymentId?: string })?.providerPaymentId || '').trim();
                  setToastMessage(providerPaymentId ? `Refund requested (CardCorp: ${providerPaymentId})` : 'Refund requested');
                  setShowToast(true);
                  billing.setShowRefundModal(false);
                  await billing.loadBillingSummary();
                } catch (e) {
                  setToastMessage((e as Error)?.message || 'Refund failed');
                  setShowToast(true);
                } finally {
                  setRefundSubmitting(false);
                }
              }}
              className="bg-brand-primary text-white px-8 py-3 rounded-xl font-black shadow-lg hover:bg-brand-secondary transition disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={refundSubmitting}
            >
              {refundSubmitting ? 'Requesting…' : 'Request refund'}
            </Button>
          </>
        }
      >
        <div className="p-4 space-y-5">
          <div className="relative group/field max-w-sm">
            <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">
              Amount
            </label>
            <Input
              value={billing.refundAmount}
              onChange={(e) => billing.setRefundAmount(e.target.value)}
              variant="ui"
              className="font-bold"
              placeholder="e.g. 50.00"
            />
          </div>

          <div className="relative group/field">
            <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">
              Refund from transaction
            </label>
            <UiSearchableSelect
              value={billing.billingRefundReferenceId}
              onChange={(v) => billing.setBillingRefundReferenceId(String(v || ''))}
              options={(() => {
                const txns: Array<Record<string, unknown>> = Array.isArray(billing.billingSummary?.transactions)
                  ? billing.billingSummary.transactions
                  : [];
                const okStatuses = new Set(['PAID', 'CAPTURED', 'AUTHORIZED']);
                return txns
                  .filter((t) => String(t?.type || '').toLowerCase() === 'charge')
                  .filter((t) => okStatuses.has(String(t?.status || '').toUpperCase()))
                  .filter((t) => String(t?.provider || '').toUpperCase() === 'CARDCORP')
                  .map((t) => ({
                    value: String(t?.id || ''),
                    label: `${String(t?.reference || '').slice(0, 28)}… — ${String(t?.currency || 'EUR')} ${Number(t?.amount || 0).toFixed(2)}`,
                  }))
                  .filter((o) => Boolean(o.value));
              })()}
              placeholder="Select a charge…"
              searchPlaceholder="Search charges…"
            />
          </div>

          <div className="text-xs text-slate-500 font-medium">
            Refunds must reference a prior successful CardCorp charge (per provider requirements).
          </div>
        </div>
      </Modal>
    </>
  );
}


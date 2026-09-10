import React, { useEffect, useState } from 'react';
import { Button } from '@/src/shared/ui';
import { operatingRequestHeaders } from '@/src/shared/lib/tenant/requestHeaders';
import { buildPublicSessionUrl } from '../buildPublicSessionUrl';
import { PaymentStep as EnabledPaymentStep, type PaymentStepProps } from './PaymentStep';

/** Projection only: the exact mapped programme and the server checkout remain authoritative. */
export function PaymentStep(props: PaymentStepProps) {
  const [projection, setProjection] = useState<{ key: string; enabled: boolean } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const key = `${props.productCode}|${props.publicSessionToken}`;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setProjection(null);
    setError('');
    void (async () => {
      const response = await fetch(
        buildPublicSessionUrl(props.productCode, props.publicSessionToken, 'journey'),
        { headers: operatingRequestHeaders(), signal: controller.signal },
      );
      const result: unknown = await response.json();
      const envelope =
        result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
      const data =
        envelope.data && typeof envelope.data === 'object'
          ? (envelope.data as Record<string, unknown>)
          : {};
      const customer =
        data.customer && typeof data.customer === 'object'
          ? (data.customer as Record<string, unknown>)
          : {};
      if (!response.ok || envelope.success !== true || typeof customer.payment !== 'boolean')
        throw new Error('Payment availability could not be verified for this published programme.');
      if (active) setProjection({ key, enabled: customer.payment });
    })().catch((failure: unknown) => {
      if (active)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Payment availability could not be verified.',
        );
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [props.productCode, props.publicSessionToken, key, retry]);
  if (projection?.key === key && projection.enabled) return <EnabledPaymentStep {...props} />;
  return (
    <section
      className="ui-card ui-card-pad max-w-2xl mx-auto space-y-4"
      aria-label="Payment availability"
    >
      <h2 className="text-2xl font-bold">
        {projection?.key === key
          ? 'Online payment is not enabled'
          : 'Checking payment availability'}
      </h2>
      {error ? (
        <p role="alert" className="text-rose-800">
          {error}
        </p>
      ) : projection?.key === key ? (
        <p>
          The published programme does not enable customer checkout. Your retained quote remains
          available for authorized back-office review. No payment has been taken.
        </p>
      ) : (
        <p role="status">Verifying the selected programme before opening checkout…</p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" onClick={props.onBack}>
          Back to acceptance
        </Button>
        {error && (
          <Button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry availability check
          </Button>
        )}
        <a href="/policies" className="px-4 py-3 underline font-bold">
          Return to workspace
        </a>
      </div>
    </section>
  );
}

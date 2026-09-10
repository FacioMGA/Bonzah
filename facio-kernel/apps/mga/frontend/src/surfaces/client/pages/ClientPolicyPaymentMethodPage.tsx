import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';

export default function ClientPolicyPaymentMethodPage() {
  const navigate = useNavigate();
  const { policyId = '' } = useParams();

  const backToPolicy = () => navigate(`/client?policy=${encodeURIComponent(policyId)}`);

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-8">
      <PageHeader
        breadcrumb={{ label: 'Back to policy', onClick: backToPolicy }}
        title="Payment method"
        subtitle="Update the card used for future policy charges and renewals."
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="text-sm font-semibold text-slate-700">
          Payment method updates are managed in billing.
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => navigate('/client/billing')}>Open billing</Button>
          <Button variant="secondary" onClick={backToPolicy}>Back</Button>
        </div>
      </section>
    </div>
  );
}

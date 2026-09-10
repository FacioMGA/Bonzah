import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { clientPortalClient as api } from '@/src/surfaces/client/api/clientPortalClient';
import { getClaimStatusLabel, humanizeClaimCode } from '@/src/modules/claims/model/claimDisplayLabels';
import { isClientClaimFormVisible } from '@/src/modules/claims/model/claimFormPackage';
import { formatDateUI } from '@/src/shared/lib/format';

type ClaimInfoRequest = { id?: string; status?: string; message?: string; requestedAt?: string };
type ClaimRecord = {
  id?: string;
  claimNumber?: string;
  status?: string;
  incidentDate?: string;
  reportedDate?: string;
  createdAt?: string;
  claimType?: string;
  description?: string;
  infoRequests?: ClaimInfoRequest[];
  data?: Record<string, unknown>;
};

export default function ClientPolicyClaimViewPage() {
  const navigate = useNavigate();
  const { policyId = '', claimId = '' } = useParams();
  const [loading, setLoading] = useState(true);
  const [claim, setClaim] = useState<ClaimRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!claimId) return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await api.getClaim(claimId);
        if (!res.success || !res.data) throw new Error(res.error?.message || 'Failed to load claim');
        setClaim(res.data as ClaimRecord);
      } catch (e) {
        setError((e as Error).message || 'Failed to load claim');
      } finally {
        setLoading(false);
      }
    })();
  }, [claimId]);

  const backToPolicy = () => navigate(`/client?policy=${encodeURIComponent(policyId)}`);

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-8">
      <PageHeader
        breadcrumb={{ label: 'Back to policy', onClick: backToPolicy }}
        title={`Claim ${String(claim?.claimNumber || claimId).toUpperCase()}`}
        subtitle="Track status and requested information."
      />

      {loading ? (
        <div className="text-slate-400 font-medium">Loading…</div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{error}</div>
      ) : !claim ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="text-lg font-black text-slate-900">Claim not found</div>
        </div>
      ) : (
        <>
          {(() => {
            const visible = isClientClaimFormVisible(claim.data);
            if (!visible) return null;
            return (
              <section className="rounded-3xl border border-brand-primary/20 bg-brand-primary/5 p-6 shadow-sm">
                <div className="text-sm font-black text-brand-primary">Claim Form Requested</div>
                <div className="mt-1 text-sm font-semibold text-slate-700">
                  The claims team requested your full claim form package. Please complete it to continue processing.
                </div>
                <div className="mt-4">
                  <Button onClick={() => navigate(`/client/policy/${encodeURIComponent(policyId)}/claim/${encodeURIComponent(claimId)}/form`)}>
                    Complete claim form
                  </Button>
                </div>
              </section>
            );
          })()}

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Status</div>
              <div className="mt-2 font-black text-slate-900">{getClaimStatusLabel(String(claim.status || 'Submitted'))}</div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Date submitted</div>
              <div className="mt-2 font-black text-slate-900">{formatDateUI(claim.reportedDate || claim.createdAt)}</div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Incident date</div>
              <div className="mt-2 font-black text-slate-900">{formatDateUI(claim.incidentDate)}</div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Description</div>
            <div className="text-sm font-semibold text-slate-700 whitespace-pre-wrap">{String(claim.description || '—')}</div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Information requests</div>
            {!Array.isArray(claim.infoRequests) || claim.infoRequests.length === 0 ? (
              <div className="text-sm font-semibold text-slate-600">No information requests right now.</div>
            ) : (
              claim.infoRequests.map((req, idx) => (
                <div key={String(req.id || idx)} className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-sm font-black text-slate-900">{String(req.message || 'Information requested')}</div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    {humanizeClaimCode(String(req.status || 'OPEN'))} · {formatDateUI(req.requestedAt)}
                  </div>
                </div>
              ))
            )}
            <div className="pt-2">
              <Button onClick={() => navigate(`/client/policy/${encodeURIComponent(policyId)}/claim/new`)}>
                Report another claim
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { clientPortalClient as api } from '@/src/surfaces/client/api/clientPortalClient';
import { asRecord, type UnknownRecord } from '@/src/shared/lib/record';

type ClaimAssignment = {
  role?: string;
  status?: string;
  pro?: { name?: string; phone?: string; email?: string };
};
type ClaimRecord = {
  id?: string;
  claimNumber?: string;
  assignments?: ClaimAssignment[];
  data?: UnknownRecord;
  policy?: { quoteResponse?: UnknownRecord };
};
type PolicyRecord = {
  id?: string;
  quoteData?: UnknownRecord;
  quoteResponse?: UnknownRecord;
};

function asString(value: unknown): string {
  return String(value || '').trim();
}

function pickFirstName(policy: PolicyRecord | null): string {
  const qd = asRecord(policy?.quoteData);
  const proposer = asRecord(qd.proposer);
  const first = asString(proposer.firstName);
  if (first) return first;
  const full = asString(qd.name || qd.fullName);
  if (!full) return 'Customer';
  return full.split(/\s+/)[0] || 'Customer';
}

export default function ClientFnolInstructionsPage() {
  const navigate = useNavigate();
  const { policyId = '', claimId = '' } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claim, setClaim] = useState<ClaimRecord | null>(null);
  const [policy, setPolicy] = useState<PolicyRecord | null>(null);

  useEffect(() => {
    if (!policyId || !claimId) return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [claimRes, policyRes] = await Promise.all([
          api.getClaim(claimId),
          api.getPolicy(policyId),
        ]);
        if (!claimRes.success || !claimRes.data) throw new Error(claimRes.error?.message || 'Failed to load claim');
        if (!policyRes.success || !policyRes.data) throw new Error(policyRes.error?.message || 'Failed to load policy');
        setClaim(claimRes.data as ClaimRecord);
        setPolicy(policyRes.data as PolicyRecord);
      } catch (e) {
        setError((e as Error).message || 'Failed to load instructions');
      } finally {
        setLoading(false);
      }
    })();
  }, [policyId, claimId]);

  const view = useMemo(() => {
    const data = asRecord(claim?.data);
    const acknowledgementLetter = asRecord(data.acknowledgementLetter);
    const claimForm = asRecord(data.claimForm);
    const thirdParty = asRecord(claimForm.thirdParty);
    const quoteResponse = asRecord(policy?.quoteResponse || claim?.policy?.quoteResponse);

    const assignments = Array.isArray(claim?.assignments) ? claim.assignments : [];
    const activeAdjuster = assignments.find((a) =>
      asString(a?.role).toLowerCase() === 'adjuster' &&
      asString(a?.status).toUpperCase() === 'ACTIVE'
    ) || assignments.find((a) => asString(a?.role).toLowerCase() === 'adjuster') || null;

    const handlerName = asString(activeAdjuster?.pro?.name) || '[Insert Claims Handler Name]';
    const handlerPhone = asString(activeAdjuster?.pro?.phone) || '[Insert Claims Handler Phone Number(s)]';
    const handlerEmail = asString(activeAdjuster?.pro?.email) || '[Insert Claims Handler Email(s)]';
    const insurerName =
      asString(quoteResponse.insurerName || quoteResponse.insurer || quoteResponse.carrierName) || '[Insert Insurer Name]';
    const lossAdjusterContact = '[Insert Loss Adjuster Name & Telephone]';
    const thirdPartyInsurer = asString(thirdParty.insurerName) || '[Insert Third Party Insurer Name]';
    const thirdPartyTelephone = asString(thirdParty.telephone) || '[Insert Third Party Insurer Telephone]';

    return {
      firstName: pickFirstName(policy),
      claimNumber: asString(claim?.claimNumber || claimId).toUpperCase(),
      handlerName,
      handlerPhone,
      handlerEmail,
      insurerName,
      lossAdjusterContact,
      thirdPartyInsurer,
      thirdPartyTelephone,
      acknowledgementText: asString(acknowledgementLetter.text),
    };
  }, [claim, claimId, policy]);

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-8">
      <PageHeader
        breadcrumb={{ label: 'Back to dashboard', onClick: () => navigate(`/client?policy=${encodeURIComponent(policyId)}`) }}
        title="Claim instructions"
        subtitle={view.claimNumber ? `Claim ${view.claimNumber}` : 'Post-submission guidance'}
      />

      {loading ? (
        <div className="text-slate-400 font-medium">Loading…</div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-900">{error}</div>
      ) : (
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm p-6 space-y-4 text-sm font-semibold text-slate-700">
          {view.acknowledgementText ? (
            <>
              <div className="whitespace-pre-wrap">{view.acknowledgementText}</div>
              <div className="pt-3">
                <Button onClick={() => navigate(`/client?policy=${encodeURIComponent(policyId)}`)}>Back to Dashboard</Button>
              </div>
            </>
          ) : (
            <>
              <p>Dear {view.firstName},</p>
              <p>We’re sorry to hear about your recent incident, and we hope that everyone involved is safe and unharmed.</p>
              <p>We are not authorised to handle claims directly; however, your claim will be managed by your appointed claims handler.</p>
              <p>We are always happy to assist by following up on your behalf and liaising directly with the claims handler to help ensure everything proceeds smoothly.</p>

              <h3 className="text-base font-black text-slate-900 pt-2">Information Required</h3>
              <p>If you were at fault in the accident, it is always best to keep costs as low as possible.</p>
              <p>While taking your vehicle to the manufacturer’s main dealership for repair is perfectly acceptable, this is only advisable if the vehicle is still within and covered by a valid warranty.</p>
              <p>The cost of your claim can significantly affect your future renewals. Higher repair costs may lead to increased premiums or, in some cases, difficulty securing the level of cover you want.</p>
              <p>By obtaining competitive repair estimates, you help protect yourself from unnecessary premium increases and ensure that your policy remains affordable in the future.</p>
              <p>To assist the process, please provide to the loss adjuster the following details:</p>
              <p>- Name of the garage where your vehicle has been taken<br />- Garage telephone number</p>
              <p>Please stay in touch with your garage for updates about the inspection and repair authorisation process.</p>
              <p>Your insurer or their appointed loss adjuster may contact the garage directly.</p>

              <h3 className="text-base font-black text-slate-900 pt-2">Your Claims Handler</h3>
              <p>Name: {view.handlerName}<br />Tel: {view.handlerPhone}<br />Email: {view.handlerEmail}<br />Insurer: {view.insurerName}<br />Loss Adjuster Contact: {view.lossAdjusterContact}</p>

              <h3 className="text-base font-black text-slate-900 pt-2">If You Were At Fault and Have Full Comprehensive Cover</h3>
              <p>An assessor will inspect your vehicle at the garage of your choice and report to your insurer.</p>
              <p>The insurer will authorise the necessary repairs.</p>
              <p>Once repairs are complete, you will pay your policy excess directly to the garage and sign a discharge receipt once you are satisfied with the repairs.</p>
              <p>If the vehicle is declared a total loss, your insurer will offer the current market value, less your excess and any salvage value.</p>

              <h3 className="text-base font-black text-slate-900 pt-2">If You Were Not at Fault</h3>
              <p>Third-party insurer: {view.thirdPartyInsurer}<br />Tel: {view.thirdPartyTelephone}</p>
              <p>Your insurer will notify the third-party insurer of your intention to claim.</p>
              <p>The third-party insurer should then take over the process and contact you directly to arrange assessment and repair authorisation.</p>
              <p>The third-party insurer is responsible for covering repair costs, loss of use, and any hire vehicle.</p>
              <p>You will deal directly with the third-party insurer, but we will remain available to support you at any stage if needed.</p>

              <h3 className="text-base font-black text-slate-900 pt-2">Optional – Claiming Through Your Own Policy</h3>
              <p>If you have Full Comprehensive Cover and prefer, you may process the claim through your own insurer.</p>
              <p>They will handle the repairs and attempt to recover costs from the at-fault party.</p>
              <p>You will need to pay your excess up front.</p>
              <p>If recovery is successful, your excess will be reimbursed.</p>
              <p>Please note: recovery can take time, especially if liability is disputed.</p>

              <h3 className="text-base font-black text-slate-900 pt-2">In Case of Liability Dispute or Delay</h3>
              <p>If the third party denies liability or delays acceptance:</p>
              <p>You may still proceed under your Full Comprehensive policy.</p>
              <p>You will need to pay your excess after repairs.</p>
              <p>If liability is later accepted, your insurer will seek recovery and reimburse your excess.</p>

              <p>If you have any questions or need further assistance, please don’t hesitate to contact us — we’re here to help you every step of the way.</p>

              <div className="pt-3">
                <Button onClick={() => navigate(`/client?policy=${encodeURIComponent(policyId)}`)}>Back to Dashboard</Button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

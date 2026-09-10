import React from 'react';
import { Button, IconButton } from '@/src/shared/ui';
import { useNavigate } from 'react-router-dom';
import { CommunicationsTab } from '@/src/modules/communications/views/CommunicationsTab';
import { ClaimActivityTimeline } from '@/src/modules/claims/case/views/ClaimActivityTimeline';
import { AccountPoliciesTable } from './workspace/AccountPoliciesTable';
import { AccountBillingTables } from './workspace/AccountBillingTables';
import { AccountDocumentsTable } from './workspace/AccountDocumentsTable';
import { asRecord, buildPolicyNumberMap, fmtDateTime } from './workspace/workspaceTableUtils';

import { AccountClientNotesTab } from './workspace/AccountClientNotesTab';

type WorkspaceTab = 'overview' | 'policies' | 'claims' | 'billing' | 'documents' | 'communications' | 'contacts' | 'notes';

const TABS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'policies', label: 'Policies & Quotes' },
  { id: 'claims', label: 'Claims' },
  { id: 'billing', label: 'Billing' },
  { id: 'documents', label: 'Documents' },
  { id: 'communications', label: 'Communications' },
  { id: 'notes', label: 'Client Notes' },
  { id: 'contacts', label: 'Contacts' },
];

type Props = {
  accountId: string;
  workspaceTab: WorkspaceTab;
  workspaceLoading: boolean;
  workspaceData: Record<string, unknown>;
  onNavigateToList: () => void;
  onTabChange: (tab: WorkspaceTab) => void;
  onEditPrimaryContact: () => void;
};

export function AccountWorkspaceView({
  accountId,
  workspaceTab,
  workspaceLoading,
  workspaceData,
  onNavigateToList,
  onTabChange,
  onEditPrimaryContact,
}: Props) {
  const navigate = useNavigate();
  const overview = asRecord(workspaceData.overview);
  const intelligence = asRecord(workspaceData.intelligence);
  const summary = asRecord(overview.summary);
  const portfolio = asRecord(overview.portfolio);
  const feed = Array.isArray(workspaceData.feed) ? workspaceData.feed : [];
  const accountName = String(intelligence.accountName || summary.accountName || accountId);

  const state = String(intelligence.state || 'HEALTHY');
  const stateLabel = state === 'PAYMENT_ISSUE'
    ? 'Payment issue'
    : state === 'CLAIM'
      ? 'Claim'
      : state === 'RENEWAL'
        ? 'Renewal'
        : 'Healthy';
  const stateTone = state === 'PAYMENT_ISSUE'
    ? 'bg-rose-100 text-rose-800'
    : state === 'CLAIM'
      ? 'bg-amber-100 text-amber-800'
      : state === 'RENEWAL'
        ? 'bg-indigo-100 text-indigo-800'
        : 'bg-emerald-100 text-emerald-800';
  const hasAttentionSignals = Number(intelligence.overdueAmount || 0) > 0
    || Number(intelligence.openClaimsCount || 0) > 0
    || Boolean(String(intelligence.nextRenewalAt || '').trim());

  const timelineEvents = feed.map((item, idx) => {
    const rec = asRecord(item);
    return {
      id: String(rec.id || idx),
      eventType: String(rec.eventType || 'EVENT'),
      occurredAt: String(rec.occurredAt || ''),
      actorName: String(rec.sourceDomain || 'System'),
      payload: {
        summary: String(rec.eventSummary || ''),
        ...(asRecord(rec.metadata)),
      },
    };
  });

  const selectedPolicyId = (() => {
    const first = Array.isArray(workspaceData.policies) && workspaceData.policies.length > 0
      ? asRecord(workspaceData.policies[0])
      : null;
    const id = String(first?.id || '').trim();
    return id || null;
  })();
  const policies = Array.isArray(workspaceData.policies) ? workspaceData.policies : [];
  const policyNumberById = buildPolicyNumberMap(policies);

  const renderOverview = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="ui-card ui-card-pad">
          <div className="text-xs text-slate-500 font-bold uppercase tracking-widest">Active policies</div>
          <div className="text-2xl font-black text-slate-900 mt-2">{Number(summary.activePoliciesCount || 0)}</div>
        </div>
        <div className="ui-card ui-card-pad">
          <div className="text-xs text-slate-500 font-bold uppercase tracking-widest">Portfolio premium</div>
          <div className="text-2xl font-black text-slate-900 mt-2">
            {new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(summary.annualizedPremium || 0))}
          </div>
        </div>
        <div className="ui-card ui-card-pad">
          <div className="text-xs text-slate-500 font-bold uppercase tracking-widest">Open claims</div>
          <div className="text-2xl font-black text-slate-900 mt-2">{Number(summary.openClaimsCount || 0)}</div>
        </div>
        <div className="ui-card ui-card-pad">
          <div className="text-xs text-slate-500 font-bold uppercase tracking-widest">Outstanding balance</div>
          <div className="text-2xl font-black text-slate-900 mt-2">
            {new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(summary.outstandingBalance || 0))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-10 gap-4">
        <div className={hasAttentionSignals ? 'lg:col-span-7' : 'lg:col-span-10'}>
          <div className="text-xs text-slate-500 font-bold uppercase tracking-widest mb-4">Timeline</div>
          <ClaimActivityTimeline
            events={timelineEvents}
            emptyMessage="No account activity has been recorded yet."
            compact
          />
        </div>
        {hasAttentionSignals ? (
        <div className="lg:col-span-3">
          <div className="text-xs text-slate-500 font-bold uppercase tracking-widest mb-4">Attention</div>
          <div className="space-y-2">
            {Number(intelligence.overdueAmount || 0) > 0 ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                Overdue payment detected
              </div>
            ) : null}
            {Number(intelligence.openClaimsCount || 0) > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">
                {Number(intelligence.openClaimsCount || 0)} open claims
              </div>
            ) : null}
            {String(intelligence.nextRenewalAt || '').trim() ? (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700">
                Renewal on {new Date(String(intelligence.nextRenewalAt)).toLocaleDateString()}
              </div>
            ) : null}
          </div>
        </div>
        ) : null}
      </div>
      <div className="text-xs text-slate-400 font-semibold">
        Renewal buckets: 30d {String(asRecord(portfolio.renewalBuckets).in30Days || 0)} • 60d {String(asRecord(portfolio.renewalBuckets).in60Days || 0)}
      </div>
    </div>
  );

  const renderClaimsTable = (rows: unknown[]) => {
    return (
      <div className="ui-table-wrap">
        <div className="px-10 py-6 bg-slate-50/60 border-b border-slate-200/60">
          <div className="text-xs font-black text-slate-600 uppercase tracking-widest">Claims</div>
        </div>
        {rows.length === 0 ? (
          <div className="px-10 py-10 text-sm text-slate-400">No claims yet.</div>
        ) : (
          <div className="overflow-auto">
            <table className="ui-table min-w-full">
              <thead className="ui-thead">
                <tr>
                  <th className="px-10 py-6">Claim number</th>
                  <th className="px-10 py-6">Status</th>
                  <th className="px-10 py-6">Reserve / exposure</th>
                  <th className="px-10 py-6">Coverage</th>
                  <th className="px-10 py-6">Loss date</th>
                  <th className="px-10 py-6">Last update</th>
                </tr>
              </thead>
              <tbody className="ui-tbody">
                {rows.slice(0, 50).map((row, idx) => {
                  const rec = asRecord(row);
                  const claimId = String(rec.id || '').trim();
                  const reserve = Number(rec.amountReserved || 0) || 0;
                  const coverage = String(asRecord(rec.policy).policyNumber || '—');
                  return (
                    <tr
                      key={claimId || String(idx)}
                      className={`ui-row ${claimId ? 'cursor-pointer' : ''}`}
                      onClick={() => {
                        if (!claimId) return;
                        navigate(`/claims/${encodeURIComponent(claimId)}#overview`);
                      }}
                    >
                      <td className="px-10 py-6 font-black text-slate-900">{String(rec.claimNumber || '—')}</td>
                      <td className="px-10 py-6 text-slate-700 font-semibold">{String(rec.status || '—')}</td>
                      <td className="px-10 py-6 text-slate-700 font-semibold">
                        {new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(reserve)}
                      </td>
                      <td className="px-10 py-6 text-slate-700 font-semibold">{coverage}</td>
                      <td className="px-10 py-6 text-slate-700 font-semibold">{fmtDateTime(rec.incidentDate)}</td>
                      <td className="px-10 py-6 text-slate-700 font-semibold">{fmtDateTime(rec.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const renderContactsTable = (rows: unknown[]) => (
    <div className="ui-table-wrap">
      <div className="px-10 py-6 bg-slate-50/60 border-b border-slate-200/60 flex items-center justify-between gap-4">
        <div className="text-xs font-black text-slate-600 uppercase tracking-widest">Contacts</div>
        <Button type="button" variant="secondary" size="md" onClick={onEditPrimaryContact}>
          Edit contact
        </Button>
      </div>
      {rows.length === 0 ? (
        <div className="px-10 py-10 text-sm text-slate-400">No contacts.</div>
      ) : (
        <div className="overflow-auto">
          <table className="ui-table min-w-full">
            <thead className="ui-thead">
              <tr>
                <th className="px-10 py-6">Name</th>
                <th className="px-10 py-6">Role</th>
                <th className="px-10 py-6">Email</th>
                <th className="px-10 py-6">Phone</th>
              </tr>
            </thead>
            <tbody className="ui-tbody">
              {rows.map((row, idx) => {
                const rec = asRecord(row);
                return (
                  <tr key={String(rec.id || idx)} className="ui-row">
                    <td className="px-10 py-6 font-black text-slate-900">{String(rec.name || '—')}</td>
                    <td className="px-10 py-6 text-slate-700 font-semibold">{String(rec.role || '—').replaceAll('_', ' ')}</td>
                    <td className="px-10 py-6 text-slate-700 font-semibold">{String(rec.email || '—')}</td>
                    <td className="px-10 py-6 text-slate-700 font-semibold">{String(rec.phone || '—')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const claimsData = asRecord(workspaceData.claims);
  const claims = Array.isArray(claimsData.items) ? claimsData.items : [];
  const billing = asRecord(workspaceData.billing);
  const documents = Array.isArray(workspaceData.documents) ? workspaceData.documents : [];
  const contacts = Array.isArray(workspaceData.contacts) ? workspaceData.contacts : [];

  return (
    <div className="ui-page max-w-none space-y-10 animate-in fade-in duration-500 pb-32">
      <div className="bg-transparent">
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0 flex items-center gap-4">
            <IconButton title="Back" variant="neutral" onClick={onNavigateToList}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </IconButton>
            <h1 className="min-w-0 text-3xl font-black text-slate-900 tracking-tight truncate">{accountName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-slate-100 text-slate-700">
              {String(summary.accountType || 'INDIVIDUAL')}
            </span>
            <span className={`px-3 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest ${stateTone}`}>
              {stateLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="px-0 bg-brand-canvas">
        <div className="ui-tabsbar">
          {TABS.map((tab) => (
            <Button
              key={tab.id}
              type="button"
              variant="tab"
              size="tab"
              onClick={() => onTabChange(tab.id)}
              className={`ui-tab ${workspaceTab === tab.id ? 'ui-tab-active' : 'ui-tab-inactive'}`}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="px-0 pt-4 pb-8 bg-brand-canvas min-h-workspace">
        {workspaceLoading ? (
          <div className="text-sm text-slate-500">Loading account workspace...</div>
        ) : (
          <div key={workspaceTab} className="ui-tabpanel-enter">
            {workspaceTab === 'overview' && renderOverview()}
            {workspaceTab === 'policies' && <AccountPoliciesTable rows={policies} />}
            {workspaceTab === 'claims' && (
              <div className="space-y-4">
                <div className="text-sm text-slate-600">
                  Open claims: {String(asRecord(claimsData.summary).openClaimsCount || 0)} • Outstanding reserve: {String(asRecord(claimsData.summary).totalOutstandingReserve || 0)}
                </div>
                {renderClaimsTable(claims)}
              </div>
            )}
            {workspaceTab === 'billing' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="ui-card ui-card-pad"><div className="text-xs text-slate-500 uppercase font-bold tracking-widest">Outstanding</div><div className="text-2xl font-black mt-2">{String(asRecord(billing.summary).outstandingBalance || 0)}</div></div>
                  <div className="ui-card ui-card-pad"><div className="text-xs text-slate-500 uppercase font-bold tracking-widest">Paid YTD</div><div className="text-2xl font-black mt-2">{String(asRecord(billing.summary).totalPaidYtd || 0)}</div></div>
                  <div className="ui-card ui-card-pad"><div className="text-xs text-slate-500 uppercase font-bold tracking-widest">Failed payments</div><div className="text-2xl font-black mt-2">{String(asRecord(billing.summary).failedPayments || 0)}</div></div>
                </div>
                {selectedPolicyId ? (
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="secondary" onClick={() => navigate(`/policies/${encodeURIComponent(selectedPolicyId)}#billing`)}>
                      Open policy billing (charge/refund)
                    </Button>
                  </div>
                ) : null}
                <AccountBillingTables billing={billing} policyNumberById={policyNumberById} />
              </div>
            )}
            {workspaceTab === 'documents' && (
              <div className="space-y-4">
                <AccountDocumentsTable rows={documents} policyNumberById={policyNumberById} />
              </div>
            )}
            {workspaceTab === 'communications' && (
              <div className="h-[min(72vh,820px)] min-h-[560px]">
                <CommunicationsTab
                  entityType="ACCOUNT"
                  entityId={accountId}
                />
              </div>
            )}
            {workspaceTab === 'notes' && (
              <AccountClientNotesTab key={accountId} accountId={accountId} />
            )}
            {workspaceTab === 'contacts' && renderContactsTable(contacts)}
          </div>
        )}
      </div>
    </div>
  );
}

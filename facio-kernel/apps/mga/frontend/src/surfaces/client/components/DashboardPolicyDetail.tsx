import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Select } from '@/src/shared/ui';
import { IconButton } from '@/src/shared/ui/icons/IconButton';
import { AlertTriangle, Ban, Car, ChevronRight, Clock3, CreditCard, FileCheck, FileText, FolderOpen, HeartPulse, Home, LifeBuoy, Plane, Shield, ShieldCheck, User, Users } from 'lucide-react';
import { formatMoneyUI, formatDateUI } from '@/src/shared/lib/format';
import { getPaymentTransactionStatusLabel } from '@/src/modules/policies/model/policyDisplayLabels';
import { DASHBOARD_DISPLAY_CONFIG, processActivityFeed } from '../model/clientDashboardModel';
import { openClientDocument } from '@/src/surfaces/client/lib/openClientDocument';
import type { DashboardPolicyVM, ClaimVM, DocumentVM, ActivityItemVM } from '../types/dashboard.contract';

interface Props {
  policy: DashboardPolicyVM;
  allActivePolicies: DashboardPolicyVM[];
  expiredCount: number;
  docs: DocumentVM[];
  docsLoading: boolean;
  feed: ActivityItemVM[];
  feedLoading: boolean;
  topClaim: ClaimVM | null;
  pendingClaimFormClaim: ClaimVM | null;
  onFocusPolicy: (policyId: string) => void;
  onClearFocus: () => void;
  onTabHistory: () => void;
}

export function DashboardPolicyDetail({
  policy,
  allActivePolicies,
  expiredCount,
  docs,
  docsLoading,
  feed,
  feedLoading,
  topClaim,
  pendingClaimFormClaim,
  onFocusPolicy,
  onClearFocus,
  onTabHistory,
}: Props) {
  const navigate = useNavigate();
  const [showAllActivity, setShowAllActivity] = useState(false);
  const key = policy.key;
  const primaryDriver = policy.drivers.find((d) => d.isPrimary) || policy.drivers[0];
  const additionalDrivers = policy.drivers.filter((d) => !d.isPrimary);
  const addOns = [...policy.coverageItems.slice(1), ...policy.endorsementItems];
  const excessRows = [
    ...policy.coverageExcessRows,
    ...policy.additionalExcessRows.map((row) => ({ coverage: `${row.label} (endorsement)`, amount: row.amount })),
  ];
  const activityAll = processActivityFeed(feed, true);
  const activityItems = useMemo(
    () => (showAllActivity ? activityAll : activityAll.slice(0, 3)),
    [activityAll, showAllActivity]
  );
  const statusTitle = String(policy.statusMeta.title || 'Active').trim() || 'Active';
  const productType = String(policy.productType || '').toUpperCase();
  const ProductIcon = productType === 'HOME' ? Home : productType === 'TRAVEL' ? Plane : productType === 'HEALTH' ? HeartPulse : Car;
  const productLabel = policy.productLabel || (productType === 'HOME' ? 'Home' : productType === 'TRAVEL' ? 'Travel' : productType === 'HEALTH' ? 'Immigration Medical' : 'Car');
  const isMotor = productType === 'MOTOR' || !productType;
  const emergencyLine = String(DASHBOARD_DISPLAY_CONFIG.defaults.emergencyAssistanceLine || '+357 25 561 582');
  const emergencyHref = `callto:${emergencyLine.replace(/\s+/g, '')}`;
  const renewsOn = policy.endDate
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).format(new Date(policy.endDate))
    : '—';
  const paymentStatus = String(policy.paymentStatus || '').trim().toUpperCase();
  const paymentStatusLabel = paymentStatus ? getPaymentTransactionStatusLabel(paymentStatus) : 'Not recorded';
  const paymentStatusClass = paymentStatus === 'PAID' ? 'text-emerald-700' : paymentStatus ? 'text-amber-700' : 'text-slate-500';

  return (
    <div className="space-y-4">
      {allActivePolicies.length > 1 && (
        <div className="inline-flex items-center gap-3">
          <IconButton
            onClick={onClearFocus}
            title="Back to portfolio"
            variant="neutral"
            className="shrink-0 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-700"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </IconButton>
          <Select
            variant="ui"
            value={key}
            onChange={(e) => onFocusPolicy(e.target.value)}
            className="w-[280px] h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
          >
            {allActivePolicies.map((p) => (
              <option key={p.key} value={p.key}>
                {p.vehicleTitle}
              </option>
            ))}
          </Select>
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-sm font-black text-slate-900">
            <ProductIcon className="w-4 h-4 text-slate-500" />
            <span>{productLabel}</span>
          </div>
          <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-black ${policy.statusMeta.tone === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            <ShieldCheck className="w-4 h-4" />
            <span>{statusTitle} · Renews {renewsOn}</span>
          </div>
        </div>
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
          <div>
            <h2 className="text-2xl md:text-3xl font-black text-slate-900">{policy.vehicleTitle}</h2>
            {isMotor ? <div className="text-sm font-semibold text-slate-600">Reg no. {policy.registration || '—'}</div> : null}
            <div className="text-xs font-semibold text-slate-500 mt-1">Policy no. {policy.policyNumber || '—'}</div>
          </div>
        </div>
        {isMotor ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm text-slate-700">
            <div>Declared value <span className="font-black text-slate-900">{policy.declaredValue > 0 ? formatMoneyUI(policy.declaredValue, policy.currency) : '—'}</span></div>
            <div>Annual mileage <span className="font-black text-slate-900">{policy.mileage}</span></div>
            <div>Overnight parking <span className="font-black text-slate-900">{policy.parking}</span></div>
          </div>
        ) : null}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <article className="xl:col-span-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm space-y-3">
          <div className="inline-flex items-center gap-2 text-sm font-black text-slate-900">
            <Shield className="w-4 h-4 text-slate-500" />
            <span>Coverage</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-slate-700">
            <div>
              <div className="text-xs font-semibold text-slate-500">Cover</div>
              <div className="font-black text-slate-900">{policy.coverType}</div>
            </div>
            {isMotor ? <div>
              <div className="text-xs font-semibold text-slate-500">Use</div>
              <div className="font-black text-slate-900">{policy.vehicleUse}</div>
            </div> : null}
            <div>
              <div className="text-xs font-semibold text-slate-500">Territory</div>
              <div className="font-black text-slate-900">{isMotor ? `${policy.country} only` : policy.country}</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500">Policy period</div>
              <div className="font-black text-slate-900">{formatDateUI(policy.startDate)} — {formatDateUI(policy.endDate)}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-slate-700">
            <div>
              <div className="text-xs font-semibold text-slate-500">Excess</div>
              <div className="mt-1 space-y-1">
                {excessRows.length ? excessRows.map((row) => (
                  <div key={`${row.coverage}-${row.amount}`} className="text-xs font-semibold text-slate-600">
                    {row.coverage}: <span className="font-black text-slate-800">{row.amount > 0 ? formatMoneyUI(row.amount, policy.currency) : 'Nil'}</span>
                  </div>
                )) : <div className="text-xs text-slate-500">No excess details available.</div>}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500">Add-ons</div>
              <ul className="mt-1 space-y-1">
                {(addOns.length ? addOns : [DASHBOARD_DISPLAY_CONFIG.labels.noAddOns]).map((item) => (
                  <li key={`opt-${item}`} className="text-sm font-black text-slate-900">• {item}</li>
                ))}
              </ul>
            </div>
          </div>
        </article>

        {isMotor ? <article className="xl:col-span-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm space-y-3">
          <div className="inline-flex items-center gap-2 text-sm font-black text-slate-900">
            <User className="w-4 h-4 text-slate-500" />
            <span>Drivers</span>
          </div>
          <div className="space-y-2 text-sm font-semibold text-slate-700">
            <div>Primary driver: <span className="font-black text-slate-900">{primaryDriver?.fullName || 'Policy holder'}</span></div>
            <div>License tenure: <span className="font-black text-slate-900">{policy.licenseYears} years</span></div>
            <div>
              Additional drivers:{' '}
              <span className="font-black text-slate-900">
                {additionalDrivers.length > 0 ? additionalDrivers.map((driver) => driver.fullName).join(', ') : 'None'}
              </span>
            </div>
          </div>
          <Button variant="secondary" className="group w-full h-12 inline-flex items-center justify-center gap-2" onClick={() => navigate(`/client/policy/${encodeURIComponent(key)}/drivers/new`)}>
            <Users className="w-4 h-4 transition-transform duration-200 group-hover:-translate-y-0.5" />
            <span>Manage drivers</span>
          </Button>
        </article> : null}

        <article className="xl:col-span-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm space-y-3">
          <div className="inline-flex items-center gap-2 text-sm font-black text-slate-900">
            <FileText className="w-4 h-4 text-slate-500" />
            <span>Documents</span>
          </div>
          {docsLoading ? (
            <div className="text-sm font-semibold text-slate-500">Loading documents…</div>
          ) : docs.length === 0 ? (
            <div className="text-sm font-semibold text-slate-500">{DASHBOARD_DISPLAY_CONFIG.labels.noDocs}</div>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
              {docs.slice(0, 3).map((doc) => (
                <div key={doc.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-slate-900">{doc.typeLabel}</div>
                    <div className="text-xs font-semibold text-slate-500">{doc.createdAt ? formatDateUI(doc.createdAt) : '—'}</div>
                  </div>
                  {doc.href ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => { void openClientDocument(doc.href); }}
                      className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50"
                    >
                      Open
                    </Button>
                  ) : (
                    <span className="text-slate-400 text-xs font-semibold">—</span>
                  )}
                </div>
              ))}
            </div>
          )}
          <Button variant="secondary" className="group w-full h-12 inline-flex items-center justify-center gap-2" onClick={() => navigate(`/client/policy/${encodeURIComponent(key)}/documents`)}>
            <FolderOpen className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            <span>All documents</span>
          </Button>
        </article>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <article className="xl:col-span-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm space-y-3">
          <div className="inline-flex items-center gap-2 text-sm font-black text-slate-900">
            <LifeBuoy className="w-4 h-4 text-slate-500" />
            <span>Service</span>
          </div>
          <div className="space-y-1 text-sm">
            <a className="font-black text-brand-primary hover:text-brand-secondary" href={emergencyHref}>
              Need help? 24/7 emergency line:{' '}
              <span className="underline decoration-brand-primary/50 underline-offset-2">{emergencyLine}</span>
            </a>
            {topClaim?.id ? <div className="text-xs font-semibold text-slate-500">Latest claim: <span className="font-black text-slate-700">{topClaim.claimNumber}</span></div> : null}
          </div>
          <Button variant="primary" className="group w-full h-12 inline-flex items-center justify-center gap-2" onClick={() => navigate(`/client/policy/${encodeURIComponent(key)}/claim/new`)}>
            <AlertTriangle className="w-4 h-4 transition-transform duration-200 group-hover:-translate-y-0.5" />
            <span>Report incident</span>
          </Button>
          {isMotor ? (
            <Button variant="secondary" className="group w-full h-12 inline-flex items-center justify-center gap-2" onClick={() => navigate('/quote/motor/new')}>
              <Car className="w-4 h-4 transition-transform duration-200 group-hover:-translate-y-0.5" />
              <span>Insure another car</span>
            </Button>
          ) : null}
          <Button variant="secondary" className="group w-full h-12 inline-flex items-center justify-center gap-2" onClick={() => navigate(`/client/policy/${encodeURIComponent(key)}/cancel`)} disabled={policy.statusMeta.tone === 'canceled' || policy.statusMeta.tone === 'expired'}>
            <Ban className="w-4 h-4 transition-transform duration-200 group-hover:rotate-6" />
            <span>Request cancellation</span>
          </Button>
          {pendingClaimFormClaim?.id && (
            <Button variant="secondary" className="group w-full h-12 inline-flex items-center justify-center gap-2" onClick={() => navigate(`/client/policy/${encodeURIComponent(key)}/claim/${encodeURIComponent(pendingClaimFormClaim.id)}/form`)}>
              <FileCheck className="w-4 h-4 transition-transform duration-200 group-hover:-translate-y-0.5" />
              <span>Complete Claim Form</span>
            </Button>
          )}
          <div className="flex items-center gap-4 text-sm">
            <Button type="button" variant="link" size="none" onClick={() => navigate('/client/contact')} className="group h-12 text-sm font-black text-slate-700 hover:text-slate-900 inline-flex items-center gap-1.5">
              Contact support <ChevronRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Button>
          </div>
          {expiredCount > 0 && (
            <Button type="button" variant="link" size="none" onClick={onTabHistory} className="block text-xs font-black text-slate-500 hover:text-slate-700">
              View Past Policies ({expiredCount})
            </Button>
          )}
        </article>

        <article className="xl:col-span-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm space-y-3">
          <div className="inline-flex items-center gap-2 text-sm font-black text-slate-900">
            <CreditCard className="w-4 h-4 text-slate-500" />
            <span>Billing</span>
          </div>
          <div className="text-sm font-semibold text-slate-700 space-y-1">
            <div>Payment status: <span className={`font-black ${paymentStatusClass}`}>{paymentStatusLabel}</span></div>
            <div>Premium: <span className="font-black text-slate-900">{formatMoneyUI(policy.premium, policy.currency)}</span></div>
          </div>
        </article>

        <article className="xl:col-span-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm space-y-3">
          <div className="inline-flex items-center gap-2 text-sm font-black text-slate-900">
            <Clock3 className="w-4 h-4 text-slate-500" />
            <span>Activity</span>
          </div>
          {feedLoading ? (
            <div className="text-sm font-semibold text-slate-500">Loading activity…</div>
          ) : activityItems.length === 0 ? (
            <div className="text-sm font-semibold text-slate-500">No key activity recorded yet.</div>
          ) : (
            <div className={`relative ${showAllActivity ? 'max-h-64 overflow-y-auto pr-2' : ''}`}>
              <div className="absolute left-[7px] top-1 bottom-1 w-px bg-slate-200" />
              {activityItems.map((event) => (
                <div key={event.id} className="relative pl-7 py-2">
                  <span className="absolute left-0 top-3.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white ring-2 ring-slate-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                  </span>
                  <div className="text-sm font-semibold text-slate-900">{event.title}</div>
                  <div className="text-xs font-medium text-slate-500">{event.detail}</div>
                  <div className="mt-0.5 text-[11px] font-medium text-slate-400">
                    {event.occurredAt ? formatDateUI(event.occurredAt, { withTime: true }) : '—'}
                  </div>
                </div>
              ))}
            </div>
          )}
          {activityAll.length > 3 && (
            <Button
              type="button"
              variant="link"
              size="none"
              onClick={() => setShowAllActivity((prev) => !prev)}
              className="text-xs font-black text-slate-600 hover:text-slate-900"
            >
              {showAllActivity ? 'Show less' : `Expand timeline (${activityAll.length})`}
            </Button>
          )}
        </article>
      </section>
    </div>
  );
}

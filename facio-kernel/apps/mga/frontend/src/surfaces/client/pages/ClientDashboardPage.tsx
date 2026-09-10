/**
 * ClientDashboardPage — CHAMPS Thin Shell
 *
 * Zero domain logic. Zero useState. Zero useEffect.
 * Delegates everything to the controller hook.
 */
import React from 'react';
import { PageHeader } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { useClientDashboardController } from '../hooks/useClientDashboardController';
import { DashboardEmptyState } from '../components/DashboardEmptyState';
import { DashboardPortfolioGrid } from '../components/DashboardPortfolioGrid';
import { DashboardPolicyHistory } from '../components/DashboardPolicyHistory';
import { DashboardPolicyDetail } from '../components/DashboardPolicyDetail';
import { ClientQuoteEntryPanel } from '../components/ClientQuoteEntryPanel';

export default function ClientDashboardPage() {
  const c = useClientDashboardController();

  return (
    <div className="ui-page max-w-7xl mx-auto space-y-6 lg:space-y-8">
      <PageHeader title={c.greeting} subtitle="Your policies in one place." />
      <ClientQuoteEntryPanel />

      {c.loading ? (
        <div className="text-slate-400 font-medium">Loading…</div>
      ) : c.activePolicies.length === 0 ? (
        <DashboardEmptyState />
      ) : (
        <section className="space-y-4">
          {/* Tab bar is shown only in portfolio mode (multi-policy). */}
          {c.isPortfolioMode && (
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => c.setActiveTab('active')}
                className={`px-4 py-2 text-sm font-black rounded-lg ${c.activeTab === 'active' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
              >
                Active ({c.counts.active})
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => c.setActiveTab('history')}
                className={`px-4 py-2 text-sm font-black rounded-lg ${c.activeTab === 'history' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
              >
                Past Policies ({c.counts.expired})
              </Button>
            </div>
          )}

          {c.activeTab === 'history' ? (
            <DashboardPolicyHistory policies={c.expiredPolicies} />
          ) : c.isPortfolioMode ? (
            <DashboardPortfolioGrid policies={c.activePolicies} onSelect={c.focusPolicy} />
          ) : c.selectedPolicy ? (
            <DashboardPolicyDetail
              policy={c.selectedPolicy}
              allActivePolicies={c.activePolicies}
              expiredCount={c.counts.expired}
              docs={c.detail.docs}
              docsLoading={c.detail.docsLoading}
              feed={c.detail.feed}
              feedLoading={c.detail.feedLoading}
              topClaim={c.detail.topClaim}
              pendingClaimFormClaim={c.detail.pendingClaimFormClaim}
              onFocusPolicy={c.focusPolicy}
              onClearFocus={c.clearFocusedPolicy}
              onTabHistory={() => c.setActiveTab('history')}
            />
          ) : null}
        </section>
      )}
    </div>
  );
}

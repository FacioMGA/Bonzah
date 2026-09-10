// Per-window dashboard aggregator extracted from the
// `/api/reports/dashboard` route handler in PR 2.3c. Pure function over
// `policySearchIndex` rows — produces the totals/funnel/attention slice
// shown on the BO dashboard for a 7-day or 30-day live window.

import { parseRecord } from '../../../../platform/json/parseRecord.js';
import {
  STEP_ORDER,
  toNumber,
  type JsonRecord,
} from './dashboardHelpers.js';

export function computeDashboardAggregates(
  rows: Array<Record<string, unknown>>,
  windowLabel: '7d' | '30d',
) {
      const statusCounts: Record<string, number> = {};
      const uwLaneCounts: Record<'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN', number> = { GREEN: 0, YELLOW: 0, RED: 0, UNKNOWN: 0 };
      const stageLatestCounts: Record<string, number> = {
        'policy-holder': 0,
        'driving-history': 0,
        'vehicle-cover': 0,
        'your-quote': 0,
        'payment': 0,
        'issued': 0,
      };

      const stageReachedCounts: Record<string, number> = {
        'policy-holder': 0,
        'driving-history': 0,
        'vehicle-cover': 0,
        'your-quote': 0,
        'payment': 0,
        'issued': 0,
      };

      let totalGwp = 0;
      let totalPolicies = 0;
      let quotedPremium = 0;

      const nowMs = Date.now();
      const referredOverSla: Array<Record<string, unknown>> = [];
      const abandonedQuoted: Array<Record<string, unknown>> = [];
      const paidNotIssued: Array<Record<string, unknown>> = [];

      for (const idx of rows) {
        const status = String(idx?.status || '').toUpperCase() || 'UNKNOWN';
        statusCounts[status] = (statusCounts[status] || 0) + 1;
        totalPolicies += 1;

        const premium = toNumber(idx.totalPremium);
        if (Number.isFinite(premium)) totalGwp += premium;
        if (status === 'QUOTED' && Number.isFinite(premium)) quotedPremium += premium;
        if (['ISSUED', 'ACTIVE'].includes(status) && Number.isFinite(premium)) totalGwp += 0; // already counted via index

        const policy = idx.policy && typeof idx.policy === 'object' ? (idx.policy as JsonRecord) : {};
        const stateCurrent = policy.stateCurrent && typeof policy.stateCurrent === 'object' ? (policy.stateCurrent as JsonRecord) : {};
        const snap = parseRecord(stateCurrent.snapshot);
        const uwDecision = snap.uwDecision && typeof snap.uwDecision === 'object' ? (snap.uwDecision as JsonRecord) : {};
        const quoteResponse = snap.quoteResponse && typeof snap.quoteResponse === 'object' ? (snap.quoteResponse as JsonRecord) : {};
        const quoteUwDecision = quoteResponse.uwDecision && typeof quoteResponse.uwDecision === 'object' ? (quoteResponse.uwDecision as JsonRecord) : {};
        const uw = Object.keys(uwDecision).length ? uwDecision : quoteUwDecision;
        const lane = uw.lane ? String(uw.lane).toUpperCase() : null;
        if (lane === 'GREEN') uwLaneCounts.GREEN += 1;
        else if (lane === 'YELLOW') uwLaneCounts.YELLOW += 1;
        else if (lane === 'RED') uwLaneCounts.RED += 1;
        else uwLaneCounts.UNKNOWN += 1;

        const step = String(snap.step || '').toLowerCase();
        const latestStage = STEP_ORDER[step] ? step : null;
        const inferredIssued = ['ISSUED', 'ACTIVE'].includes(status);
        const effectiveStage = inferredIssued ? 'issued' : (latestStage || 'policy-holder');
        stageLatestCounts[effectiveStage] = (stageLatestCounts[effectiveStage] || 0) + 1;

        // Reached counts (approx): if latest stage is N, count all <=N
        const effectiveN = STEP_ORDER[effectiveStage] || 1;
        for (const [k, n] of Object.entries(STEP_ORDER)) {
          if (n <= effectiveN) stageReachedCounts[k] = (stageReachedCounts[k] || 0) + 1;
        }

        // Attention signals (simple but real)
        const updatedAtRaw = policy.updatedAt || idx.updatedAt;
        const policyUpdatedAt = updatedAtRaw ? new Date(String(updatedAtRaw)).getTime() : nowMs;
        const hoursSinceUpdate = (nowMs - policyUpdatedAt) / (1000 * 60 * 60);

        if (status === 'REFERRAL' && hoursSinceUpdate >= 2) {
          referredOverSla.push({ id: idx.policyId, policyNumber: idx.policyNumber, hoursSinceUpdate, reasons: uw?.reasons || [] });
        }
        if (status === 'QUOTED' && hoursSinceUpdate >= 24) {
          abandonedQuoted.push({ id: idx.policyId, policyNumber: idx.policyNumber, hoursSinceUpdate, premium });
        }
      }

      const attention = [
        ...(paidNotIssued.length > 0
          ? [{
            priority: 'red',
            issue: 'Payment received but policy not issued',
            impact: `${paidNotIssued.length} policies`,
            action: { label: 'Fix now', href: '/policies' },
          }]
          : []),
        ...(referredOverSla.length > 0
          ? [{
            priority: 'amber',
            issue: 'Underwriting referrals pending SLA',
            impact: `${referredOverSla.length} referrals`,
            action: { label: 'Open referrals', href: '/policies?status=REFERRAL' },
          }]
          : []),
        ...(abandonedQuoted.length > 0
          ? [{
            priority: 'yellow',
            issue: 'Abandoned quotes (priced, not bound)',
            impact: `${abandonedQuoted.length} quotes`,
            action: { label: 'Recover', href: '/policies?status=QUOTED' },
          }]
          : []),
      ].slice(0, 6);

      const healthStrip: Array<{ tone: string; label: string; value: string; href: string }> = [
        {
          tone: attention.some((a) => String(a.priority) === 'red') ? 'red' : 'green',
          label: 'Issuance health',
          value: attention.some((a) => String(a.priority) === 'red') ? 'Action required' : 'Healthy',
          href: '/policies',
        },
        {
          tone: uwLaneCounts.YELLOW > 0 ? 'amber' : 'green',
          label: 'UW queue',
          value: uwLaneCounts.YELLOW > 0 ? `${uwLaneCounts.YELLOW} referrals` : 'Clear',
          href: '/policies?status=REFERRAL',
        },
        {
          tone: 'green',
          label: 'Quotes',
          value: `${statusCounts.QUOTED || 0} priced`,
          href: '/policies?status=QUOTED',
        },
        {
          tone: 'slate',
          label: 'Window',
          value: windowLabel.toUpperCase(),
          href: '/dashboard',
        },
      ];

      return {
        totals: {
          policies: totalPolicies,
          gwp: Math.round(totalGwp * 100) / 100,
          quotedPremium: Math.round(quotedPremium * 100) / 100,
        },
        statusCounts,
        uwLaneCounts,
        funnel: {
          latest: stageLatestCounts,
          reached: stageReachedCounts,
        },
        attention,
        healthStrip,
      };
}

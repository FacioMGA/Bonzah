// Reports router. The dashboard helpers + aggregator now live under
// `./reportsRouter/` (split in PR 2.3c of the errors-and-warnings
// cleanup); the `/dashboard` orchestration remains here. A further
// extraction into an app-layer use-case is the natural next step
// once the orchestration stabilises.

import { Router } from 'express';
import { z } from 'zod';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { computeClaimsKpis } from '../app/claimsInterop.js';
import { computeInsights } from '../app/insightEngine.js';
import { buildPolicyCountWhere, type PolicyDateBasis } from '../app/read/policyRepositoryCounts.js';
import {
  summarizeAuthoritativeBuckets,
  summarizeOpenClaimsReserve,
  type AuthoritativeStatusBucket,
} from './dashboardAggregates.js';

import { logger } from '../../../platform/utils/logger.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
import {
  DASHBOARD_CLAIMS_KPI_MAX_ROWS,
  DASHBOARD_MAX_ROWS,
  DashboardQuerySchema,
  STEP_ORDER,
  clampToUtcMonthDay,
  isSameUtcMonth,
  parseDashboardDate,
  policyDateValue,
  policyDateWhere,
  policySearchDashboardSelect,
  reportsAuditLog,
  shiftUtcMonth,
  toNumber,
  utcDate,
  type JsonRecord,
} from './reportsRouter/dashboardHelpers.js';
import { computeDashboardAggregates } from './reportsRouter/computeDashboardAggregates.js';
import operationalReportsRouter from './reportsRouter/operationalReportsRouter.js';

const router = Router();

router.use('/', operationalReportsRouter);

// GET /api/reports/dashboard
router.get('/dashboard', reportsAuditLog, async (req, res) => {
  try {
    const query = DashboardQuerySchema.parse(req.query);
    const startStr = query['period.start'];
    const endStr = query['period.end'];
    const programId = query.programId;
    const dateBasis = query.dateBasis as PolicyDateBasis;
    const bdxOnly = query.bdxOnly;
    const modeRaw = String(query.mode || 'MTD').toUpperCase();
    const mode = (modeRaw === 'FULL' || modeRaw === 'MONTH' || modeRaw === 'FULL_MONTH') ? 'FULL' : 'MTD';

    // Default to current month if no dates provided (kept for reporting / pack generation)
    const now = new Date();
    const periodStart = startStr
      ? parseDashboardDate(startStr, 'start')
      : utcDate(now.getUTCFullYear(), now.getUTCMonth(), 1, 'start');
    const periodEnd = endStr
      ? parseDashboardDate(endStr, 'end')
      : utcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 'end');

    const windowStart = new Date(periodStart);
    const windowEnd =
      (mode === 'MTD' && isSameUtcMonth(periodStart, now))
        ? new Date(Math.min(now.getTime(), periodEnd.getTime()))
        : new Date(periodEnd);

    const prevWindowStart = shiftUtcMonth(windowStart, -1);
    const prevWindowEnd =
      (mode === 'MTD' && isSameUtcMonth(periodStart, now))
        ? clampToUtcMonthDay(prevWindowStart, windowEnd.getUTCDate())
        : (() => {
          const d = shiftUtcMonth(periodEnd, -1);
          return utcDate(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 'end');
        })();

    // Live windows (command center)
    const live30Start = new Date(now);
    live30Start.setDate(live30Start.getDate() - 30);
    const live7Start = new Date(now);
    live7Start.setDate(live7Start.getDate() - 7);

    // Common WHERE for live rows: productType + date range + optional programId
    const baseWhereLive = (startDate: Date) => ({
      ...policyDateWhere({ dateBasis, start: startDate, end: now, programId }),
    });

    const liveRows = await tenantScopedPrisma.policySearchIndex.findMany({
      where: {
        policy: baseWhereLive(live30Start),
      },
      select: policySearchDashboardSelect,
      orderBy: { updatedAt: 'desc' },
      take: DASHBOARD_MAX_ROWS,
    });

    const rows7 = liveRows.filter((r) => {
      const policy = r.policy && typeof r.policy === 'object' ? (r.policy as JsonRecord) : {};
      const basisValue = policyDateValue(policy, dateBasis);
      return basisValue >= live7Start.getTime();
    });

    const live30 = computeDashboardAggregates(liveRows, '30d');
    const live7 = computeDashboardAggregates(rows7, '7d');

    // Period / reporting lens
    const periodWhere = {
      ...policyDateWhere({ dateBasis, start: periodStart, end: periodEnd, programId }),
    };

    const periodRows = await tenantScopedPrisma.policySearchIndex.findMany({
      where: {
        policy: periodWhere,
      },
      select: policySearchDashboardSelect,
      orderBy: { updatedAt: 'desc' },
      take: DASHBOARD_MAX_ROWS,
    });

    // Underwriter-first dashboard
    const windowWhere = {
      ...policyDateWhere({ dateBasis, start: windowStart, end: windowEnd, programId }),
    };

    const prevWindowWhere = {
      ...policyDateWhere({ dateBasis, start: prevWindowStart, end: prevWindowEnd, programId }),
    };

    const authoritativeWindowWhere = buildPolicyCountWhere({
      start: windowStart,
      end: windowEnd,
      dateBasis,
      programId: programId || null,
      productType: { not: null },
      bdxOnly,
    });
    const authoritativePrevWindowWhere = buildPolicyCountWhere({
      start: prevWindowStart,
      end: prevWindowEnd,
      dateBasis,
      programId: programId || null,
      productType: { not: null },
      bdxOnly,
    });
    const authoritativePeriodWhere = buildPolicyCountWhere({
      start: periodStart,
      end: periodEnd,
      dateBasis,
      programId: programId || null,
      productType: { not: null },
      bdxOnly,
    });

    // Core tiles aggregate in Postgres over the policySearchIndex projection — see
    // ./dashboardAggregates.ts and check-dashboard-no-policy-jsonb-hydration.mjs.
    const [
      uwRows,
      uwPrevRows,
      authoritativeWindowBuckets,
      authoritativePrevWindowBuckets,
      authoritativePeriodBuckets,
    ] = await Promise.all([
      tenantScopedPrisma.policySearchIndex.findMany({
        where: {
          policy: windowWhere,
        },
        select: policySearchDashboardSelect,
        orderBy: { updatedAt: 'desc' },
        take: DASHBOARD_MAX_ROWS,
      }),
      tenantScopedPrisma.policySearchIndex.findMany({
        where: {
          policy: prevWindowWhere,
        },
        select: policySearchDashboardSelect,
        orderBy: { updatedAt: 'desc' },
        take: DASHBOARD_MAX_ROWS,
      }),
      tenantScopedPrisma.policySearchIndex.groupBy({
        by: ['status'],
        _count: { _all: true },
        _sum: { totalPremium: true },
        where: { policy: authoritativeWindowWhere },
      }),
      tenantScopedPrisma.policySearchIndex.groupBy({
        by: ['status'],
        _count: { _all: true },
        _sum: { totalPremium: true },
        where: { policy: authoritativePrevWindowWhere },
      }),
      tenantScopedPrisma.policySearchIndex.groupBy({
        by: ['status'],
        _count: { _all: true },
        _sum: { totalPremium: true },
        where: { policy: authoritativePeriodWhere },
      }),
    ]);

    const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

    const uwCore = summarizeAuthoritativeBuckets(authoritativeWindowBuckets as AuthoritativeStatusBucket[]);
    const uwPrevCore = summarizeAuthoritativeBuckets(authoritativePrevWindowBuckets as AuthoritativeStatusBucket[]);
    const authoritativePeriodCore = summarizeAuthoritativeBuckets(authoritativePeriodBuckets as AuthoritativeStatusBucket[]);

    // Incurred claims proxy: sum reserves for claims reported in window
    const [incurredNow, incurredPrev] = await Promise.all([
      tenantScopedPrisma.claim.aggregate({
        _sum: { amountReserved: true },
        where: {
          reportedDate: { gte: windowStart, lte: windowEnd },
          ...(programId ? { policy: { programId } } : {}),
        },
      }),
      tenantScopedPrisma.claim.aggregate({
        _sum: { amountReserved: true },
        where: {
          reportedDate: { gte: prevWindowStart, lte: prevWindowEnd },
          ...(programId ? { policy: { programId } } : {}),
        },
      }),
    ]);
    const incurredClaims = toNumber(incurredNow._sum.amountReserved);
    const incurredClaimsPrev = toNumber(incurredPrev._sum.amountReserved);

    const lossRatio = uwCore.writtenPremium > 0 ? incurredClaims / uwCore.writtenPremium : 0;
    const lossRatioPrev = uwPrevCore.writtenPremium > 0 ? incurredClaimsPrev / uwPrevCore.writtenPremium : 0;

    // Funnel (MTD, money anchored)
    const stageForRow = (idx: Record<string, unknown>) => {
      const status = String(idx?.status || '').toUpperCase();
      const policy = idx.policy && typeof idx.policy === 'object' ? (idx.policy as JsonRecord) : {};
      const stateCurrent = policy.stateCurrent && typeof policy.stateCurrent === 'object' ? (policy.stateCurrent as JsonRecord) : {};
      const snap = parseRecord(stateCurrent.snapshot);
      const step = String(snap?.step || '').toLowerCase();
      const fromStep = STEP_ORDER[step] ? STEP_ORDER[step] : 1;
      const issued = ['ISSUED', 'ACTIVE'].includes(status) ? 6 : fromStep;
      return { n: issued, step };
    };
    const funnelPolicies = uwRows.map((r) => {
      const st = stageForRow(r);
      const status = String(r?.status || '').toUpperCase();
      const premium = toNumber(r?.totalPremium);
      const reachedPrice = st.n >= 4 || ['QUOTED', 'REFERRAL', 'DECLINED', 'AWAITING_PAYMENT', 'ISSUED', 'ACTIVE'].includes(status);
      const reachedPayment = st.n >= 5;
      const reachedIssued = ['ISSUED', 'ACTIVE'].includes(status);
      return { id: r.policyId, status, premium, reachedPrice, reachedPayment, reachedIssued };
    });

    const startedCount = funnelPolicies.length;
    const priceShownCount = funnelPolicies.filter((p) => p.reachedPrice).length;
    const paymentAttemptedCount = funnelPolicies.filter((p) => p.reachedPayment).length;
    const issuedCount = funnelPolicies.filter((p) => p.reachedIssued).length;

    const lostAfterPrice = sum(funnelPolicies.filter((p) => p.reachedPrice && !p.reachedPayment).map((p) => p.premium));
    const lostAfterPaymentAttempt = sum(funnelPolicies.filter((p) => p.reachedPayment && !p.reachedIssued).map((p) => p.premium));

    const funnel = [
      { step: 'Started quote', count: startedCount, dropOff: Math.max(0, startedCount - priceShownCount), eurLost: 0 },
      { step: 'Price shown', count: priceShownCount, dropOff: Math.max(0, priceShownCount - paymentAttemptedCount), eurLost: Math.round(lostAfterPrice * 100) / 100 },
      { step: 'Payment attempted', count: paymentAttemptedCount, dropOff: Math.max(0, paymentAttemptedCount - issuedCount), eurLost: Math.round(lostAfterPaymentAttempt * 100) / 100 },
      { step: 'Issued', count: issuedCount, dropOff: 0, eurLost: 0 },
    ];

    // Risk matrix + Leak monitor (group by segment for now)
    const groupKey = (r: Record<string, unknown>) => String(r?.segment || '').trim() || 'Unsegmented';
    const buildGroupMap = (rows: Array<Record<string, unknown>>) => {
      const m = new Map<string, { key: string; premium: number; count: number; policyIds: string[] }>();
      for (const r of rows) {
        const k = groupKey(r);
        if (!m.has(k)) m.set(k, { key: k, premium: 0, count: 0, policyIds: [] });
        const g = m.get(k)!;
        g.premium += toNumber(r.totalPremium);
        g.count += 1;
        if (r.policyId) g.policyIds.push(String(r.policyId));
      }
      return m;
    };

    const currentGroups = buildGroupMap(uwRows);
    const prevGroups = buildGroupMap(uwPrevRows);

    // Claims by policy for the window (reserve proxy, reportedDate window)
    const policyIdsNow = uwRows.map((r) => String(r.policyId)).filter(Boolean);
    const claimsNow = policyIdsNow.length
      ? await tenantScopedPrisma.claim.findMany({
        where: { policyId: { in: policyIdsNow }, reportedDate: { gte: windowStart, lte: windowEnd } },
        select: { policyId: true, amountReserved: true },
      })
      : [];
    const claimByPolicy = new Map<string, number>();
    for (const c of claimsNow) {
      const pid = String(c.policyId);
      claimByPolicy.set(pid, (claimByPolicy.get(pid) || 0) + toNumber(c.amountReserved));
    }

    const matrix = Array.from(currentGroups.values()).map((g) => {
      const incurred = sum(g.policyIds.map((pid) => claimByPolicy.get(pid) || 0));
      const lr = g.premium > 0 ? incurred / g.premium : 0;
      const prev = prevGroups.get(g.key);
      const prevPremium = prev ? prev.premium : 0;
      const prevLr = prevPremium > 0 ? 0 : 0; // baseline claim history per group is best-effort for now
      const deterioration = lr - prevLr;
      return {
        label: g.key,
        premium: Math.round(g.premium * 100) / 100,
        incurred: Math.round(incurred * 100) / 100,
        lossRatio: lr,
        deterioration,
        count: g.count,
      };
    })
      .sort((a, b) => b.premium - a.premium)
      .slice(0, 24);

    const leakMonitor = matrix
      .filter((x) => x.premium > 0)
      .sort((a, b) => (b.lossRatio * Math.log10(b.premium + 10)) - (a.lossRatio * Math.log10(a.premium + 10)))
      .slice(0, 8);

    // Ops queues (concrete)
    const hoursBetween = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / (1000 * 60 * 60));

    const referredRows = await tenantScopedPrisma.policySearchIndex.findMany({
      where: { status: { in: ['REFERRAL', 'INFO_REQUIRED'] }, policy: { productType: { not: null } } },
      include: { policy: { select: { updatedAt: true, createdAt: true } } },
      orderBy: { updatedAt: 'asc' },
      take: 200,
    });
    const slaHours = 2;
    const referredBreaching = referredRows.filter((r) => {
      const t = r?.policy?.updatedAt || r?.policy?.createdAt || now;
      return hoursBetween(new Date(t), now) >= slaHours;
    });
    const referredOldest = referredBreaching.length ? referredBreaching[0] : null;

    const paidNotIssuedInvoices = await tenantScopedPrisma.invoice.findMany({
      where: {
        status: { in: ['PAID', 'SETTLED'] },
        policyId: { not: null },
        policy: { status: { notIn: ['ISSUED', 'ACTIVE'] } },
      },
      select: { id: true, amount: true, updatedAt: true, policyId: true },
      orderBy: { updatedAt: 'asc' },
      take: 200,
    });
    const paidNotIssuedOldest = paidNotIssuedInvoices.length ? paidNotIssuedInvoices[0] : null;

    const complianceBlocked = uwRows.filter((r) => {
      const policy = r.policy && typeof r.policy === 'object' ? (r.policy as JsonRecord) : {};
      const stateCurrent = policy.stateCurrent && typeof policy.stateCurrent === 'object' ? (policy.stateCurrent as JsonRecord) : {};
      const snap = parseRecord(stateCurrent.snapshot);
      const compliance = snap.compliance && typeof snap.compliance === 'object' ? (snap.compliance as JsonRecord) : {};
      const blocking = compliance.blockingErrors || 0;
      const len = Array.isArray(blocking) ? blocking.length : Number(blocking || 0);
      return len > 0;
    });

    const opsQueues = [
      {
        key: 'paid_not_issued',
        label: 'Paid not issued',
        count: paidNotIssuedInvoices.length,
        eurAtRisk: Math.round(sum(paidNotIssuedInvoices.map((i) => toNumber(i.amount))) * 100) / 100,
        oldestAgeHours: paidNotIssuedOldest ? Math.round(hoursBetween(new Date(paidNotIssuedOldest.updatedAt), now) * 10) / 10 : 0,
        href: '/billing',
      },
      {
        key: 'referral_sla',
        label: `Referral / Info Required > ${slaHours}h`,
        count: referredBreaching.length,
        eurAtRisk: Math.round(sum(referredBreaching.map((r) => toNumber(r.totalPremium))) * 100) / 100,
        oldestAgeHours: referredOldest ? Math.round(hoursBetween(new Date(referredOldest.policy?.updatedAt || referredOldest.policy?.createdAt || now), now) * 10) / 10 : 0,
        href: '/policies?status=REFERRAL',
      },
      {
        key: 'cancellation_requested',
        label: 'Cancellation requested',
        count: 0,
        eurAtRisk: 0,
        oldestAgeHours: 0,
        href: '/policies?status=CANCELLATION_REQUESTED',
      },
      {
        key: 'payment_failed',
        label: 'Payment failed',
        count: 0,
        eurAtRisk: 0,
        oldestAgeHours: 0,
        href: '/policies',
      },
      {
        key: 'compliance_blocked',
        label: 'Compliance blocked',
        count: complianceBlocked.length,
        eurAtRisk: Math.round(sum(complianceBlocked.map((r) => toNumber(r.totalPremium))) * 100) / 100,
        oldestAgeHours: 0,
        href: '/policies',
      },
    ];

    // Lloyd’s view (contained)
    const lloyds = (() => {
      const missingMandatory = uwRows.filter((r) => {
        const policy = r.policy && typeof r.policy === 'object' ? (r.policy as JsonRecord) : {};
        const stateCurrent = policy.stateCurrent && typeof policy.stateCurrent === 'object' ? (policy.stateCurrent as JsonRecord) : {};
        const snap = parseRecord(stateCurrent.snapshot);
        const compliance = snap.compliance && typeof snap.compliance === 'object' ? (snap.compliance as JsonRecord) : {};
        const slugs = compliance.missingSlugs;
        return Array.isArray(slugs) && slugs.length > 0;
      }).length;
      const blocking = uwRows.filter((r) => {
        const policy = r.policy && typeof r.policy === 'object' ? (r.policy as JsonRecord) : {};
        const stateCurrent = policy.stateCurrent && typeof policy.stateCurrent === 'object' ? (policy.stateCurrent as JsonRecord) : {};
        const snap = parseRecord(stateCurrent.snapshot);
        const compliance = snap.compliance && typeof snap.compliance === 'object' ? (snap.compliance as JsonRecord) : {};
        const errs = compliance.blockingErrors;
        return Array.isArray(errs) && errs.length > 0;
      }).length;
      return {
        missingMandatory,
        blockingErrors: blocking,
        overrides: 0,
        bordereauxReadinessHint: 'Based on available compliance + issuance data (best-effort).',
      };
    })();

    // Back-compat KPI fields (now motor-derived)
    const periodAgg = computeDashboardAggregates(periodRows, '30d');
    const openClaims = await tenantScopedPrisma.claim.count({ where: { status: 'OPEN' } });
    const claimsForKpi = await tenantScopedPrisma.claim.findMany({
      where: { reportedDate: { gte: periodStart, lte: periodEnd } },
      select: {
        id: true,
        claimNumber: true,
        reportedDate: true,
        events: {
          where: { occurredAt: { lte: periodEnd } },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        },
      },
      take: DASHBOARD_CLAIMS_KPI_MAX_ROWS,
    });
    const fullTimeExaminers = await prisma.user.count({
      where: {
        role: 'UNDERWRITER',
        isActive: true,
      },
    });
    const claimsKpis = computeClaimsKpis({
      claims: claimsForKpi,
      periodStart,
      periodEnd,
      examiners: {
        fullTimeExaminers,
        averageCaseloadPerExaminer: fullTimeExaminers > 0 ? openClaims / fullTimeExaminers : 0,
        examinersLeftInPeriod: null,
      },
    });

    const renewalSignalEnd = new Date(now);
    renewalSignalEnd.setDate(renewalSignalEnd.getDate() + 30);
    const [
      portfolioRenewalsResult,
      portfolioOpenClaimsReserveResult,
      portfolioComplianceResult,
    ] = await Promise.allSettled([
      // Portfolio signal: same projection field exposed by the policies list's
      // Renewal Date filter. Do not depend on attentionBucket enrichment here:
      // a stale bucket must not hide renewals from the dashboard.
      tenantScopedPrisma.policyListIndex.count({
        where: {
          status: { in: ['ACTIVE', 'ISSUED'] },
          renewalDate: { gte: now, lte: renewalSignalEnd },
          ...(programId ? { policy: { programId } } : {}),
        },
      }),
      // Portfolio signal: all open reserves in the claims ledger. Do not require
      // a policyId, because seeded/imported claims can still carry valid reserve
      // data before the policy association is backfilled.
      tenantScopedPrisma.claim.aggregate({
        _sum: { amountReserved: true },
        where: {
          status: { notIn: ['CLOSED', 'DENIED', 'WITHDRAWN'] },
          ...(programId ? { policy: { programId } } : {}),
        },
      }),
      // Portfolio signal: count every non-pass compliance state, not only hard
      // FAIL. The policies list and BDX readiness surfaces treat WARN/reasoned
      // rows as compliance issues too.
      tenantScopedPrisma.policyListIndex.count({
        where: {
          complianceState: { not: 'PASS' },
          ...(programId ? { policy: { programId } } : {}),
        },
      }),
    ]);
    const openClaimsReserveEUR = summarizeOpenClaimsReserve(
      portfolioOpenClaimsReserveResult.status === 'fulfilled'
        ? portfolioOpenClaimsReserveResult.value._sum.amountReserved
        : 0,
    );
    const portfolioRisk = {
      expiringIn30Days: portfolioRenewalsResult.status === 'fulfilled' ? portfolioRenewalsResult.value : 0,
      openClaimsReserveEUR,
      complianceFailCount: portfolioComplianceResult.status === 'fulfilled' ? portfolioComplianceResult.value : 0,
    };

    // ─── Dashboard Intelligence (v1) ────────────────────────────────────────
    // Wrapped in try/catch: if any aggregate fails (e.g. during DB seed / migration),
    // the dashboard degrades gracefully rather than returning 500.
    let intelligence: {
      tasks: object[];
      sla:   object[];
      risk:  object;
      insights: object[];
    };
    try {

    const BILLING_OVERDUE_STATUSES = ['DRAFT', 'OPEN', 'OVERDUE', 'PENDING', 'UNPAID', 'PARTIAL'] as const;
    const overdueCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const fnolStaleCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    const [
      uwGroup,
      billingPolicyCount,
      billingInvoiceExposure,
      claimsGroup,
      operationsGroup,
      slaInvoiceOverdue,
      slaFnolStale,
      slaUwReferralStale,
      conversionExpired,
    ] = await Promise.all([
      // ── UNDERWRITING group ───────────────────────────────────────────────
      // count + EUR for policies needing UW or customer action
      tenantScopedPrisma.policyListIndex.aggregate({
        _count: { policyId: true },
        _sum: { totalPremium: true, outstandingBalance: true },
        where: {
          OR: [
            { uwActionRequired: true },
            { bo_status: 'REFERRAL' },
          ],
          ...(programId ? { policy: { programId } } : {}),
        },
      }),

      // ── BILLING group ─────────────────────────────────────────────────────
      // Count: distinct policies that have at least one unpaid invoice.
      // Uses the invoice table directly — NOT policyListIndex.outstandingBalance,
      // because that field is populated during async enrichment and may be stale
      // (e.g. immediately after a policy is created, or if the backfill hasn't run).
      tenantScopedPrisma.policy.count({
        where: {
          invoices: {
            some: { status: { in: [...BILLING_OVERDUE_STATUSES] } },
          },
          ...(programId ? { programId } : {}),
        },
      }),

      // Exposure: total outstanding invoice amount (sum across all unpaid invoices — not per policy).
      // Using invoice.amount rather than the policyListIndex projection for the same reason above.
      tenantScopedPrisma.invoice.aggregate({
        _sum: { amount: true },
        where: {
          status: { in: [...BILLING_OVERDUE_STATUSES] },
          ...(programId ? { policy: { programId } } : {}),
        },
      }),

      // ── CLAIMS group ─────────────────────────────────────────────────────
      // Count: policies with at least one open claim.
      // Exposure: derived separately from the claim table (see claimsReserveForGroup).
      // outstandingBalance on the list index = invoice debt, NOT claim reserves → wrong field.
      tenantScopedPrisma.policyListIndex.aggregate({
        _count: { policyId: true },
        where: {
          hasOpenClaim: true,
          ...(programId ? { policy: { programId } } : {}),
        },
      }),

      // ── OPERATIONS group ─────────────────────────────────────────────────
      // cancellations + in-progress endorsements
      tenantScopedPrisma.policyListIndex.aggregate({
        _count: { policyId: true },
        _sum: { cancellationExposureEUR: true },
        where: {
          OR: [
            { cancellationPending: true },
            { bo_status: 'ENDORSEMENT_IN_PROGRESS' },
          ],
          ...(programId ? { policy: { programId } } : {}),
        },
      }),

      // ── SLA 1: invoices overdue > 14 days ───────────────────────────────
      tenantScopedPrisma.invoice.count({
        where: {
          status: { in: [...BILLING_OVERDUE_STATUSES] },
          dueDate: { lt: overdueCutoff },
        },
      }),

      // ── SLA 2: claims with unconfirmed FNOL > 48h ───────────────────────
      // reportedDate is the closest proxy — FNOL was submitted at or before that date
      tenantScopedPrisma.claim.count({
        where: {
          reportedDate: { lt: fnolStaleCutoff },
          status: { notIn: ['CLOSED', 'DENIED', 'WITHDRAWN'] },
          // Unconfirmed FNOL: data.intake.status !== 'FNOL_CONFIRMED' — stored in JSONB.
          // Best available filter without a typed column: claims still in initial status string.
          // Precise filter is added when referralRequiredAt column ships.
        },
      }),

      // ── SLA 3: UW referrals open > 5 business days ──────────────────────
      // 5 business days ≈ 7 calendar days (conservative, avoids weekend math complexity).
      // bo_status_changed_at is now populated by discoverabilityWriter on every bo_status transition.
      // Null rows (not yet backfilled) are excluded by the lt filter automatically.
      tenantScopedPrisma.policyListIndex.count({
        where: {
          bo_status: 'REFERRAL',
          bo_status_changed_at: { lt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
          ...(programId ? { policy: { programId } } : {}),
        },
      }),

      // ── CONVERSION: expired quoted policies (price shown, never converted) ──
      // A QUOTED policy whose quoteExpiryDate passed without binding = a priced opportunity lost.
      // Period-scoped: captures in-period leakage, not historical backlog.
      tenantScopedPrisma.policyListIndex.aggregate({
        _count: { policyId: true },
        _sum:   { totalPremium: true },
        where: {
          status: 'QUOTED',
          quoteExpiryDate: {
            lt:  now,
            gte: periodStart,
          },
          ...(programId ? { policy: { programId } } : {}),
        },
      }),
    ]);

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const toNum = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };

    intelligence = {
      tasks: [
        {
          type: 'UNDERWRITING' as const,
          label: 'Underwriting',
          count: uwGroup._count.policyId,
          exposureEUR: round2(toNum(uwGroup._sum.totalPremium)),
          slaBreachCount: slaUwReferralStale > 0 ? slaUwReferralStale : null,
        },
        {
          type: 'CLAIMS' as const,
          label: 'Claims',
          count: claimsGroup._count.policyId,
          // Reserve (indemnity) from open claims — the real "money at risk".
          // Falls back to null display ("Pending") if no reserve has been set yet.
          exposureEUR: openClaimsReserveEUR,
          slaBreachCount: (() => {
            const d = claimsKpis.performance?.overdueDiaryItems;
            const total = toNum(d?.lessThan14Days) + toNum(d?.days14to31) + toNum(d?.moreThan31Days);
            return total > 0 ? total : null;
          })(),
        },
        {
          type: 'BILLING' as const,
          label: 'Billing',
          count: billingPolicyCount,
          // Direct invoice sum — always current, never stale.
          exposureEUR: round2(toNum(billingInvoiceExposure._sum.amount)),
          slaBreachCount: slaInvoiceOverdue,
        },
        {
          type: 'OPERATIONS' as const,
          label: 'Policy operations',
          count: operationsGroup._count.policyId,
          // Sum of pre-computed pro-rata unearned premiums for cancellation-pending policies.
          // null for ENDORSEMENT_IN_PROGRESS rows (no cancellationExposureEUR set on those).
          exposureEUR: round2(toNum(operationsGroup._sum.cancellationExposureEUR)),
          slaBreachCount: null,
        },
      ],
      sla: [
        {
          key: 'INVOICE_OVERDUE' as const,
          label: 'Invoices overdue > 14 days',
          count: slaInvoiceOverdue,
          priority: 1 as const,
          ready: true,
        },
        {
          key: 'CLAIM_FNOL_STALE' as const,
          label: 'Claims with unconfirmed FNOL > 48h',
          count: slaFnolStale,
          priority: 2 as const,
          ready: true,
        },
        {
          key: 'UW_REFERRAL_STALE' as const,
          label: 'Referrals unresolved > 5 business days',
          count: slaUwReferralStale,
          priority: 3 as const,
          ready: true,  // bo_status_changed_at now populated; null rows auto-excluded by query
        },
      ],
      risk: portfolioRisk,
      // ── Smart insights (max 3, scored + operator-language) ────────────────
      insights: computeInsights(
        {
          count:          uwGroup._count.policyId,
          exposureEUR:    round2(toNum(uwGroup._sum.totalPremium)),
          slaBreachCount: slaUwReferralStale,
        },
        {
          invoiceOverdue:  slaInvoiceOverdue,
          claimFnolStale:  slaFnolStale,
          uwReferralStale: slaUwReferralStale,
        },
        // Conversion: expired quotes in period = priced opportunities that leaked.
        // Only materialise when meaningful data exists.
        conversionExpired._count.policyId > 0
          ? {
              eurLost:      round2(toNum(conversionExpired._sum.totalPremium)),
              dropOffCount: conversionExpired._count.policyId,
            }
          : null,
      ),
    };
    // ────────────────────────────────────────────────────────────────────────
    } catch (intelligenceError) {
      logger.error({ err: intelligenceError }, 'dashboard.intelligence_aggregate_failed — degraded mode');
      intelligence = {
        tasks:    [],
        sla:      [],
        risk:     portfolioRisk,
        insights: [],
      };
    }
    // ────────────────────────────────────────────────────────────────────────

    const accounts = periodRows
      .reduce((acc: Map<string, { name: string, gwp: number, policies: number, status: string }>, idx) => {
        const name = idx.insuredName || 'Unknown';
        if (!acc.has(name)) acc.set(name, { name, gwp: 0, policies: 0, status: idx.status });
        const curr = acc.get(name)!;
        curr.gwp += Number(idx.totalPremium || 0);
        curr.policies += 1;
        return acc;
      }, new Map())
      .values();

    const accountLeaderboard = Array.from(accounts)
      .sort((a, b) => b.gwp - a.gwp)
      .slice(0, 5)
      .map(a => ({
        name: a.name,
        units: a.policies, // legacy column name in UI; now "policies"
        status: a.status,
        gwp: `€${a.gwp.toLocaleString()}`,
        ex: 0
      }));

    return res.json({
      success: true,
      data: {
        units: { active: authoritativePeriodCore.issuedCount }, // legacy; now "policies in window"
        gwp: authoritativePeriodCore.writtenPremium,
        egwpi: authoritativePeriodCore.writtenPremium * 0.85,
        exceptions: {
          pendingClaims: openClaims,
          failedDeclarations: 0,
        },
        history: [],
        accounts: accountLeaderboard,
        claimsKpis,
        intelligence,
        dashboard: {
          underwriter: {
            mode,
            window: { start: windowStart.toISOString(), end: windowEnd.toISOString() },
            prior: { start: prevWindowStart.toISOString(), end: prevWindowEnd.toISOString() },
            core: {
              writtenPremium: uwCore.writtenPremium,
              incurredClaims,
              lossRatio,
              policyCount: uwCore.issuedCount,
              submissions: uwCore.submissions,
              deltas: {
                writtenPremium: uwCore.writtenPremium - uwPrevCore.writtenPremium,
                incurredClaims: incurredClaims - incurredClaimsPrev,
                lossRatio: lossRatio - lossRatioPrev,
                policyCount: uwCore.issuedCount - uwPrevCore.issuedCount,
              },
            },
            riskMatrix: {
              dimension: 'segment',
              items: matrix,
            },
            leakMonitor,
            funnel,
            opsQueues,
            lloyds,
            claimsKpis,
          },
          live: {
            d7: live7,
            d30: live30,
          },
          period: {
            start: periodStart.toISOString(),
            end: periodEnd.toISOString(),
            aggregates: periodAgg,
          }
        }
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.issues[0]?.message || 'Invalid dashboard query' });
    }
    logger.error({ err: error }, 'Dashboard Error:');
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/', (_req, res) => res.json({ success: true, data: [] }));


export default router;

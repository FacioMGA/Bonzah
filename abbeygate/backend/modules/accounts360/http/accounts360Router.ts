/* eslint-disable max-lines -- accounts360 router is intentionally consolidated for fallback/projection parity */
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { isReservedPolicyNumber } from '../../../platform/utils/platformIds.js';
import { requirePermission } from '../../accessControl/http/permissionMiddleware.js';
import {
  createAccountClientNote,
  listAccountClientNotes,
} from '../../communications/app/accountClientNotes.js';

const router = Router();

const ListQuerySchema = z.object({
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().optional(),
  sortField: z.enum(['accountName', 'lastActivityAt', 'healthScore', 'annualizedPremium']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  mode: z.string().trim().optional(),
});

const AccountParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const PageQuerySchema = z.object({
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
/** Resolved per-call so that multi-tenant requests get the correct value. */
function brokerName() { return getTenantConfig().defaultBrokerName ?? 'Abbeygate'; }

type UnknownRecord = Record<string, unknown>;
const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};

function readPrismaDelegate(key: string): UnknownRecord { return asRecord(Reflect.get(prisma as object, key)); }
function hasProjectionDelegates(): boolean {
  const summary = readPrismaDelegate('accountSummaryProjection');
  const portfolio = readPrismaDelegate('accountPortfolioMetrics');
  const alerts = readPrismaDelegate('accountAlertsProjection');
  const feed = readPrismaDelegate('accountActivityFeed');
  return Boolean(summary.findMany && summary.findUnique && portfolio.findUnique && alerts.findMany && feed.findMany);
}

function parseContact(contact: unknown): UnknownRecord {
  if (!contact) return {};
  if (typeof contact === 'string') {
    try {
      const parsed = JSON.parse(contact);
      return asRecord(parsed);
    } catch {
      return {};
    }
  }
  return asRecord(contact);
}

function moneyFromUnknown(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parsePremiumFromPolicyRecord(policy: Record<string, unknown>): number {
  const quoteResponse = asRecord(policy.quoteResponse);
  const pricing = asRecord(quoteResponse.pricing);
  const primaryOption = asRecord(quoteResponse.primaryOption);
  const quotePremium = moneyFromUnknown(
    pricing.total ||
      pricing.annualPremium ||
      primaryOption.annualPremium ||
      quoteResponse.premium ||
      0
  );
  if (quotePremium > 0) return quotePremium;

  const riskTransactions = Array.isArray(policy.riskTransactions) ? policy.riskTransactions : [];
  const preferred = riskTransactions.find((tx) => {
    const txRec = asRecord(tx);
    const statusUp = String(txRec.status || '').toUpperCase();
    const typeUp = String(txRec.transactionType || '').toUpperCase();
    return statusUp === 'BOUND' || typeUp === 'INCEPTION' || typeUp === 'ENDORSEMENT';
  }) || riskTransactions[0];
  const preferredRec = asRecord(preferred);
  const pricingFinal = asRecord(preferredRec.pricingFinal);
  const txPremium = moneyFromUnknown(
    pricingFinal.total ||
      pricingFinal.premium ||
      pricingFinal.annualPremium ||
      0
  );
  if (txPremium > 0) return txPremium;

  const premiumTxs = Array.isArray(preferredRec.premiumTransactions) ? preferredRec.premiumTransactions : [];
  const premiumTxSum = premiumTxs.reduce((sum, tx) => {
    const txRec = asRecord(tx);
    return sum + moneyFromUnknown(txRec.grossPremium || txRec.premium || 0);
  }, 0);
  return premiumTxSum > 0 ? premiumTxSum : 0;
}

function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor<T>(token?: string): T | null {
  const t = String(token || '').trim();
  if (!t) return null;
  try {
    return JSON.parse(Buffer.from(t, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

router.get('/', async (req, res) => {
  try {
    const query = ListQuerySchema.parse(req.query);
    const take = query.limit || 20;
    if (!hasProjectionDelegates()) {
      const q = String(query.search || '').trim();
      const decoded = decodeCursor<{ id?: string }>(query.cursor);
      const whereBase: Prisma.PolicyHolderWhereInput = q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { contact: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {};
      const where: Prisma.PolicyHolderWhereInput = decoded?.id
        ? {
            AND: [whereBase, { id: { gt: decoded.id } }],
          }
        : whereBase;
      const rows = await tenantScopedPrisma.policyHolder.findMany({
        where,
        include: {
          policies: {
            select: {
              id: true,
              status: true,
              bo_status: true,
              productType: true,
              quoteResponse: true,
              updatedAt: true,
              claims: {
                select: { id: true, status: true },
              },
              invoices: {
                select: { id: true, status: true },
              },
            },
          },
        },
        orderBy: { id: 'asc' },
        take: take + 1,
      });
      const hasMore = rows.length > take;
      const itemsBase = hasMore ? rows.slice(0, take) : rows;
      const items = itemsBase.map((row) => {
        const contact = parseContact(row.contact);
        const policies = Array.isArray(row.policies) ? row.policies : [];
        const activePoliciesCount = policies.filter((policy) => {
          const status = String(policy.bo_status || policy.status || '').toUpperCase();
          return ['ACTIVE', 'ISSUED', 'BOUND', 'BOUND_DRAFT_ISSUED'].includes(status);
        }).length;
        const annualizedPremium = policies.reduce((sum, policy) => sum + parsePremiumFromPolicyRecord(asRecord(policy)), 0);
        const openClaimsCount = policies
          .flatMap((policy) => Array.isArray(policy.claims) ? policy.claims : [])
          .filter((claim) => !['CLOSED', 'DENIED', 'WITHDRAWN'].includes(String(claim.status || '').toUpperCase()))
          .length;
        const billingIssueCount = policies
          .flatMap((policy) => Array.isArray(policy.invoices) ? policy.invoices : [])
          .filter((invoice) => ['DRAFT', 'OPEN', 'OVERDUE', 'PENDING', 'UNPAID', 'PARTIAL'].includes(String(invoice.status || '').toUpperCase()))
          .length;
        const productMix = policies.reduce<Record<string, number>>((acc, policy) => {
          const product = String(policy.productType || 'UNKNOWN');
          acc[product] = (acc[product] || 0) + 1;
          return acc;
        }, {});
        const latestActivityMs = policies.reduce((latest, policy) => {
          const ms = new Date(policy.updatedAt).getTime();
          return Number.isFinite(ms) && ms > latest ? ms : latest;
        }, new Date(row.updatedAt).getTime());
        return {
          accountId: row.id,
          accountName: String(row.name || ''),
          accountType: 'INDIVIDUAL',
          secondaryIdentity: String(contact.email || contact.phone || ''),
          ownerBroker: brokerName(),
          activePoliciesCount,
          annualizedPremium,
          healthStatus: billingIssueCount > 0 || openClaimsCount > 0 ? 'ATTENTION' : 'HEALTHY',
          healthScore: billingIssueCount > 0 ? 50 : openClaimsCount > 0 ? 30 : 0,
          openClaimsCount,
          billingIssueCount,
          renewalIn30DaysCount: 0,
          lastActivityAt: new Date(latestActivityMs),
          lastActivitySummary: policies.length > 0 ? 'Portfolio updated' : 'Account updated',
          productMix,
        };
      });
      const last = itemsBase[itemsBase.length - 1];
      const nextCursor = last ? encodeCursor({ id: last.id }) : null;
      const total = await tenantScopedPrisma.policyHolder.count({ where: whereBase });
      return res.json({
        success: true,
        data: { items, hasMore, nextCursor, total },
      });
    }

    const sortField = query.sortField || 'lastActivityAt';
    const sortDir = query.sortDir || 'desc';
    const q = String(query.search || '').trim();
    const decoded = decodeCursor<{ accountName?: string; lastActivityAt?: string | null; healthScore?: number; annualizedPremium?: number; accountId?: string }>(query.cursor);

    const andFilters: Array<Record<string, unknown>> = [];
    if (q) {
      andFilters.push({
        OR: [
          { accountName: { contains: q, mode: 'insensitive' } },
          { secondaryIdentity: { contains: q, mode: 'insensitive' } },
        ],
      });
    }

    if (decoded?.accountId) {
      if (sortField === 'accountName' && decoded.accountName) {
        andFilters.push(
          sortDir === 'asc'
            ? {
                OR: [
                  { accountName: { gt: decoded.accountName } },
                  { AND: [{ accountName: decoded.accountName }, { accountId: { gt: decoded.accountId } }] },
                ],
              }
            : {
                OR: [
                  { accountName: { lt: decoded.accountName } },
                  { AND: [{ accountName: decoded.accountName }, { accountId: { lt: decoded.accountId } }] },
                ],
              }
        );
      } else if (sortField === 'healthScore' && typeof decoded.healthScore === 'number') {
        andFilters.push(
          sortDir === 'asc'
            ? {
                OR: [
                  { healthScore: { gt: decoded.healthScore } },
                  { AND: [{ healthScore: decoded.healthScore }, { accountId: { gt: decoded.accountId } }] },
                ],
              }
            : {
                OR: [
                  { healthScore: { lt: decoded.healthScore } },
                  { AND: [{ healthScore: decoded.healthScore }, { accountId: { lt: decoded.accountId } }] },
                ],
              }
        );
      } else if (sortField === 'annualizedPremium' && typeof decoded.annualizedPremium === 'number') {
        andFilters.push(
          sortDir === 'asc'
            ? {
                OR: [
                  { annualizedPremium: { gt: decoded.annualizedPremium } },
                  { AND: [{ annualizedPremium: decoded.annualizedPremium }, { accountId: { gt: decoded.accountId } }] },
                ],
              }
            : {
                OR: [
                  { annualizedPremium: { lt: decoded.annualizedPremium } },
                  { AND: [{ annualizedPremium: decoded.annualizedPremium }, { accountId: { lt: decoded.accountId } }] },
                ],
              }
        );
      } else if (sortField === 'lastActivityAt') {
        const cursorDate = toDateOrNull(decoded.lastActivityAt);
        if (cursorDate) {
          andFilters.push(
            sortDir === 'asc'
              ? {
                  OR: [
                    { lastActivityAt: { gt: cursorDate } },
                    { AND: [{ lastActivityAt: cursorDate }, { accountId: { gt: decoded.accountId } }] },
                  ],
                }
              : {
                  OR: [
                    { lastActivityAt: { lt: cursorDate } },
                    { AND: [{ lastActivityAt: cursorDate }, { accountId: { lt: decoded.accountId } }] },
                  ],
                }
          );
        }
      }
    }

    const where = andFilters.length > 0 ? { AND: andFilters } : {};
    const orderBy =
      sortField === 'accountName'
        ? [{ accountName: sortDir }, { accountId: sortDir }]
        : sortField === 'healthScore'
          ? [{ healthScore: sortDir }, { accountId: sortDir }]
          : sortField === 'annualizedPremium'
            ? [{ annualizedPremium: sortDir }, { accountId: sortDir }]
            : [{ lastActivityAt: sortDir }, { accountId: sortDir }];

    const [rows, total] = await Promise.all([
      tenantScopedPrisma.accountSummaryProjection.findMany({
        where,
        orderBy,
        take: take + 1,
      }),
      tenantScopedPrisma.accountSummaryProjection.count({
        where: q
          ? {
              OR: [
                { accountName: { contains: q, mode: 'insensitive' } },
                { secondaryIdentity: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {},
      }),
    ]);

    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const last = items[items.length - 1];
    const nextCursor = last
      ? encodeCursor({
          accountId: last.accountId,
          accountName: last.accountName,
          healthScore: last.healthScore,
          annualizedPremium: Number(last.annualizedPremium || 0),
          lastActivityAt: last.lastActivityAt ? last.lastActivityAt.toISOString() : null,
        })
      : null;

    return res.json({
      success: true,
      data: {
        items,
        hasMore,
        nextCursor,
        total,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error instanceof Error ? error.message : 'Failed to list accounts360' },
    });
  }
});

router.get('/:id/overview', async (req, res) => {
  try {
    const { id } = AccountParamsSchema.parse(req.params);
    if (!hasProjectionDelegates()) {
      const holder = await tenantScopedPrisma.policyHolder.findUnique({
        where: { id },
        include: {
          policies: {
            select: {
              id: true,
              status: true,
              bo_status: true,
              productType: true,
              policyNumber: true,
              expiryDate: true,
              updatedAt: true,
              quoteResponse: true,
              riskTransactions: {
                select: {
                  status: true,
                  transactionType: true,
                  pricingFinal: true,
                  premiumTransactions: true,
                },
                orderBy: { createdAt: 'desc' },
                take: 8,
              },
              claims: { select: { id: true, status: true, updatedAt: true } },
              invoices: { select: { amount: true, status: true, updatedAt: true } },
            },
          },
        },
      });
      if (!holder) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } });
      }
      const activePoliciesCount = holder.policies.filter((p) =>
        ['ACTIVE', 'ISSUED', 'BOUND', 'BOUND_DRAFT_ISSUED'].includes(String(p.bo_status || p.status || '').toUpperCase())
      ).length;
      const annualizedPremium = holder.policies.reduce((sum, policy) => sum + parsePremiumFromPolicyRecord(asRecord(policy)), 0);
      const openClaimsCount = holder.policies
        .flatMap((p) => p.claims || [])
        .filter((c) => !['CLOSED', 'DENIED', 'WITHDRAWN'].includes(String(c.status || '').toUpperCase())).length;
      const outstandingBalance = holder.policies
        .flatMap((p) => p.invoices || [])
        .filter((i) => ['DRAFT', 'OPEN', 'OVERDUE', 'PENDING', 'UNPAID', 'PARTIAL'].includes(String(i.status || '').toUpperCase()))
        .reduce((sum, i) => sum + (Number(i.amount || 0) || 0), 0);
      const now = Date.now();
      const renewalIn30DaysCount = holder.policies.filter((policy) => {
        const statusUp = String(policy.bo_status || policy.status || '').toUpperCase();
        if (!['ACTIVE', 'ISSUED', 'BOUND', 'BOUND_DRAFT_ISSUED'].includes(statusUp)) return false;
        const expiryMs = new Date(policy.expiryDate).getTime();
        if (!Number.isFinite(expiryMs)) return false;
        const days = Math.ceil((expiryMs - now) / (24 * 60 * 60 * 1000));
        return days >= 0 && days <= 30;
      }).length;
      const renewalIn60DaysCount = holder.policies.filter((policy) => {
        const statusUp = String(policy.bo_status || policy.status || '').toUpperCase();
        if (!['ACTIVE', 'ISSUED', 'BOUND', 'BOUND_DRAFT_ISSUED'].includes(statusUp)) return false;
        const expiryMs = new Date(policy.expiryDate).getTime();
        if (!Number.isFinite(expiryMs)) return false;
        const days = Math.ceil((expiryMs - now) / (24 * 60 * 60 * 1000));
        return days >= 0 && days <= 60;
      }).length;
      const productMix = holder.policies.reduce<Record<string, number>>((acc, policy) => {
        const product = String(asRecord(policy).productType || 'UNKNOWN');
        acc[product] = (acc[product] || 0) + 1;
        return acc;
      }, {});
      const latestPolicy = holder.policies.slice().sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

      return res.json({
        success: true,
        data: {
          summary: {
            accountId: holder.id,
            accountName: holder.name,
            accountType: 'INDIVIDUAL',
            ownerBroker: brokerName(),
            healthStatus: outstandingBalance > 0 || openClaimsCount > 0 ? 'ATTENTION' : 'HEALTHY',
            activePoliciesCount,
            annualizedPremium,
            openClaimsCount,
            outstandingBalance,
            renewalIn30DaysCount,
            renewalIn60DaysCount,
            lastActivityAt: latestPolicy?.updatedAt || holder.updatedAt,
            lastActivitySummary: latestPolicy?.policyNumber ? `Policy ${latestPolicy.policyNumber} updated` : 'Account updated',
          },
          portfolio: {
            accountId: holder.id,
            activePoliciesCount,
            draftPoliciesCount: holder.policies.filter((policy) => ['DRAFT', 'QUOTE', 'QUOTED'].includes(String(policy.bo_status || policy.status || '').toUpperCase())).length,
            expiredPoliciesCount: holder.policies.filter((policy) => ['EXPIRED', 'LAPSED'].includes(String(policy.bo_status || policy.status || '').toUpperCase())).length,
            cancelledPoliciesCount: holder.policies.filter((policy) => ['CANCELLED', 'VOID'].includes(String(policy.bo_status || policy.status || '').toUpperCase())).length,
            annualizedPremium,
            productMix,
            renewalBuckets: {
              in30Days: renewalIn30DaysCount,
              in60Days: renewalIn60DaysCount,
            },
          },
          alerts: [],
          feed: [],
        },
      });
    }
    const [summary, portfolio, alerts, feed] = await Promise.all([
      tenantScopedPrisma.accountSummaryProjection.findUnique({ where: { accountId: id } }),
      tenantScopedPrisma.accountPortfolioMetrics.findUnique({ where: { accountId: id } }),
      tenantScopedPrisma.accountAlertsProjection.findMany({
        where: { accountId: id, isOpen: true },
        orderBy: [{ severity: 'desc' }, { occurredAt: 'desc' }],
        take: 20,
      }),
      tenantScopedPrisma.accountActivityFeed.findMany({
        where: { accountId: id },
        orderBy: { occurredAt: 'desc' },
        take: 30,
      }),
    ]);

    if (!summary) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Account projection not found' } });
    }
    return res.json({ success: true, data: { summary, portfolio, alerts, feed } });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error instanceof Error ? error.message : 'Failed to load accounts360 overview' },
    });
  }
});

router.get('/:id/policies', async (req, res) => {
  try {
    const { id } = AccountParamsSchema.parse(req.params);
    const policies = await tenantScopedPrisma.policy.findMany({
      where: { policyHolderId: id },
      select: {
        id: true,
        policyNumber: true,
        productType: true,
        status: true,
        bo_status: true,
        inceptionDate: true,
        expiryDate: true,
        updatedAt: true,
        quoteResponse: true,
        riskTransactions: {
          select: {
            status: true,
            transactionType: true,
            pricingFinal: true,
            premiumTransactions: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 8,
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const mapped = policies.map((policy) => {
      const premium = parsePremiumFromPolicyRecord(asRecord(policy));
      const status = String(policy.bo_status || policy.status || '').toUpperCase();
      const group = ['ACTIVE', 'ISSUED', 'BOUND', 'BOUND_DRAFT_ISSUED'].includes(status)
        ? 'ACTIVE'
        : ['DRAFT', 'QUOTE', 'QUOTED'].includes(status)
          ? 'DRAFT'
          : ['EXPIRED', 'LAPSED'].includes(status)
            ? 'EXPIRED'
            : ['CANCELLED', 'VOID'].includes(status)
              ? 'CANCELLED'
              : 'OTHER';

      // Quote vs issued-policy split (Theo, Aug 2026). A row is a POLICY once it
      // has been bound/issued. Two signals, both already canonical: the lifecycle
      // `group` (ACTIVE/EXPIRED/CANCELLED are all post-bind) and the numbering
      // predicate (ADR-0047/0061 — a reserved policy number only exists at
      // bind/payment). The group covers BDX-imported policies whose external
      // number the predicate does not recognise; the predicate covers freshly
      // bound rows (e.g. AWAITING_PAYMENT invoices) not yet in an active group.
      const isBoundGroup = group === 'ACTIVE' || group === 'EXPIRED' || group === 'CANCELLED';
      const kind: 'POLICY' | 'QUOTE' = isBoundGroup || isReservedPolicyNumber(policy.policyNumber) ? 'POLICY' : 'QUOTE';

      return {
        id: policy.id,
        policyNumber: policy.policyNumber,
        product: policy.productType,
        status,
        group,
        kind,
        coveragePeriod: {
          start: policy.inceptionDate,
          end: policy.expiryDate,
        },
        premium,
        lastActivityAt: policy.updatedAt,
      };
    });

    return res.json({ success: true, data: mapped });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: error instanceof Error ? error.message : 'Invalid request' },
    });
  }
});

router.get('/:id/claims', async (req, res) => {
  try {
    const { id } = AccountParamsSchema.parse(req.params);
    const claims = await tenantScopedPrisma.claim.findMany({
      where: { policy: { policyHolderId: id } },
      select: {
        id: true,
        claimNumber: true,
        status: true,
        amountReserved: true,
        incidentDate: true,
        updatedAt: true,
        policy: { select: { id: true, policyNumber: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const openClaimsCount = claims.filter((claim) => !['CLOSED', 'DENIED', 'WITHDRAWN'].includes(String(claim.status || '').toUpperCase())).length;
    const totalOutstandingReserve = claims
      .filter((claim) => !['CLOSED', 'DENIED', 'WITHDRAWN'].includes(String(claim.status || '').toUpperCase()))
      .reduce((sum, claim) => sum + (Number(claim.amountReserved || 0) || 0), 0);

    return res.json({
      success: true,
      data: {
        items: claims,
        summary: { openClaimsCount, totalOutstandingReserve },
      },
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: error instanceof Error ? error.message : 'Invalid request' },
    });
  }
});

router.get('/:id/billing', async (req, res) => {
  try {
    const { id } = AccountParamsSchema.parse(req.params);
    const policyIds = (await tenantScopedPrisma.policy.findMany({
      where: { policyHolderId: id },
      select: { id: true },
    })).map((row) => row.id);

    if (policyIds.length === 0) {
      return res.json({
        success: true,
        data: {
          summary: { outstandingBalance: 0, totalPaidYtd: 0, failedPayments: 0 },
          invoices: [],
          payments: [],
        },
      });
    }

    const [invoices, payments] = await Promise.all([
      tenantScopedPrisma.invoice.findMany({
        where: { policyId: { in: policyIds } },
        orderBy: { updatedAt: 'desc' },
        take: 400,
      }),
      tenantScopedPrisma.payment.findMany({
        where: { policyId: { in: policyIds } },
        orderBy: { updatedAt: 'desc' },
        take: 400,
      }),
    ]);

    const outstandingBalance = invoices
      .filter((invoice) => ['DRAFT', 'OPEN', 'OVERDUE', 'PENDING', 'UNPAID', 'PARTIAL'].includes(String(invoice.status || '').toUpperCase()))
      .reduce((sum, invoice) => sum + (Number(invoice.amount || 0) || 0), 0);
    const ytdStart = new Date(new Date().getFullYear(), 0, 1);
    const totalPaidYtd = payments
      .filter((payment) => {
        const status = String(payment.status || '').toUpperCase();
        return ['PAID', 'CAPTURED', 'AUTHORIZED'].includes(status) && payment.updatedAt >= ytdStart;
      })
      .reduce((sum, payment) => sum + (Number(payment.amount || 0) || 0), 0);
    const failedPayments = payments.filter((payment) => ['FAILED', 'CANCELLED'].includes(String(payment.status || '').toUpperCase())).length;

    return res.json({
      success: true,
      data: {
        summary: { outstandingBalance, totalPaidYtd, failedPayments },
        invoices,
        payments,
      },
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: error instanceof Error ? error.message : 'Invalid request' },
    });
  }
});

router.get('/:id/documents', async (req, res) => {
  try {
    const { id } = AccountParamsSchema.parse(req.params);
    const documents = await tenantScopedPrisma.document.findMany({
      where: { policy: { policyHolderId: id } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return res.json({ success: true, data: documents });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: error instanceof Error ? error.message : 'Invalid request' },
    });
  }
});

router.get('/:id/communications', async (req, res) => {
  try {
    const { id } = AccountParamsSchema.parse(req.params);
    const policyIds = (await tenantScopedPrisma.policy.findMany({
      where: { policyHolderId: id },
      select: { id: true },
    })).map((row) => row.id);
    const claimIds = (await tenantScopedPrisma.claim.findMany({
      where: { policy: { policyHolderId: id } },
      select: { id: true },
    })).map((row) => row.id);
    const orFilters: Array<{ entityType: string; entityId: { in: string[] } }> = [];
    if (policyIds.length) orFilters.push({ entityType: 'POLICY', entityId: { in: policyIds } });
    if (claimIds.length) orFilters.push({ entityType: 'CLAIM', entityId: { in: claimIds } });
    if (!orFilters.length) return res.json({ success: true, data: [] });

    const threads = await prisma.communicationThread.findMany({
      where: { OR: orFilters },
      select: { id: true, entityType: true, entityId: true },
    });
    const threadIds = threads.map((thread) => thread.id);
    if (!threadIds.length) return res.json({ success: true, data: [] });

    const messages = await prisma.communicationMessage.findMany({
      where: { threadId: { in: threadIds } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return res.json({ success: true, data: messages });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: error instanceof Error ? error.message : 'Invalid request' },
    });
  }
});

router.get('/:id/contacts', async (req, res) => {
  try {
    const { id } = AccountParamsSchema.parse(req.params);
    const holder = await tenantScopedPrisma.policyHolder.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        contact: true,
        policies: {
          select: {
            id: true,
            quoteData: true,
          },
        },
      },
    });
    if (!holder) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } });
    }

    const contactRecord = (() => {
      if (!holder.contact) return {};
      if (typeof holder.contact === 'string') {
        try {
          const parsed = JSON.parse(holder.contact);
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
        } catch {
          return {};
        }
      }
      return holder.contact && typeof holder.contact === 'object' && !Array.isArray(holder.contact)
        ? (holder.contact as Record<string, unknown>)
        : {};
    })();

    const contacts: Array<Record<string, unknown>> = [
      {
        role: 'POLICYHOLDER',
        name: holder.name,
        email: contactRecord.email || null,
        phone: contactRecord.phone || null,
        metadata: { agentId: contactRecord.agentId || null },
      },
    ];

    for (const policy of holder.policies || []) {
      const quoteData = policy.quoteData && typeof policy.quoteData === 'object' && !Array.isArray(policy.quoteData)
        ? (policy.quoteData as Record<string, unknown>)
        : {};
      const drivers = Array.isArray(quoteData.additionalDrivers) ? quoteData.additionalDrivers : [];
      for (const driver of drivers) {
        const d = driver && typeof driver === 'object' && !Array.isArray(driver) ? (driver as Record<string, unknown>) : {};
        const first = String(d.firstName || '').trim();
        const last = String(d.lastName || '').trim();
        const full = [first, last].filter(Boolean).join(' ').trim();
        if (!full) continue;
        contacts.push({
          role: 'ADDITIONAL_DRIVER',
          name: full,
          metadata: { policyId: policy.id },
        });
      }
    }

    return res.json({ success: true, data: contacts });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: error instanceof Error ? error.message : 'Invalid request' },
    });
  }
});

const CreateClientNoteBodySchema = z.object({
  body: z.string().trim().min(1),
});

router.get('/:id/notes', requirePermission('accounts', 'notes.view'), async (req, res) => {
  try {
    const { id } = AccountParamsSchema.parse(req.params);
    const notes = await listAccountClientNotes(id);
    return res.json({ success: true, data: notes });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: error instanceof Error ? error.message : 'Invalid request' },
    });
  }
});

router.post('/:id/notes', requirePermission('accounts', 'notes.create'), async (req, res) => {
  try {
    const { id } = AccountParamsSchema.parse(req.params);
    const body = CreateClientNoteBodySchema.parse(req.body || {});
    const fromActor = String(req.user?.id || '').trim();
    if (!fromActor) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' },
      });
    }
    const note = await createAccountClientNote({
      accountId: id,
      body: body.body,
      fromActor,
    });
    return res.json({ success: true, data: note });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: error.issues[0]?.message || 'Invalid request' },
      });
    }
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: error instanceof Error ? error.message : 'Invalid request' },
    });
  }
});

router.get('/:id/feed', async (req, res) => {
  try {
    const { id } = AccountParamsSchema.parse(req.params);
    const query = PageQuerySchema.parse(req.query);
    const take = query.limit || 50;
    if (!hasProjectionDelegates()) {
      const policies = await tenantScopedPrisma.policy.findMany({
        where: { policyHolderId: id },
        select: { id: true, policyNumber: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take,
      });
      const items = policies.map((policy) => ({
        id: `feed-policy-${policy.id}`,
        accountId: id,
        sourceDomain: 'POLICY',
        eventType: 'POLICY_UPDATED',
        eventSummary: policy.policyNumber ? `Policy ${policy.policyNumber} updated` : 'Policy updated',
        aggregateType: 'POLICY',
        aggregateId: policy.id,
        occurredAt: policy.updatedAt,
        metadata: null,
      }));
      return res.json({
        success: true,
        data: {
          items,
          hasMore: false,
          nextCursor: null,
        },
      });
    }
    const decoded = decodeCursor<{ occurredAt?: string; id?: string }>(query.cursor);

    const where = decoded?.occurredAt && decoded?.id
      ? {
          accountId: id,
          OR: [
            { occurredAt: { lt: new Date(decoded.occurredAt) } },
            { AND: [{ occurredAt: new Date(decoded.occurredAt) }, { id: { lt: decoded.id } }] },
          ],
        }
      : { accountId: id };

    const rows = await tenantScopedPrisma.accountActivityFeed.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const last = items[items.length - 1];
    const nextCursor = last ? encodeCursor({ occurredAt: last.occurredAt.toISOString(), id: last.id }) : null;

    return res.json({
      success: true,
      data: {
        items,
        hasMore,
        nextCursor,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error instanceof Error ? error.message : 'Failed to load accounts360 feed' },
    });
  }
});

export default router;

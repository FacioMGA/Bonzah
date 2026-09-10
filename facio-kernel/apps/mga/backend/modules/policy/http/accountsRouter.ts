import type { Prisma } from '@prisma/client';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { ApiResponse } from '../../../platform/types/index.js';
import { enqueueAccountProjectionRefreshByAccountId } from '../../accounts360/app/accountProjectionRefresh.js';
import { buildAccountIntelligenceSearchWhere } from '../../accounts360/app/accountIntelligenceSearch.js';
import { errorMessage } from '../../../platform/http/httpErrors.js';

const router = Router();

const ContactSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().trim().email(),
  phone: z.string().trim().min(1),
}).passthrough();

const CreateAccountBodySchema = z.object({
  name: z.string().trim().min(1),
  segment: z.string().trim().optional(),
  contact: ContactSchema,
  address: z.string().trim().optional(),
  bankAccounts: z.array(z.unknown()).optional(),
});

const UpdateAccountBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  segment: z.string().trim().optional(),
  contact: ContactSchema.optional(),
  address: z.string().trim().optional(),
  bankAccounts: z.array(z.unknown()).optional(),
});

const AccountIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const ListAccountsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().optional(),
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sortField: z.enum(['name', 'createdAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  mode: z.string().trim().optional(),
});

const ListAccountIntelligenceQuerySchema = z.object({
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().optional(),
  sortField: z.enum(['state', 'lastActivityAt', 'totalPremium', 'accountName']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  mode: z.string().trim().optional(),
});

const CursorByNameSchema = z.object({
  name: z.string(),
  id: z.string(),
});

const CursorByCreatedAtSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string(),
});

type AccountCursor = { kind: 'name'; name: string; id: string } | { kind: 'createdAt'; createdAt: string; id: string };
type AccountIntelligenceCursor = {
  accountId: string;
  statePriority?: number;
  lastActivityAt?: string | null;
  totalPremium?: number;
  accountName?: string;
};

type ContactRecord = Record<string, unknown>;
type ErrorBody = ApiResponse<null>;

function accountsAuditLog(req: Request, _res: Response, next: NextFunction): void {
  try {
    const correlationId = (req.headers['x-correlation-id'] as string) || req.correlationId;
    const actionId = req.headers['x-action-id'] as string;
    const tenantId = String(req.headers['x-tenant-id'] || '').trim() || undefined;
    const textUser = req.user;
    const actorId = textUser?.id || 'system';
    const actorType = textUser?.role || 'SYSTEM';
    req.auditContext = { correlationId, actionId, tenantId, actorId, actorType };
    next();
  } catch {
    next();
  }
}

function sendError(res: { status: (code: number) => { json: (body: ErrorBody) => unknown } }, status: number, code: string, message: string) {
  const payload: ErrorBody = {
    success: false,
    error: { code, message },
  };
  return res.status(status).json(payload);
}

function parseJsonRecord(value: unknown): ContactRecord {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as ContactRecord)
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as ContactRecord) : {};
}

function parseJsonArray(value: unknown): unknown[] {
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

function formatAccountForResponse<T extends Record<string, unknown>>(account: T & {
  contact: unknown;
  bankAccounts: unknown;
}): Omit<T, 'contact' | 'bankAccounts'> & { contact: ContactRecord; bankAccounts: unknown[] } {
  return {
    ...account,
    contact: parseJsonRecord(account.contact),
    bankAccounts: parseJsonArray(account.bankAccounts),
  };
}

function isMaterializedAccount(account: { name: string | null; contact: Record<string, unknown> }): boolean {
  const name = String(account.name || '').trim();
  if (!name || name === 'New Submission' || name === 'Auto Quote (In Progress)') return false;

  const first = String(account.contact.firstName || '').trim();
  const last = String(account.contact.lastName || '').trim();
  const email = String(account.contact.email || '').trim();
  const phone = String(account.contact.phone || '').trim();
  return Boolean(first && last && email && phone);
}

function encodeCursor(payload: AccountCursor): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(token: string, sortField: 'name' | 'createdAt'): AccountCursor | null {
  const t = String(token || '').trim();
  if (!t) return null;
  try {
    const raw = Buffer.from(t, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (sortField === 'name') {
      const result = CursorByNameSchema.safeParse(parsed);
      return result.success ? { kind: 'name', ...result.data } : null;
    }
    const result = CursorByCreatedAtSchema.safeParse(parsed);
    return result.success ? { kind: 'createdAt', ...result.data } : null;
  } catch {
    return null;
  }
}

function encodeIntelligenceCursor(payload: AccountIntelligenceCursor): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeIntelligenceCursor(token?: string): AccountIntelligenceCursor | null {
  const t = String(token || '').trim();
  if (!t) return null;
  try {
    const raw = Buffer.from(t, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as AccountIntelligenceCursor;
  } catch {
    return null;
  }
}

/**
 * GET /api/accounts
 * List policy holders (Accounts)
 */
router.get('/', accountsAuditLog, async (req, res) => {
  try {
    const query = ListAccountsQuerySchema.parse(req.query);
    const cursorToken = String(query.cursor || '').trim();
    const useCursor = Boolean(cursorToken || query.mode === 'recordList' || typeof query.limit !== 'undefined' || typeof query.sortField !== 'undefined');
    const take = Math.min(100, Math.max(1, query.limit || query.pageSize || 50));
    const q = String(query.search || '').trim();

    const baseWhere = q
      ? {
          OR: [
            { name: { contains: q } },
            { contact: { contains: q } },
          ],
        }
      : {};

    if (useCursor) {
      const sortField = query.sortField || 'createdAt';
      const sortDir = query.sortDir || 'desc';
      const decoded = decodeCursor(cursorToken, sortField);
      const collected: Array<ReturnType<typeof formatAccountForResponse>> = [];
      let safety = 0;
      let cursorState = decoded;

      while (collected.length < take + 1 && safety < 6) {
        safety += 1;
        let where: Record<string, unknown> = { ...baseWhere };

        if (cursorState) {
          if (sortField === 'name' && cursorState.kind === 'name') {
            if (sortDir === 'asc') {
              where = {
                ...where,
                AND: [
                  ...(Array.isArray((where as { AND?: unknown[] }).AND) ? (where as { AND?: unknown[] }).AND || [] : []),
                  {
                    OR: [
                      { name: { gt: cursorState.name } },
                      { AND: [{ name: cursorState.name }, { id: { gt: cursorState.id } }] },
                    ],
                  },
                ],
              };
            } else {
              where = {
                ...where,
                AND: [
                  ...(Array.isArray((where as { AND?: unknown[] }).AND) ? (where as { AND?: unknown[] }).AND || [] : []),
                  {
                    OR: [
                      { name: { lt: cursorState.name } },
                      { AND: [{ name: cursorState.name }, { id: { lt: cursorState.id } }] },
                    ],
                  },
                ],
              };
            }
          } else if (sortField === 'createdAt' && cursorState.kind === 'createdAt') {
            const createdAt = new Date(cursorState.createdAt);
            if (!Number.isNaN(createdAt.getTime())) {
              if (sortDir === 'asc') {
                where = {
                  ...where,
                  AND: [
                    ...(Array.isArray((where as { AND?: unknown[] }).AND) ? (where as { AND?: unknown[] }).AND || [] : []),
                    {
                      OR: [
                        { createdAt: { gt: createdAt } },
                        { AND: [{ createdAt }, { id: { gt: cursorState.id } }] },
                      ],
                    },
                  ],
                };
              } else {
                where = {
                  ...where,
                  AND: [
                    ...(Array.isArray((where as { AND?: unknown[] }).AND) ? (where as { AND?: unknown[] }).AND || [] : []),
                    {
                      OR: [
                        { createdAt: { lt: createdAt } },
                        { AND: [{ createdAt }, { id: { lt: cursorState.id } }] },
                      ],
                    },
                  ],
                };
              }
            }
          }
        }

        const orderBy =
          sortField === 'name'
            ? [{ name: sortDir }, { id: sortDir }]
            : [{ createdAt: sortDir }, { id: sortDir }];

        const batch = await tenantScopedPrisma.policyHolder.findMany({
          where,
          take: Math.max(80, take * 3),
          orderBy,
          include: {
            policies: { select: { id: true, policyNumber: true, status: true } },
          },
        });

        if (!batch.length) break;

        const formatted = batch.map((acc) =>
          formatAccountForResponse({
            ...acc,
            contact: acc.contact,
            bankAccounts: acc.bankAccounts,
          })
        );

        for (const item of formatted) {
          if (!isMaterializedAccount({ name: String(item.name || ''), contact: item.contact })) continue;
          collected.push(item);
          if (collected.length >= take + 1) break;
        }

        const lastRaw = formatted[formatted.length - 1];
        if (!lastRaw) break;

        cursorState =
          sortField === 'name'
            ? { kind: 'name', name: String(lastRaw.name || ''), id: String(lastRaw.id || '') }
            : {
                kind: 'createdAt',
                createdAt: lastRaw.createdAt instanceof Date ? lastRaw.createdAt.toISOString() : '',
                id: String(lastRaw.id || ''),
              };

        if (formatted.length < Math.max(80, take * 3)) break;
      }

      const hasMore = collected.length > take;
      const items = collected.slice(0, take);
      const last = items[items.length - 1];
      const nextCursor = last
        ? encodeCursor(
            (query.sortField || 'createdAt') === 'name'
              ? { kind: 'name', name: String(last.name || ''), id: String(last.id || '') }
              : {
                  kind: 'createdAt',
                  createdAt: last.createdAt instanceof Date ? last.createdAt.toISOString() : '',
                  id: String(last.id || ''),
                }
          )
        : null;

      const total = await tenantScopedPrisma.policyHolder.count({
        where: {
          AND: [
            ...(Object.keys(baseWhere).length ? [baseWhere] : []),
            { name: { notIn: ['New Submission', 'Auto Quote (In Progress)'] } },
            { contact: { contains: '"email"' } },
            { contact: { contains: '"phone"' } },
          ],
        },
      });

      return res.json({
        success: true,
        data: { items, hasMore, nextCursor, total },
      });
    }

    const skip = (query.page - 1) * query.pageSize;
    const [accounts, total] = await Promise.all([
      tenantScopedPrisma.policyHolder.findMany({
        where: baseWhere,
        skip,
        take: query.pageSize,
        orderBy: { name: 'asc' },
        include: {
          policies: { select: { id: true, policyNumber: true, status: true } },
        },
      }),
      tenantScopedPrisma.policyHolder.count({ where: baseWhere }),
    ]);

    const formattedAccounts = accounts
      .map((acc) =>
        formatAccountForResponse({
          ...acc,
          contact: acc.contact,
          bankAccounts: acc.bankAccounts,
        })
      )
      .filter((acc) => isMaterializedAccount({ name: String(acc.name || ''), contact: acc.contact }));

    return res.json({
      success: true,
      data: formattedAccounts,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 400, 'VALIDATION_ERROR', error.issues[0]?.message || 'Invalid query');
    }
    return sendError(res, 500, 'SERVER_ERROR', errorMessage(error, 'Failed to list accounts'));
  }
});

router.get('/intelligence', accountsAuditLog, async (req, res) => {
  try {
    const query = ListAccountIntelligenceQuerySchema.parse(req.query);
    const take = Math.min(100, Math.max(1, Number(query.limit || 20)));
    const sortField = query.sortField || 'state';
    const sortDir = query.sortDir || (sortField === 'state' ? 'asc' : 'desc');
    const q = String(query.search || '').trim();
    const decoded = decodeIntelligenceCursor(query.cursor);

    const andFilters: Array<Record<string, unknown>> = [];
    if (q) {
      andFilters.push(buildAccountIntelligenceSearchWhere(q));
    }

    if (decoded?.accountId) {
      if (sortField === 'state' && typeof decoded.statePriority === 'number') {
        andFilters.push(
          sortDir === 'asc'
            ? {
                OR: [
                  { statePriority: { gt: decoded.statePriority } },
                  {
                    AND: [
                      { statePriority: decoded.statePriority },
                      { accountId: { gt: decoded.accountId } },
                    ],
                  },
                ],
              }
            : {
                OR: [
                  { statePriority: { lt: decoded.statePriority } },
                  {
                    AND: [
                      { statePriority: decoded.statePriority },
                      { accountId: { lt: decoded.accountId } },
                    ],
                  },
                ],
              }
        );
      } else if (sortField === 'lastActivityAt') {
        const cursorDate = decoded.lastActivityAt ? new Date(String(decoded.lastActivityAt)) : null;
        if (cursorDate && !Number.isNaN(cursorDate.getTime())) {
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
      } else if (sortField === 'totalPremium' && typeof decoded.totalPremium === 'number') {
        andFilters.push(
          sortDir === 'asc'
            ? {
                OR: [
                  { totalPremium: { gt: decoded.totalPremium } },
                  { AND: [{ totalPremium: decoded.totalPremium }, { accountId: { gt: decoded.accountId } }] },
                ],
              }
            : {
                OR: [
                  { totalPremium: { lt: decoded.totalPremium } },
                  { AND: [{ totalPremium: decoded.totalPremium }, { accountId: { lt: decoded.accountId } }] },
                ],
              }
        );
      } else if (sortField === 'accountName' && decoded.accountName) {
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
      }
    }

    const where = andFilters.length > 0 ? { AND: andFilters } : {};
    const orderBy =
      sortField === 'state'
        ? [{ statePriority: sortDir }, { lastActivityAt: 'desc' as const }, { accountId: 'asc' as const }]
        : sortField === 'lastActivityAt'
          ? [{ lastActivityAt: sortDir }, { accountId: sortDir }]
          : sortField === 'totalPremium'
            ? [{ totalPremium: sortDir }, { accountId: sortDir }]
            : [{ accountName: sortDir }, { accountId: sortDir }];

    const [rows, total] = await Promise.all([
      tenantScopedPrisma.accountIntelligenceProjection.findMany({
        where,
        orderBy,
        take: take + 1,
      }),
      tenantScopedPrisma.accountIntelligenceProjection.count({
        where: buildAccountIntelligenceSearchWhere(q),
      }),
    ]);

    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const last = items[items.length - 1];
    const nextCursor = last
      ? encodeIntelligenceCursor({
          accountId: last.accountId,
          statePriority: last.statePriority,
          lastActivityAt: last.lastActivityAt ? last.lastActivityAt.toISOString() : null,
          totalPremium: Number(last.totalPremium || 0),
          accountName: last.accountName,
        })
      : null;

    return res.json({
      success: true,
      data: { items, hasMore, nextCursor, total },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 400, 'VALIDATION_ERROR', error.issues[0]?.message || 'Invalid query');
    }
    return sendError(res, 500, 'SERVER_ERROR', errorMessage(error, 'Failed to list account intelligence'));
  }
});

router.get('/:id/intelligence', accountsAuditLog, async (req, res) => {
  try {
    const { id } = AccountIdParamsSchema.parse(req.params);
    const row = await tenantScopedPrisma.accountIntelligenceProjection.findUnique({ where: { accountId: id } });
    if (!row) {
      return sendError(res, 404, 'NOT_FOUND', 'Account intelligence not found');
    }
    return res.json({ success: true, data: row });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 400, 'VALIDATION_ERROR', error.issues[0]?.message || 'Invalid id');
    }
    return sendError(res, 500, 'SERVER_ERROR', errorMessage(error, 'Failed to load account intelligence'));
  }
});

/**
 * POST /api/accounts
 * Create a new Policy Holder
 */
router.post('/', accountsAuditLog, async (req, res) => {
  try {
    const body = CreateAccountBodySchema.parse(req.body);

    const newAccount = await tenantScopedPrisma.policyHolder.create({
      data: {
        name: body.name,
        segment: body.segment,
        address: body.address,
        contact: JSON.stringify(body.contact),
        bankAccounts: JSON.stringify(body.bankAccounts || []),
      } as unknown as Prisma.PolicyHolderUncheckedCreateInput,
    });
    await enqueueAccountProjectionRefreshByAccountId(prisma, newAccount.id);

    return res.status(201).json({
      success: true,
      data: {
        ...newAccount,
        contact: body.contact,
        bankAccounts: body.bankAccounts || [],
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 400, 'VALIDATION_ERROR', error.issues[0]?.message || 'Invalid request body');
    }
    return sendError(res, 500, 'CREATE_ERROR', errorMessage(error, 'Failed to create account'));
  }
});

/**
 * GET /api/accounts/:id
 * Get single account details
 */
router.get('/:id', accountsAuditLog, async (req, res) => {
  try {
    const { id } = AccountIdParamsSchema.parse(req.params);
    const account = await tenantScopedPrisma.policyHolder.findUnique({
      where: { id },
      include: { policies: true },
    });

    if (!account) {
      return sendError(res, 404, 'NOT_FOUND', 'Account not found');
    }

    return res.json({
      success: true,
      data: {
        ...account,
        contact: parseJsonRecord(account.contact),
        bankAccounts: parseJsonArray(account.bankAccounts),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 400, 'VALIDATION_ERROR', error.issues[0]?.message || 'Invalid account id');
    }
    return sendError(res, 500, 'SERVER_ERROR', errorMessage(error, 'Failed to get account'));
  }
});

/**
 * PUT /api/accounts/:id
 * Update account details
 */
router.put('/:id', accountsAuditLog, async (req, res) => {
  try {
    const { id } = AccountIdParamsSchema.parse(req.params);
    const body = UpdateAccountBodySchema.parse(req.body);

    const updatedAccount = await tenantScopedPrisma.policyHolder.update({
      where: { id },
      data: {
        name: body.name,
        segment: body.segment,
        address: body.address,
        contact: body.contact ? JSON.stringify(body.contact) : undefined,
        bankAccounts: body.bankAccounts ? JSON.stringify(body.bankAccounts) : undefined,
      },
    });
    await enqueueAccountProjectionRefreshByAccountId(prisma, updatedAccount.id);

    return res.json({
      success: true,
      data: {
        ...updatedAccount,
        contact: body.contact || parseJsonRecord(updatedAccount.contact),
        bankAccounts: body.bankAccounts || parseJsonArray(updatedAccount.bankAccounts),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 400, 'VALIDATION_ERROR', error.issues[0]?.message || 'Invalid request');
    }
    return sendError(res, 500, 'UPDATE_ERROR', errorMessage(error, 'Failed to update account'));
  }
});

/**
 * DELETE /api/accounts/:id
 * Delete account (Policy Holder)
 */
router.delete('/:id', accountsAuditLog, async (req, res) => {
  try {
    const { id } = AccountIdParamsSchema.parse(req.params);
    await tenantScopedPrisma.policyHolder.delete({ where: { id } });
    await enqueueAccountProjectionRefreshByAccountId(prisma, id);
    return res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 400, 'VALIDATION_ERROR', error.issues[0]?.message || 'Invalid account id');
    }
    return sendError(res, 500, 'DELETE_ERROR', errorMessage(error, 'Failed to delete account'));
  }
});

export default router;

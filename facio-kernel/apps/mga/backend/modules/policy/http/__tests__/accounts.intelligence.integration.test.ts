import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
const count = vi.fn();
const findUnique = vi.fn();

vi.mock('../../../../platform/db/connection.js', () => {
  const prisma = {
    accountIntelligenceProjection: {
      findMany,
      count,
      findUnique,
    },
    policyHolder: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  return { prisma, tenantScopedPrisma: prisma };
});

async function withServer(
  app: express.Express,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to resolve server address');
    await run(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

describe('GET /accounts/intelligence integration', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns cursor payload with priority-state sorting', async () => {
    const now = new Date('2026-04-03T12:00:00.000Z');
    findMany.mockResolvedValue([
      {
        accountId: 'acc-1',
        accountName: 'Alpha Transport',
        state: 'PAYMENT_ISSUE',
        statePriority: 1,
        lastActivityAt: now,
        totalPremium: 1200,
      },
      {
        accountId: 'acc-2',
        accountName: 'Bravo Trading',
        state: 'CLAIM',
        statePriority: 2,
        lastActivityAt: new Date('2026-04-02T12:00:00.000Z'),
        totalPremium: 900,
      },
    ]);
    count.mockResolvedValue(2);

    const { default: router } = await import('../accountsRouter.js');
    const app = express();
    app.use('/accounts', router);

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/accounts/intelligence?limit=1&sortField=state&sortDir=asc&search=alpha`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        success: boolean;
        data: { items: unknown[]; hasMore: boolean; nextCursor: string | null; total: number };
      };
      expect(json.success).toBe(true);
      expect(json.data.items).toHaveLength(1);
      expect(json.data.hasMore).toBe(true);
      expect(typeof json.data.nextCursor).toBe('string');
      expect(json.data.total).toBe(2);
    });

    const expectedSearchWhere = {
      OR: [
        { accountName: { contains: 'alpha', mode: 'insensitive' } },
        { secondaryIdentity: { contains: 'alpha', mode: 'insensitive' } },
        { searchTerms: { contains: 'alpha', mode: 'insensitive' } },
      ],
    };
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [expectedSearchWhere] },
      take: 2,
      orderBy: [{ statePriority: 'asc' }, { lastActivityAt: 'desc' }, { accountId: 'asc' }],
    }));
    expect(count).toHaveBeenCalledWith(expect.objectContaining({
      where: expectedSearchWhere,
    }));
  });

  it('returns single-account intelligence by accountId', async () => {
    const now = new Date('2026-04-03T12:00:00.000Z');
    findUnique.mockResolvedValue({
      accountId: 'acc-1',
      accountName: 'Alpha Transport',
      state: 'PAYMENT_ISSUE',
      stateReasons: ['OVERDUE_PAYMENT'],
      lastActivityAt: now,
    });

    const { default: router } = await import('../accountsRouter.js');
    const app = express();
    app.use('/accounts', router);

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/accounts/acc-1/intelligence`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        success: boolean;
        data: { accountId: string; state: string; stateReasons: string[] };
      };
      expect(json.success).toBe(true);
      expect(json.data.accountId).toBe('acc-1');
      expect(json.data.state).toBe('PAYMENT_ISSUE');
      expect(json.data.stateReasons).toContain('OVERDUE_PAYMENT');
    });
  });
});

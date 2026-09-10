import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  PRODUCT_CHANNEL_CODES,
  resolveAllProductChannels,
  resolveProductChannel,
} from '../resolveProductChannel.js';

const findFirstMock = vi.fn();
const findManyMock = vi.fn();

vi.mock('../../../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    productChannelSetting: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

describe('resolveProductChannel (ADR-0046)', () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    findManyMock.mockReset();
  });

  it('falls back to the in-code default when no row exists (payment OFF for motor)', async () => {
    findFirstMock.mockResolvedValue(null);
    const channel = await resolveProductChannel('MOTOR');
    expect(channel).toEqual({ questions: true, quote: true, payment: false });
  });

  it('defaults travel to fully online when no row exists', async () => {
    findFirstMock.mockResolvedValue(null);
    expect(await resolveProductChannel('TRAVEL')).toEqual({ questions: true, quote: true, payment: true });
  });

  it('defaults home to fully online (payment ON) when no row exists (ADR-0046 amendment)', async () => {
    findFirstMock.mockResolvedValue(null);
    expect(await resolveProductChannel('HOME')).toEqual({ questions: true, quote: true, payment: true });
  });

  it('normalises the product code (case-insensitive)', async () => {
    findFirstMock.mockResolvedValue(null);
    expect(await resolveProductChannel('travel')).toEqual({ questions: true, quote: true, payment: true });
  });

  it('uses the DB row when present (row wins over default)', async () => {
    findFirstMock.mockResolvedValue({
      questionsEnabled: true,
      quoteEnabled: false,
      paymentEnabled: false,
    });
    expect(await resolveProductChannel('MOTOR')).toEqual({ questions: true, quote: false, payment: false });
  });

  it('keeps payment closed for an unrecognised product', async () => {
    findFirstMock.mockResolvedValue(null);
    expect(await resolveProductChannel('NONEXISTENT')).toEqual({ questions: true, quote: true, payment: false });
  });

  it('resolveAllProductChannels merges defaults with rows for every known product', async () => {
    findManyMock.mockResolvedValue([
      { productCode: 'MOTOR', questionsEnabled: false, quoteEnabled: false, paymentEnabled: false },
    ]);
    const all = await resolveAllProductChannels();
    for (const code of PRODUCT_CHANNEL_CODES) {
      expect(all[code]).toBeDefined();
    }
    // Row override applied.
    expect(all.MOTOR).toEqual({ questions: false, quote: false, payment: false });
    // Default applied where no row.
    expect(all.TRAVEL).toEqual({ questions: true, quote: true, payment: true });
    expect(all.OPEN_MARKET).toEqual({ questions: true, quote: false, payment: false });
  });
});

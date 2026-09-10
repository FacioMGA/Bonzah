import { describe, expect, it, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  communicationThread: {
    findFirst: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  policyHolder: {
    findUnique: vi.fn(),
  },
}));

const executeMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../platform/db/connection.js', () => ({
  prisma: prismaMock,
  tenantScopedPrisma: prismaMock,
}));

vi.mock('../commands/sendMessageCommand.js', () => ({
  SendMessageCommand: class {
    execute = (...args: unknown[]) => executeMock(...args);
  },
}));

import {
  ACCOUNT_CLIENT_NOTE_RECIPIENT,
  createAccountClientNote,
  isAccountClientNoteMessage,
  listAccountClientNotes,
} from '../accountClientNotes.js';

describe('accountClientNotes (ABY-466)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.policyHolder.findUnique.mockResolvedValue({ id: 'acc_1' });
  });

  it('flags messages stamped with accountClientNote in externalRefs', () => {
    expect(isAccountClientNoteMessage({ externalRefs: { accountClientNote: true } })).toBe(true);
    expect(isAccountClientNoteMessage({ externalRefs: {} })).toBe(false);
    expect(isAccountClientNoteMessage({ externalRefs: null })).toBe(false);
  });

  it('lists only stamped client notes on the account thread', async () => {
    prismaMock.communicationThread.findFirst.mockResolvedValue({
      messages: [
        {
          id: 'note_1',
          body: 'Called client about renewal',
          fromActor: 'user_1',
          createdAt: new Date('2026-08-19T10:00:00.000Z'),
          externalRefs: { accountClientNote: true },
        },
        {
          id: 'note_dm',
          body: 'DM to Peter',
          fromActor: 'user_2',
          createdAt: new Date('2026-08-19T11:00:00.000Z'),
          externalRefs: {},
        },
      ],
    });
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'user_1', name: 'Danny', email: 'danny@abbeygate.cy' },
    ]);

    const rows = await listAccountClientNotes('acc_1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('note_1');
    expect(rows[0]?.author?.email).toBe('danny@abbeygate.cy');
  });

  it('does not read a thread until the account is in the active tenant', async () => {
    prismaMock.policyHolder.findUnique.mockResolvedValue(null);

    await expect(listAccountClientNotes('foreign_account')).rejects.toThrow('Account not found');
    expect(prismaMock.communicationThread.findFirst).not.toHaveBeenCalled();
  });

  it('creates a shared client note on the ACCOUNT thread', async () => {
    executeMock.mockResolvedValue({
      id: 'note_new',
      body: 'VIP client — prefers email',
      createdAt: new Date('2026-08-19T12:00:00.000Z'),
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user_1',
      name: 'Peter',
      email: 'peter@abbeygate.cy',
    });

    const row = await createAccountClientNote({
      accountId: 'acc_1',
      body: 'VIP client — prefers email',
      fromActor: 'user_1',
    });

    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'ACCOUNT',
      entityId: 'acc_1',
      channel: 'NOTE',
      communicationType: 'INTERNAL_NOTE',
      toRecipients: [ACCOUNT_CLIENT_NOTE_RECIPIENT],
      externalRefs: { accountClientNote: true },
      body: 'VIP client — prefers email',
    }));
    expect(row.id).toBe('note_new');
    expect(row.author?.name).toBe('Peter');
  });

  it('does not append a note to an account outside the active tenant', async () => {
    prismaMock.policyHolder.findUnique.mockResolvedValue(null);

    await expect(createAccountClientNote({
      accountId: 'foreign_account',
      body: 'Do not save this',
      fromActor: 'user_1',
    })).rejects.toThrow('Account not found');
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('rejects empty note bodies', async () => {
    await expect(createAccountClientNote({
      accountId: 'acc_1',
      body: '   ',
      fromActor: 'user_1',
    })).rejects.toThrow('Note body is required');
  });
});

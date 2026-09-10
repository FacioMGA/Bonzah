/**
 * Account client notes — staff-visible notes on a client (policy holder) file.
 *
 * Stored on the ACCOUNT communication thread with `externalRefs.accountClientNote`
 * so they are shared with all staff in the tenant (not staff-to-staff DMs).
 */
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
import { SendMessageCommand } from './commands/sendMessageCommand.js';

export const ACCOUNT_CLIENT_NOTE_RECIPIENT = '@account-staff';

export type AccountClientNoteRow = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string | null; email: string } | null;
};

export function isAccountClientNoteMessage(message: {
  externalRefs?: unknown;
}): boolean {
  const refs = parseRecord(message.externalRefs);
  return refs.accountClientNote === true;
}

/**
 * Communication threads are not themselves tenant-scoped.  The PolicyHolder
 * is the canonical tenant-scoped owner of an ACCOUNT thread, so prove that
 * ownership before any thread lookup or message append.
 */
async function assertActiveTenantAccount(accountId: string): Promise<void> {
  const account = await tenantScopedPrisma.policyHolder.findUnique({
    where: { id: accountId },
    select: { id: true },
  });
  if (!account) {
    throw new Error('Account not found');
  }
}

export async function listAccountClientNotes(accountId: string): Promise<AccountClientNoteRow[]> {
  await assertActiveTenantAccount(accountId);
  const thread = await tenantScopedPrisma.communicationThread.findFirst({
    where: { entityType: 'ACCOUNT', entityId: accountId },
    include: {
      messages: {
        where: {
          channel: 'NOTE',
          communicationType: 'INTERNAL_NOTE',
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!thread) return [];

  const notes = thread.messages.filter(isAccountClientNoteMessage);
  const authorIds = [...new Set(
    notes
      .map((message) => String(message.fromActor || '').trim())
      .filter((id) => id && id !== 'system' && id !== 'SYSTEM'),
  )];

  const authors = authorIds.length
    ? await prisma.user.findMany({
      where: { id: { in: authorIds } },
      select: { id: true, name: true, email: true },
    })
    : [];
  const authorById = new Map(authors.map((user) => [user.id, user]));

  return notes.map((message) => {
    const authorId = String(message.fromActor || '').trim();
    const author = authorById.get(authorId) || null;
    return {
      id: message.id,
      body: String(message.body || ''),
      createdAt: message.createdAt.toISOString(),
      author: author
        ? { id: author.id, name: author.name, email: author.email }
        : null,
    };
  });
}

export async function createAccountClientNote(args: {
  accountId: string;
  body: string;
  fromActor: string;
}): Promise<AccountClientNoteRow> {
  const trimmed = String(args.body || '').trim();
  if (!trimmed) {
    throw new Error('Note body is required');
  }

  await assertActiveTenantAccount(args.accountId);

  const command = new SendMessageCommand();
  const message = await command.execute({
    entityType: 'ACCOUNT',
    entityId: args.accountId,
    direction: 'INTERNAL',
    channel: 'NOTE',
    provider: 'SYSTEM',
    communicationType: 'INTERNAL_NOTE',
    fromActor: args.fromActor,
    toRecipients: [ACCOUNT_CLIENT_NOTE_RECIPIENT],
    body: trimmed,
    status: 'LOGGED',
    externalRefs: { accountClientNote: true },
  });

  const author = await prisma.user.findUnique({
    where: { id: args.fromActor },
    select: { id: true, name: true, email: true },
  });

  return {
    id: message.id,
    body: String(message.body || trimmed),
    createdAt: message.createdAt.toISOString(),
    author: author
      ? { id: author.id, name: author.name, email: author.email }
      : null,
  };
}

import type { Prisma } from '@prisma/client';

export function buildAccountIntelligenceSearchWhere(q: string): Prisma.AccountIntelligenceProjectionWhereInput {
  const trimmed = String(q || '').trim();
  if (!trimmed) return {};
  const digitsOnly = trimmed.replace(/\D/g, '');
  const indexedSearchTerms = digitsOnly.length >= 6 && digitsOnly !== trimmed
    ? [trimmed, digitsOnly]
    : [trimmed];
  return {
    OR: [
      { accountName: { contains: trimmed, mode: 'insensitive' } },
      { secondaryIdentity: { contains: trimmed, mode: 'insensitive' } },
      ...indexedSearchTerms.map((term) => ({ searchTerms: { contains: term, mode: 'insensitive' as const } })),
    ],
  };
}

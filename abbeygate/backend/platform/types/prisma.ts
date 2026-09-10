/**
 * Curated re-exports of Prisma type primitives used by `backend/modules/**`.
 *
 * `backend/modules/<m>/domain/**` may not import from `@prisma/client`
 * directly (see `tools/quality/check-domain-purity.mjs`). Domain code that
 * needs a Prisma `Unchecked*Input` shape — typically when persisting an
 * event row built up from primitives — must import the named alias from
 * here. Adding a new alias is the right move when a new domain module
 * needs one, because the alias preserves Prisma's generated typing while
 * keeping the coupling to `@prisma/client` confined to this single file
 * inside `platform/`.
 */
import type { Prisma } from '@prisma/client';

export type PrismaTransactionClient = Prisma.TransactionClient;
export type PrismaInputJsonValue = Prisma.InputJsonValue;

export type PrismaClaimEventUncheckedCreateInput =
  Prisma.ClaimEventUncheckedCreateInput;
export type PrismaClaimProjectionSnapshotUncheckedCreateInput =
  Prisma.ClaimProjectionSnapshotUncheckedCreateInput;

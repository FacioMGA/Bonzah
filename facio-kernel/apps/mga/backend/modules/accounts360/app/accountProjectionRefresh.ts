import type { Prisma } from '@prisma/client';
import {
  enqueueAccounts360ProjectionUpdate,
  rebuildAccount360Projection,
} from '../infra/projections/accounts360Projection.js';
import {
  enqueueAccountIntelligenceProjectionUpdate,
  rebuildAccountIntelligenceProjection,
} from '../infra/projections/accountIntelligenceProjection.js';

type OutboxDb = {
  outbox?: {
    create?: (args: { data: Prisma.OutboxUncheckedCreateInput }) => Promise<unknown>;
  };
};

type PolicyLookupDb = OutboxDb & {
  policy: {
    findUnique: (args: { where: { id: string }; select: { policyHolderId: true } }) => Promise<{ policyHolderId: string | null } | null>;
  };
};

type ClaimLookupDb = OutboxDb & {
  claim: {
    findUnique: (args: {
      where: { id: string };
      select: { policy: { select: { policyHolderId: true } } };
    }) => Promise<{ policy: { policyHolderId: string | null } | null } | null>;
  };
};

export async function enqueueAccountProjectionRefreshByAccountId(db: OutboxDb, accountId?: string | null) {
  const id = String(accountId || '').trim();
  if (!id) return;
  await enqueueAccounts360ProjectionUpdate(db, id);
  await enqueueAccountIntelligenceProjectionUpdate(db, id);
}

export async function rebuildAccountProjectionsNow(accountId?: string | null) {
  const id = String(accountId || '').trim();
  if (!id) return;
  await rebuildAccount360Projection(id);
  await rebuildAccountIntelligenceProjection(id);
}

export async function enqueueAccountProjectionRefreshByPolicyId(db: PolicyLookupDb, policyId?: string | null) {
  const id = String(policyId || '').trim();
  if (!id) return;
  const policy = await db.policy.findUnique({
    where: { id },
    select: { policyHolderId: true },
  });
  await enqueueAccountProjectionRefreshByAccountId(db, policy?.policyHolderId);
}

export async function enqueueAccountProjectionRefreshByClaimId(db: ClaimLookupDb, claimId?: string | null) {
  const id = String(claimId || '').trim();
  if (!id) return;
  const claim = await db.claim.findUnique({
    where: { id },
    select: { policy: { select: { policyHolderId: true } } },
  });
  await enqueueAccountProjectionRefreshByAccountId(db, claim?.policy?.policyHolderId);
}

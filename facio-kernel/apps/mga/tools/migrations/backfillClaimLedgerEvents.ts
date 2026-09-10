import 'dotenv/config';
import { prisma } from '../backend/db/connection.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function main() {
  const claims = await prisma.claim.findMany({
    include: {
      reserves: { orderBy: { occurredAt: 'asc' } },
      events: true,
    },
  });
  let created = 0;
  for (const claim of claims) {
    if (claim.events.length > 0) continue;
    let version = 1;
    const claimData = asRecord(claim.data);
    await prisma.claimEvent.create({
      data: {
        claimId: claim.id,
        eventType: 'CLAIM_OPENED',
        aggregateType: 'CLAIM',
        aggregateId: claim.id,
        aggregateVersion: version++,
        payload: {
          cr0029_certificate_reference: String(claimData.cr0029_certificate_reference || ''),
          cr0119_date_of_loss_from: claim.incidentDate.toISOString().slice(0, 10),
          cr0116_loss_country: String(claimData.cr0116_loss_country || ''),
          cr0109_original_currency: String(claimData.cr0109_original_currency || 'EUR'),
        },
        occurredAt: claim.reportedDate,
        actorType: 'SYSTEM',
        actorId: 'backfill',
        actorName: 'Backfill',
        causationId: 'BACKFILL',
      },
    });
    for (const tx of claim.reserves) {
      const type = String(tx.type || '').toUpperCase();
      const eventType =
        type === 'PAID' ? 'PAYMENT_ADDED'
          : type === 'RECOVERY' ? 'RECOVERY_RECEIVED'
            : 'RESERVE_SET';
      await prisma.claimEvent.create({
        data: {
          claimId: claim.id,
          eventType,
          aggregateType: 'CLAIM',
          aggregateId: claim.id,
          aggregateVersion: version++,
          payload: {
            bucket: 'INDEMNITY',
            ...(eventType === 'RESERVE_SET'
              ? {
                newOutstandingAmount: Number(tx.amount || 0),
                effectiveDate: tx.occurredAt.toISOString().slice(0, 10),
                reasonCode: 'BACKFILL',
              }
              : eventType === 'PAYMENT_ADDED'
                ? {
                  amount: Number(tx.amount || 0),
                  paymentDate: tx.occurredAt.toISOString().slice(0, 10),
                  paymentType: 'INTERIM',
                  payeeType: 'CLAIMANT',
                  autoReduceReserve: false,
                }
                : {
                  amount: Number(tx.amount || 0),
                  recoveryDate: tx.occurredAt.toISOString().slice(0, 10),
                }),
          },
          occurredAt: tx.occurredAt,
          actorType: 'SYSTEM',
          actorId: String(tx.createdByUserId || 'backfill'),
          actorName: 'Backfill',
          causationId: 'BACKFILL',
        },
      });
    }
    if (String(claim.status || '').toUpperCase() === 'CLOSED') {
      await prisma.claimEvent.create({
        data: {
          claimId: claim.id,
          eventType: 'CLAIM_CLOSED',
          aggregateType: 'CLAIM',
          aggregateId: claim.id,
          aggregateVersion: version++,
          payload: { closedAt: claim.updatedAt.toISOString().slice(0, 10) },
          occurredAt: claim.updatedAt,
          actorType: 'SYSTEM',
          actorId: 'backfill',
          actorName: 'Backfill',
          causationId: 'BACKFILL',
        },
      });
    }
    created += 1;
  }
  // eslint-disable-next-line no-console
  console.log(`[claim-ledger-backfill] claims processed=${claims.length}, initialized=${created}`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

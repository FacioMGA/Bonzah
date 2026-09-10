import { prisma } from '../../backend/platform/db/connection.js';
import { derivePremiumFinancials } from '../../backend/modules/policy/domain/premiumFinancials.js';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function migrateQuoteResponseCostDetails(quoteResponse: unknown): { changed: boolean; next: unknown } {
  const root = asRecord(quoteResponse);
  const primary = asRecord(root.primaryOption);
  const cost = asRecord(primary.costDetails);
  if (!Object.keys(cost).length) return { changed: false, next: quoteResponse };

  let changed = false;
  const nextCost: UnknownRecord = { ...cost };

  if ((nextCost.mifSurcharge === undefined || nextCost.mifSurcharge === null) && nextCost.tax !== undefined) {
    nextCost.mifSurcharge = nextCost.tax;
    changed = true;
  }
  if (nextCost.tax !== undefined) {
    delete nextCost.tax;
    changed = true;
  }
  if (nextCost.governmentTax !== undefined) {
    delete nextCost.governmentTax;
    changed = true;
  }
  if ((nextCost.stampDuty === undefined || nextCost.stampDuty === null) && nextCost.policyFee !== undefined) {
    nextCost.stampDuty = nextCost.policyFee;
    changed = true;
  }

  if (!changed) return { changed: false, next: quoteResponse };
  return {
    changed: true,
    next: {
      ...root,
      primaryOption: {
        ...primary,
        costDetails: nextCost,
      },
    },
  };
}

async function backfillQuoteResponseShapes() {
  const policies = await prisma.policy.findMany({
    select: { id: true, quoteResponse: true },
    take: 50_000,
  });
  let policyUpdates = 0;
  for (const policy of policies) {
    const migrated = migrateQuoteResponseCostDetails(policy.quoteResponse);
    if (!migrated.changed) continue;
    await prisma.policy.update({
      where: { id: policy.id },
      data: { quoteResponse: migrated.next as object },
    });
    policyUpdates += 1;
  }

  const states = await prisma.policyStateCurrent.findMany({
    select: { policyId: true, snapshot: true },
    take: 50_000,
  });
  let stateUpdates = 0;
  for (const state of states) {
    const snapshot = asRecord(state.snapshot);
    const migrated = migrateQuoteResponseCostDetails(snapshot.quoteResponse);
    if (!migrated.changed) continue;
    await prisma.policyStateCurrent.update({
      where: { policyId: state.policyId },
      data: {
        snapshot: {
          ...snapshot,
          quoteResponse: migrated.next,
        },
      },
    });
    stateUpdates += 1;
  }

  const txs = await prisma.riskTransaction.findMany({
    select: { id: true, pricingFinal: true, snapshotDraft: true, snapshotFinal: true },
    take: 100_000,
  });
  let pricingUpdates = 0;
  let snapshotDraftUpdates = 0;
  let snapshotFinalUpdates = 0;
  for (const tx of txs) {
    const pricingFinal = asRecord(tx.pricingFinal);
    const draft = asRecord(tx.snapshotDraft);
    const final = asRecord(tx.snapshotFinal);

    const migratedPricing = migrateQuoteResponseCostDetails(pricingFinal.quoteResponse);
    const migratedDraft = migrateQuoteResponseCostDetails(draft.quoteResponse);
    const migratedFinal = migrateQuoteResponseCostDetails(final.quoteResponse);

    if (!migratedPricing.changed && !migratedDraft.changed && !migratedFinal.changed) continue;
    await prisma.riskTransaction.update({
      where: { id: tx.id },
      data: {
        ...(migratedPricing.changed ? { pricingFinal: { ...pricingFinal, quoteResponse: migratedPricing.next } } : {}),
        ...(migratedDraft.changed ? { snapshotDraft: { ...draft, quoteResponse: migratedDraft.next } } : {}),
        ...(migratedFinal.changed ? { snapshotFinal: { ...final, quoteResponse: migratedFinal.next } } : {}),
      },
    });
    if (migratedPricing.changed) pricingUpdates += 1;
    if (migratedDraft.changed) snapshotDraftUpdates += 1;
    if (migratedFinal.changed) snapshotFinalUpdates += 1;
  }

  return { policyUpdates, stateUpdates, pricingUpdates, snapshotDraftUpdates, snapshotFinalUpdates };
}

async function backfillPremiumTransactions() {
  const rows = await prisma.premiumTransaction.findMany({
    include: {
      riskTransaction: {
        include: {
          policy: {
            include: {
              binder: { include: { financials: true } },
            },
          },
        },
      },
    },
    take: 100_000,
  });

  let updated = 0;
  for (const row of rows) {
    const policy = asRecord(row.riskTransaction?.policy);
    const binder = asRecord(policy.binder);
    const binderFinancials = asRecord(binder.financials);
    const pricingFinal = asRecord(row.riskTransaction?.pricingFinal);
    const quoteResponse = pricingFinal.quoteResponse || policy.quoteResponse;
    const grossPremium = Number(row.grossPremium || 0);

    const next = derivePremiumFinancials({
      grossPremium,
      quoteResponse,
      binder,
      binderFinancials,
      riskTransactionType: row.riskTransaction?.transactionType,
      premiumTransactionType: row.transactionType,
    });

    const prev = {
      commissionPercent: round2(Number(row.commissionPercent || 0)),
      commissionAmount: round2(Number(row.commissionAmount || 0)),
      taxesTotal: round2(Number(row.taxesTotal || 0)),
      feesTotal: round2(Number(row.feesTotal || 0)),
      netToLondon: round2(Number(row.netToLondon || 0)),
    };

    const hasDiff =
      prev.commissionPercent !== next.commissionPercent ||
      prev.commissionAmount !== next.commissionAmount ||
      prev.taxesTotal !== next.taxesTotal ||
      prev.feesTotal !== next.feesTotal ||
      prev.netToLondon !== next.netToLondon;
    if (!hasDiff) continue;

    await prisma.premiumTransaction.update({
      where: { id: row.id },
      data: {
        commissionPercent: next.commissionPercent,
        commissionAmount: next.commissionAmount,
        taxesTotal: next.taxesTotal,
        feesTotal: next.feesTotal,
        netToLondon: next.netToLondon,
      },
    });
    updated += 1;
  }
  return { updated, scanned: rows.length };
}

async function main() {
  const quoteShape = await backfillQuoteResponseShapes();
  const premiumTx = await backfillPremiumTransactions();
  process.stdout.write(
    `Backfill complete. ` +
    `quoteShape=${JSON.stringify(quoteShape)} ` +
    `premiumTransactions=${JSON.stringify(premiumTx)}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});


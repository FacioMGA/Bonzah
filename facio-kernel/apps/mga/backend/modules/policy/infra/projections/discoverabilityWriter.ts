import { resolveProductDiscoverability } from '../../app/discoverability/registry.js';
import { logger } from '../../../../platform/utils/logger.js';

type UnknownRecord = Record<string, unknown>;
const asCallable = (value: unknown): ((args: unknown) => Promise<unknown>) | null =>
  typeof value === 'function' ? (value as (args: unknown) => Promise<unknown>) : null;

const readDelegate = (db: object, key: string): UnknownRecord => asRecord(Reflect.get(db, key));

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function statusSortRankFor(statusRaw: string): number {
  const status = String(statusRaw || '').toUpperCase();
  if (status === 'CANCELLATION_REQUESTED') return 10;
  if (status === 'INFO_REQUIRED') return 20;
  if (status === 'REFERRAL') return 30;
  if (status === 'AWAITING_PAYMENT') return 40;
  if (status === 'BOUND' || status === 'BOUND_DRAFT_ISSUED') return 50;
  if (status === 'QUOTED' || status === 'QUOTE') return 60;
  if (status === 'INTAKE') return 70;
  if (status === 'DRAFT') return 80;
  if (status === 'ISSUED') return 90;
  if (status === 'ACTIVE') return 100;
  if (status === 'EXPIRED') return 110;
  if (status === 'DECLINED') return 120;
  if (status === 'CANCELLED' || status === 'CANCELED') return 130;
  return 999;
}

export async function upsertPolicyListDiscoverabilityRow(db: object, policyId: string): Promise<boolean> {
  const pid = String(policyId || '').trim();
  if (!pid) return false;
  const policyFindUnique = asCallable(readDelegate(db, 'policy').findUnique);
  const policyListIndexFindUnique = asCallable(readDelegate(db, 'policyListIndex').findUnique);
  const policyListIndexUpsert = asCallable(readDelegate(db, 'policyListIndex').upsert);
  if (!policyFindUnique || !policyListIndexUpsert) return false;

  const policyRaw = await policyFindUnique({
    where: { id: pid },
    include: {
      policyHolder: { select: { name: true, address: true, contact: true } },
    },
  });
  const policy = asRecord(policyRaw);
  if (!policy.id) return false;
  const operatingTenantId = String(policy.operatingTenantId || '').trim();

  const status = String(policy.status || 'DRAFT').toUpperCase();
  const boStatus = String(policy.bo_status || status).toUpperCase();
  const policyUpdatedAt = policy.updatedAt ? new Date(String(policy.updatedAt)) : new Date();
  const now = new Date();

  // ── SLA 3: determine whether bo_status has changed since last projection ──
  // Read the existing row to compare bo_status for SLA tracking.
  // Use the caller-provided delegate so projection writes inside bind/issue flows
  // share the same transaction and operating-tenant context as the policy write.
  // The SLA read remains best-effort; if the delegate lacks findUnique or the
  // column is unavailable during a migration window, the projection still upserts.
  let existingRaw: unknown = null;
  try {
    existingRaw = policyListIndexFindUnique
      ? await policyListIndexFindUnique({
          where: { policyId: pid },
          select: { bo_status: true, bo_status_changed_at: true },
        })
      : null;
  } catch (colErr) {
    // P2022 = column not found; any schema error is safe to swallow here
    // since this is best-effort SLA tracking and the upsert below still runs.
    logger.warn(
      { policyId: pid, err: colErr },
      'policy_list.bo_status_changed_at_read_failed — column may not exist yet; treating as new row',
    );
  }
  const existing = asRecord(existingRaw || {});
  const previousBoStatus = existing.bo_status ? String(existing.bo_status).toUpperCase() : null;
  const boStatusChangedAt: Date =
    previousBoStatus !== null && previousBoStatus === boStatus && existing.bo_status_changed_at
      ? new Date(String(existing.bo_status_changed_at))  // preserve — status has NOT changed
      : now;                                              // reset — status changed or row is new
  const productProjection = resolveProductDiscoverability({
    productType: String(policy.productType || ''),
    status,
    inceptionDate: policy.inceptionDate ? new Date(String(policy.inceptionDate)) : null,
    expiryDate: policy.expiryDate ? new Date(String(policy.expiryDate)) : null,
    quoteData: policy.quoteData,
    quoteResponse: policy.quoteResponse,
    vehicleInfo: policy.vehicleInfo,
    policyHolder: {
      name: String(asRecord(policy.policyHolder).name || '').trim() || null,
      address: String(asRecord(policy.policyHolder).address || '').trim() || null,
      contact: asRecord(policy.policyHolder).contact,
    },
  });

  const createData = {
    policyId: pid,
    operatingTenantId,
    policyNumber: String(policy.policyNumber || ''),
    status,
    bo_status: boStatus,
    statusSortRank: statusSortRankFor(status),
    bo_statusSortRank: statusSortRankFor(boStatus),
    updatedAt: policyUpdatedAt,
    lastActivityAt: policyUpdatedAt,
    insuredName: productProjection.insuredName,
    insuredDisplay: productProjection.insuredDisplay,
    vehicleDisplay: productProjection.vehicleDisplay,
    policyholderDisplay: productProjection.policyholderDisplay,
    policyholderEmail: productProjection.policyholderEmail,
    policyholderPhone: productProjection.policyholderPhone,
    coverageStart: productProjection.coverageStart,
    coverageEnd: productProjection.coverageEnd,
    vehicleSearch: productProjection.vehicleSearch,
    address: productProjection.address,
    segment: productProjection.segment,
    totalPremium: productProjection.totalPremium,
    renewalDate: productProjection.renewalDate,
    quoteExpiryDate: productProjection.quoteExpiryDate,
    bo_status_changed_at: boStatusChangedAt,
    indexVersion: 1,
  };

  const updateData = {
    policyNumber: String(policy.policyNumber || ''),
    status,
    bo_status: boStatus,
    statusSortRank: statusSortRankFor(status),
    bo_statusSortRank: statusSortRankFor(boStatus),
    updatedAt: policyUpdatedAt,
    lastActivityAt: policyUpdatedAt,
    insuredName: productProjection.insuredName,
    insuredDisplay: productProjection.insuredDisplay,
    vehicleDisplay: productProjection.vehicleDisplay,
    policyholderDisplay: productProjection.policyholderDisplay,
    policyholderEmail: productProjection.policyholderEmail,
    policyholderPhone: productProjection.policyholderPhone,
    coverageStart: productProjection.coverageStart,
    coverageEnd: productProjection.coverageEnd,
    vehicleSearch: productProjection.vehicleSearch,
    address: productProjection.address,
    segment: productProjection.segment,
    totalPremium: productProjection.totalPremium,
    renewalDate: productProjection.renewalDate,
    quoteExpiryDate: productProjection.quoteExpiryDate,
    bo_status_changed_at: boStatusChangedAt,
    indexVersion: { increment: 1 },
  };

  try {
    await policyListIndexUpsert({
      where: { policyId: pid },
      create: createData,
      update: updateData,
    });
    const hasCoverageWindow = Boolean(productProjection.coverageStart && productProjection.coverageEnd);
    const hasQuoteWindow = Boolean(productProjection.quoteExpiryDate);
    const displayComplete = Boolean(
      productProjection.insuredDisplay &&
      productProjection.vehicleDisplay &&
      productProjection.policyholderDisplay &&
      (hasCoverageWindow || hasQuoteWindow),
    );
    logger.info(
      {
        policyId: pid,
        productType: String(policy.productType || '').toUpperCase(),
        channel: 'tx_discoverability',
        displayComplete,
      },
      'policy_list.tx_discoverability_upserted',
    );
    return true;
  } catch (error) {
    logger.error(
      { policyId: pid, productType: String(policy.productType || '').toUpperCase(), channel: 'tx_discoverability', err: error },
      'policy_list.tx_discoverability_upsert_failed',
    );
    throw error;
  }
}


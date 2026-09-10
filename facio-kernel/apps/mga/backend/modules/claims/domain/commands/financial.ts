import type { CommandContext } from './shared.js';
import {
  actorAuthorityLimit,
  appendClaimEvent,
  asRecord,
  enforceAuthorityOrRequireReferral,
  normalizeBucket,
  requireMovementReason,
  toMoney,
} from './shared.js';
import { getClaimCounterpartyById } from '../../app/claimCounterpartyService.js';
import {
  derivePaymentClassificationFromLegacyBucket,
  deriveLegacyPayeeRoleFromPayeeType,
  getClaimPaymentEligibilityRule,
  legacyPayeeTypeFromRole,
  normalizeClaimCostCategory,
  normalizeClaimCostSubType,
  normalizePayeeRoleCode,
  resolvePayeeRoleUsed,
} from '../paymentClassification.js';

type DispatchResult = { handled: boolean; shortCircuit?: boolean };

const DENIAL_REASON_TO_CODE: Record<string, string> = {
  NO_POLICY_COVER: 'DEN_NO_COVER',
  EXCLUSION_APPLIES: 'DEN_EXCLUSION',
  POLICY_NOT_IN_FORCE: 'DEN_NOT_IN_FORCE',
  NON_DISCLOSURE_MISREPRESENTATION: 'DEN_NON_DISCLOSURE',
  BREACH_OF_POLICY_CONDITIONS: 'DEN_BREACH_COND',
  FRAUD_SUSPECTED_CONFIRMED: 'DEN_FRAUD',
  DUPLICATE_CLAIM: 'DEN_DUPLICATE',
  NO_INSURED_LOSS_ESTABLISHED: 'DEN_NO_LOSS',
  OTHER: 'DEN_OTHER',
};

function resolveCanonicalPaymentClassification(payload: Record<string, unknown>) {
  const fallbackBucket = normalizeBucket(payload.bucket);
  const costCategory = normalizeClaimCostCategory(payload.costCategory);
  const costSubType = normalizeClaimCostSubType(payload.costSubType);
  if (costCategory && costSubType) {
    const rule = getClaimPaymentEligibilityRule(costCategory, costSubType);
    if (!rule) throw new Error('Invalid claim payment classification');
    return rule;
  }
  const derived = derivePaymentClassificationFromLegacyBucket(fallbackBucket);
  const rule = getClaimPaymentEligibilityRule(derived.costCategory, derived.costSubType);
  if (!rule) throw new Error('Invalid claim payment classification');
  return rule;
}

async function resolvePayeeSnapshot(ctx: CommandContext, args: {
  costCategory: ReturnType<typeof resolveCanonicalPaymentClassification>['costCategory'];
  costSubType: ReturnType<typeof resolveCanonicalPaymentClassification>['costSubType'];
  allowedPayeeRoles: ReturnType<typeof resolveCanonicalPaymentClassification>['allowedPayeeRoles'];
}) {
  const payeeCounterpartyId = String(ctx.payload.payeeCounterpartyId || '').trim();
  if (payeeCounterpartyId) {
    const payeeCounterparty = await getClaimCounterpartyById(ctx.tx, ctx.claim.id, payeeCounterpartyId);
    if (!payeeCounterparty) {
      throw new Error('Invalid payee role for selected claim payment classification.');
    }
    const payeeRoleUsed = resolvePayeeRoleUsed({
      costCategory: args.costCategory,
      costSubType: args.costSubType,
      availableRoles: payeeCounterparty.roles,
      requestedRole: ctx.payload.payeeRoleUsed,
    });
    if (!payeeRoleUsed || !args.allowedPayeeRoles.includes(payeeRoleUsed)) {
      throw new Error('Invalid payee role for selected claim payment classification.');
    }
    return {
      payeeCounterpartyId: payeeCounterparty.id,
      payeeRoleUsed,
      payeeName: payeeCounterparty.name,
      payeeType: legacyPayeeTypeFromRole(payeeRoleUsed),
    };
  }

  const requestedRole = normalizePayeeRoleCode(ctx.payload.payeeRoleUsed)
    || deriveLegacyPayeeRoleFromPayeeType(ctx.payload.payeeType)
    || args.allowedPayeeRoles[0];
  if (!requestedRole || !args.allowedPayeeRoles.includes(requestedRole)) {
    throw new Error('Invalid payee role for selected claim payment classification.');
  }
  return {
    payeeCounterpartyId: undefined,
    payeeRoleUsed: requestedRole,
    payeeName: String(ctx.payload.payeeName || ''),
    payeeType: legacyPayeeTypeFromRole(requestedRole),
  };
}

export async function handleFinancialCommands(ctx: CommandContext): Promise<DispatchResult> {
  if (ctx.type === 'SET_RESERVE') {
    const movement = requireMovementReason(ctx.payload, 'Reserve movement');
    const bucket = normalizeBucket(ctx.payload.bucket);
    const amount = toMoney(ctx.payload.newOutstandingAmount ?? ctx.payload.amount);
    if (amount < 0) throw new Error('Outstanding amount must be >= 0');
    if (ctx.projection.withdrawnAt) throw new Error('Cannot set reserve for withdrawn claim');
    const bucketState = asRecord((ctx.projection.buckets as Record<string, unknown>)[bucket]);
    const previousOutstanding = toMoney(bucketState.outstanding);
    if (amount < toMoney(bucketState.paid)) throw new Error('Cannot set outstanding below paid amount');
    await enforceAuthorityOrRequireReferral({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      projection: ctx.projection,
      postMovementIncurred: ctx.projection.totalIncurred + (amount - previousOutstanding),
      reasonCode: movement.reasonCode,
      explanation: movement.explanation,
      settlementAuthorityLimit: ctx.governance.settlementAuthorityLimit,
      governanceSource: ctx.governance.source,
    });
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'RESERVE_SET',
      payload: {
        bucket,
        newOutstandingAmount: amount,
        reasonCode: movement.reasonCode,
        explanation: movement.explanation,
        internalNote: String(ctx.payload.internalNote || ''),
        effectiveDate: String(ctx.payload.effectiveDate || new Date().toISOString().slice(0, 10)),
        authoritySnapshot: {
          userAuthorityLimit: actorAuthorityLimit(ctx.input.actorType, ctx.governance.settlementAuthorityLimit),
          wasReferralTriggered: false,
        },
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'ADJUST_RESERVE') {
    const movement = requireMovementReason(ctx.payload, 'Reserve adjustment');
    const bucket = normalizeBucket(ctx.payload.bucket);
    const delta = toMoney(ctx.payload.deltaAmount ?? ctx.payload.amount);
    if (delta === 0) throw new Error('Reserve adjustment delta must not be 0');
    if (ctx.projection.withdrawnAt) throw new Error('Cannot adjust reserve for withdrawn claim');
    const bucketState = asRecord((ctx.projection.buckets as Record<string, unknown>)[bucket]);
    const previousOutstanding = toMoney(bucketState.outstanding);
    const paidAmount = toMoney(bucketState.paid);
    const newOutstandingAmount = toMoney(previousOutstanding + delta);
    if (newOutstandingAmount < 0) throw new Error('Outstanding amount must be >= 0 after adjustment');
    if (newOutstandingAmount < paidAmount) throw new Error('Cannot set outstanding below paid amount');
    await enforceAuthorityOrRequireReferral({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      projection: ctx.projection,
      postMovementIncurred: ctx.projection.totalIncurred + delta,
      reasonCode: movement.reasonCode,
      explanation: movement.explanation,
      settlementAuthorityLimit: ctx.governance.settlementAuthorityLimit,
      governanceSource: ctx.governance.source,
    });
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'RESERVE_ADJ',
      payload: {
        bucket,
        deltaAmount: delta,
        previousOutstandingAmount: previousOutstanding,
        newOutstandingAmount,
        reasonCode: movement.reasonCode,
        explanation: movement.explanation,
        internalNote: String(ctx.payload.internalNote || ''),
        effectiveDate: String(ctx.payload.effectiveDate || new Date().toISOString().slice(0, 10)),
        authoritySnapshot: {
          userAuthorityLimit: actorAuthorityLimit(ctx.input.actorType, ctx.governance.settlementAuthorityLimit),
          wasReferralTriggered: false,
        },
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'ADD_PAYMENT') {
    const movement = requireMovementReason(ctx.payload, 'Payment movement');
    if (ctx.projection.withdrawnAt) throw new Error('Cannot pay withdrawn claim');
    if (ctx.projection.denied && !Boolean(ctx.payload.allowOnRepudiated)) throw new Error('Cannot pay repudiated claim');
    const classification = resolveCanonicalPaymentClassification(ctx.payload);
    if (classification.requiresInvoiceReference && !String(ctx.payload.invoiceReference || ctx.payload.reference || '').trim()) {
      throw new Error('invoiceReference is required for selected claim payment classification');
    }
    if (classification.requiresNote && !String(ctx.payload.note || ctx.payload.explanation || ctx.payload.reason || '').trim()) {
      throw new Error('note is required for selected claim payment classification');
    }
    if (ctx.payload.indemnityAmount !== undefined || ctx.payload.feesAmount !== undefined) {
      throw new Error('Use amount with costCategory and costSubType for claim payments');
    }
    const payeeSnapshot = await resolvePayeeSnapshot(ctx, classification);
    const bucket = classification.operationalBucket;
    const amount = toMoney(ctx.payload.amount);
    if (amount <= 0) throw new Error('Payment amount must be > 0');
    const bucketState = asRecord((ctx.projection.buckets as Record<string, unknown>)[bucket]);
    const currentOutstanding = toMoney(bucketState.outstanding);
    const strictMode = ctx.payload.strictMode !== false;
    if (strictMode && amount > currentOutstanding && !Boolean(ctx.payload.allowOutstandingOverride)) {
      throw new Error('Payment exceeds outstanding in strict mode');
    }
    await enforceAuthorityOrRequireReferral({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      projection: ctx.projection,
      postMovementIncurred: ctx.projection.totalIncurred + amount,
      reasonCode: movement.reasonCode,
      explanation: movement.explanation,
      settlementAuthorityLimit: ctx.governance.settlementAuthorityLimit,
      governanceSource: ctx.governance.source,
    });
    const paymentDate = String(ctx.payload.paymentDate || new Date().toISOString().slice(0, 10));
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'PAYMENT_ADDED',
      payload: {
        bucket,
        amount,
        paymentDate,
        paymentType: String(ctx.payload.paymentType || 'INTERIM'),
        payeeType: payeeSnapshot.payeeType,
        payeeCounterpartyId: payeeSnapshot.payeeCounterpartyId,
        payeeRoleUsed: payeeSnapshot.payeeRoleUsed,
        payeeName: payeeSnapshot.payeeName,
        costCategory: classification.costCategory,
        costSubType: classification.costSubType,
        reportingTreatment: classification.reportingTreatment,
        reference: String(ctx.payload.reference || ''),
        invoiceReference: String(ctx.payload.invoiceReference || ''),
        note: String(ctx.payload.note || ''),
        reasonCode: movement.reasonCode,
        explanation: movement.explanation,
        paymentApprovalUserId: String(ctx.payload.paymentApprovalUserId || ctx.input.actorId || ''),
        paymentExecutionUserId: String(ctx.payload.paymentExecutionUserId || ctx.input.actorId || ''),
        bankReference: String(ctx.payload.bankReference || ''),
        authoritySnapshot: {
          userAuthorityLimit: actorAuthorityLimit(ctx.input.actorType, ctx.governance.settlementAuthorityLimit),
          wasReferralTriggered: false,
        },
        autoReduceReserve: false,
      },
    });
    if (ctx.payload.overrideOutstanding !== undefined && ctx.payload.overrideOutstanding !== null) {
      const overrideOutstanding = toMoney(ctx.payload.overrideOutstanding);
      if (overrideOutstanding < 0) throw new Error('overrideOutstanding must be >= 0');
      await appendClaimEvent({
        tx: ctx.tx,
        claimId: ctx.claim.id,
        claimNumber: ctx.claimNumber,
        command: 'SET_RESERVE',
        input: ctx.input,
        eventType: 'RESERVE_SET',
        payload: {
          bucket,
          newOutstandingAmount: overrideOutstanding,
          reasonCode: String(ctx.payload.overrideReasonCode || 'PAYMENT_ADJUSTMENT_OVERRIDE'),
          reason: String(ctx.payload.overrideReason || 'Payment adjustment override'),
          effectiveDate: paymentDate,
        },
      });
    }
    return { handled: true };
  }

  if (ctx.type === 'SET_RECOVERY_EXPECTED') {
    const movement = requireMovementReason(ctx.payload, 'Recovery expected movement');
    const amount = toMoney(ctx.payload.amount ?? ctx.payload.expectedAmount);
    if (amount <= 0) throw new Error('Expected recovery amount must be > 0');
    if (amount > ctx.projection.totalIncurred && !Boolean(ctx.payload.allowAboveIncurred)) {
      throw new Error('Expected recovery cannot exceed incurred');
    }
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'RECOVERY_EXPECTED',
      payload: {
        bucket: normalizeBucket(ctx.payload.bucket, 'INDEMNITY'),
        amount,
        recoveryType: String(ctx.payload.recoveryType || 'SUBROGATION'),
        expectedDate: String(ctx.payload.expectedDate || ctx.payload.effectiveDate || new Date().toISOString().slice(0, 10)),
        note: String(ctx.payload.note || ''),
        reasonCode: movement.reasonCode,
        explanation: movement.explanation,
        authoritySnapshot: {
          userAuthorityLimit: actorAuthorityLimit(ctx.input.actorType, ctx.governance.settlementAuthorityLimit),
          wasReferralTriggered: false,
        },
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'ADD_RECOVERY_RECEIVED') {
    const movement = requireMovementReason(ctx.payload, 'Recovery received movement');
    const amount = toMoney(ctx.payload.amount);
    if (amount <= 0) throw new Error('Recovery received amount must be > 0');
    if (amount > ctx.projection.totalIncurred && !Boolean(ctx.payload.allowAboveIncurred)) {
      throw new Error('Recovery received cannot exceed incurred');
    }
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'RECOVERY_RECEIVED',
      payload: {
        bucket: normalizeBucket(ctx.payload.bucket, 'INDEMNITY'),
        amount,
        recoveryType: String(ctx.payload.recoveryType || 'SUBROGATION'),
        recoveryDate: String(ctx.payload.recoveryDate || new Date().toISOString().slice(0, 10)),
        reference: String(ctx.payload.reference || ''),
        note: String(ctx.payload.note || ''),
        reasonCode: movement.reasonCode,
        explanation: movement.explanation,
        authoritySnapshot: {
          userAuthorityLimit: actorAuthorityLimit(ctx.input.actorType, ctx.governance.settlementAuthorityLimit),
          wasReferralTriggered: false,
        },
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'DENY_CLAIM') {
    if (ctx.projection.totalPaid > 0) {
      throw new Error('Cannot deny claim after payments have been issued');
    }
    if (ctx.projection.totalOutstanding > 0) {
      throw new Error('Cannot deny claim while outstanding reserve exists. Release reserve first.');
    }
    const denialReason = String(ctx.payload.denialReason || '').trim().toUpperCase();
    if (!denialReason) throw new Error('denialReason is required');
    const reasonCode = DENIAL_REASON_TO_CODE[denialReason] || DENIAL_REASON_TO_CODE.OTHER;
    const summary = String(ctx.payload.summary || '').trim();
    if (!summary) throw new Error('summary is required');
    const note = String(ctx.payload.note || '').trim();
    const deniedAt = new Date().toISOString();
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'CLAIM_DENIED',
      payload: {
        denialReason,
        reasonCode,
        summary,
        note,
        deniedAt,
        communicationRequired: 'DENIAL_LETTER',
      },
    });
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'DENIAL_COMMUNICATION_REQUIRED',
      payload: {
        communicationType: 'DENIAL_LETTER',
        requiredAt: deniedAt,
        summary,
      },
    });
    return { handled: true };
  }

  return { handled: false };
}


import type { DevFormState, DevelopmentType } from '@/src/modules/claims/model/worksheetTypes';

function toNumber(v: string): number {
  const raw = String(v || '').trim();
  if (!raw) return 0;
  const normalized = raw.replace(/,/g, '');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

const RESERVE_REASON_CODE_BY_BUCKET: Record<string, string> = {
  INDEMNITY: 'RES_IND',
  DEFENCE_COSTS: 'RES_DEF',
  ADJUSTER_FEES: 'RES_ADJ',
  LEGAL_FEES: 'RES_LEG',
  OTHER: 'RES_OTH',
};

const PAYMENT_REASON_SEGMENT_BY_BUCKET: Record<string, string> = {
  INDEMNITY: 'IND',
  DEFENCE_COSTS: 'DEF',
  ADJUSTER_FEES: 'ADJ',
  LEGAL_FEES: 'LEG',
  OTHER: 'OTH',
};

const RECOVERY_REASON_SEGMENT_BY_BUCKET: Record<string, string> = {
  INDEMNITY: 'IND',
  DEFENCE_COSTS: 'DEF',
  ADJUSTER_FEES: 'ADJ',
  LEGAL_FEES: 'LEG',
  OTHER: 'OTH',
};

const RECOVERY_REASON_SEGMENT_BY_SOURCE: Record<string, string> = {
  THIRD_PARTY_INSURER: 'TPI',
  THIRD_PARTY: 'TP',
  SALVAGE: 'SALV',
  DEDUCTIBLE: 'DED',
  REINSURANCE: 'REIN',
  OTHER: 'OTH',
};

const RECOVERY_RECEIVED_REASON_BY_BUCKET: Record<string, string> = {
  INDEMNITY: 'REC_IND',
  DEFENCE_COSTS: 'REC_DEF',
  ADJUSTER_FEES: 'REC_ADJ',
  LEGAL_FEES: 'REC_LEG',
  OTHER: 'REC_OTH',
};

const CLOSURE_REASON_CODE_BY_REASON: Record<string, string> = {
  SETTLED: 'CLS_SETTLED',
  SETTLED_WITHOUT_PAYMENT: 'CLS_NO_PAYMENT',
  INSURED_WITHDREW_CLAIM: 'CLS_WITHDRAWN',
  CLAIM_REPORTED_IN_ERROR: 'CLS_REPORTED_ERROR',
  DUPLICATE_CLAIM: 'CLS_DUPLICATE',
  NO_FURTHER_ACTION_REQUIRED: 'CLS_NO_FURTHER_ACTION',
  ADMINISTRATIVE_CLOSURE: 'CLS_ADMIN',
  OTHER: 'CLS_OTHER',
};

const REOPEN_REASON_CODE_BY_REASON: Record<string, string> = {
  NEW_INFORMATION_RECEIVED: 'ROP_NEW_INFO',
  ADDITIONAL_DAMAGE_DISCOVERED: 'ROP_ADD_DAMAGE',
  CLAIM_REOPENED_BY_REQUEST: 'ROP_REQUEST',
  RECOVERY_ACTIVITY_RESUMED: 'ROP_RESUMED',
  CLOSURE_MADE_IN_ERROR: 'ROP_ERROR',
  OTHER: 'ROP_OTHER',
};

function toPositiveAmount(v: string): number {
  return Math.max(0, toNumber(v));
}

function derivePaymentReasonCode(bucketRaw: string, paymentTypeRaw: string): string {
  const bucket = String(bucketRaw || 'OTHER').trim().toUpperCase();
  const bucketSegment = PAYMENT_REASON_SEGMENT_BY_BUCKET[bucket] || PAYMENT_REASON_SEGMENT_BY_BUCKET.OTHER;
  const paymentType = String(paymentTypeRaw || 'INTERIM').trim().toUpperCase();
  const typeSegment = paymentType === 'FINAL' ? 'FIN' : 'INT';
  return `PAY_${bucketSegment}_${typeSegment}`;
}

function derivePaymentBucket(costCategory: DevFormState['costCategory'], costSubType: DevFormState['costSubType']): string {
  if (costCategory === 'indemnity' && costSubType === 'defence_fee') return 'DEFENCE_COSTS';
  if (costCategory === 'fees' && costSubType === 'adjuster_fee') return 'ADJUSTER_FEES';
  if (costCategory === 'fees' && costSubType === 'attorney_coverage_fee') return 'LEGAL_FEES';
  if (costCategory === 'fees') return 'OTHER';
  return 'INDEMNITY';
}

function deriveRecoveryExpectedReasonCode(bucketRaw: string, sourceRaw: string): string {
  const bucket = String(bucketRaw || 'OTHER').trim().toUpperCase();
  const source = String(sourceRaw || 'OTHER').trim().toUpperCase();
  const bucketSegment = RECOVERY_REASON_SEGMENT_BY_BUCKET[bucket] || RECOVERY_REASON_SEGMENT_BY_BUCKET.OTHER;
  const sourceSegment = RECOVERY_REASON_SEGMENT_BY_SOURCE[source] || RECOVERY_REASON_SEGMENT_BY_SOURCE.OTHER;
  return `REC_EXP_${bucketSegment}_${sourceSegment}`;
}

function deriveRecoveryReceivedReasonCode(bucketRaw: string): string {
  const bucket = String(bucketRaw || 'OTHER').trim().toUpperCase();
  return RECOVERY_RECEIVED_REASON_BY_BUCKET[bucket] || RECOVERY_RECEIVED_REASON_BY_BUCKET.OTHER;
}

export function buildDevelopmentPayload(commandType: DevelopmentType, devForm: DevFormState): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (commandType === 'SET_RESERVE') {
    const bucket = String(devForm.bucket || 'OTHER').trim().toUpperCase();
    payload.bucket = bucket;
    payload.newOutstandingAmount = toPositiveAmount(devForm.amount);
    payload.reasonCode = RESERVE_REASON_CODE_BY_BUCKET[bucket] || RESERVE_REASON_CODE_BY_BUCKET.OTHER;
    payload.explanation = String(devForm.reason || '').trim() || 'Reserve update';
  } else if (commandType === 'ADJUST_RESERVE') {
    const bucket = String(devForm.bucket || 'OTHER').trim().toUpperCase();
    payload.bucket = bucket;
    payload.deltaAmount = toNumber(devForm.amount);
    payload.reasonCode = RESERVE_REASON_CODE_BY_BUCKET[bucket] || RESERVE_REASON_CODE_BY_BUCKET.OTHER;
    payload.explanation = String(devForm.reason || '').trim() || 'Reserve adjustment';
  } else if (commandType === 'ADD_PAYMENT') {
    const bucket = derivePaymentBucket(devForm.costCategory, devForm.costSubType);
    const paymentType = String(devForm.paymentType || 'INTERIM').trim().toUpperCase();
    payload.bucket = bucket;
    payload.costCategory = devForm.costCategory;
    payload.costSubType = devForm.costSubType;
    payload.amount = toNumber(devForm.amount);
    payload.paymentType = paymentType;
    payload.payeeCounterpartyId = String(devForm.payeeCounterpartyId || '').trim();
    payload.reference = devForm.reference;
    payload.invoiceReference = String(devForm.invoiceReference || '').trim();
    payload.reasonCode = derivePaymentReasonCode(bucket, paymentType);
    payload.explanation = String(devForm.reason || '').trim() || 'Payment issued';
    if (paymentType === 'FINAL') {
      payload.overrideOutstanding = 0;
      payload.overrideReasonCode = 'PAYMENT_FINAL_ZERO_OUTSTANDING';
      payload.overrideReason = 'Final payment reduces remaining reserve to zero';
    } else if (devForm.overrideOutstanding.trim()) {
      payload.overrideOutstanding = toNumber(devForm.overrideOutstanding);
    }
  } else if (commandType === 'SET_RECOVERY_EXPECTED') {
    const bucket = String(devForm.bucket || 'OTHER').trim().toUpperCase();
    const recoveryType = String(devForm.recoveryType || 'OTHER').trim().toUpperCase();
    payload.bucket = bucket;
    payload.amount = toNumber(devForm.amount);
    payload.recoveryType = recoveryType;
    payload.reasonCode = deriveRecoveryExpectedReasonCode(bucket, recoveryType);
    payload.explanation = String(devForm.reason || '').trim() || 'Expected recovery recorded';
  } else if (commandType === 'ADD_RECOVERY_RECEIVED') {
    const bucket = String(devForm.bucket || 'OTHER').trim().toUpperCase();
    const recoveryType = String(devForm.recoveryType || 'OTHER').trim().toUpperCase();
    payload.bucket = bucket;
    payload.amount = toNumber(devForm.amount);
    payload.recoveryType = recoveryType;
    payload.reference = devForm.reference;
    payload.reasonCode = deriveRecoveryReceivedReasonCode(bucket);
    payload.explanation = String(devForm.reason || '').trim() || 'Recovery received';
  } else if (commandType === 'CREATE_APPOINTMENT') {
    payload.appointeeType = String(devForm.appointeeType || '').trim().toUpperCase();
    payload.appointee = String(devForm.appointee || '').trim();
    payload.instruction = String(devForm.instruction || '').trim();
  } else if (commandType === 'DENY_CLAIM') {
    const denialReason = String(devForm.denialReason || 'OTHER').trim().toUpperCase();
    const reasonCodeMap: Record<string, string> = {
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
    payload.denialReason = denialReason;
    payload.reasonCode = reasonCodeMap[denialReason] || reasonCodeMap.OTHER;
    payload.summary = String(devForm.summary || '').trim();
    payload.note = String(devForm.reason || '').trim();
  } else if (commandType === 'CLOSE') {
    const closureReason = String(devForm.closureReason || 'OTHER').trim().toUpperCase();
    payload.closureReason = closureReason;
    payload.reasonCode = CLOSURE_REASON_CODE_BY_REASON[closureReason] || CLOSURE_REASON_CODE_BY_REASON.OTHER;
    payload.summary = String(devForm.summary || '').trim();
    payload.note = String(devForm.reason || '').trim();
  } else if (commandType === 'REOPEN') {
    const reopenReason = String(devForm.reopenReason || 'OTHER').trim().toUpperCase();
    payload.reopenReason = reopenReason;
    payload.reasonCode = REOPEN_REASON_CODE_BY_REASON[reopenReason] || REOPEN_REASON_CODE_BY_REASON.OTHER;
    payload.summary = String(devForm.summary || '').trim();
    payload.note = String(devForm.reason || '').trim();
  } else if (commandType === 'ADD_CLAIM_NOTE') {
    payload.note = String(devForm.reason || '').trim();
  } else if (commandType === 'ADD_CLAIM_EVIDENCE') {
    payload.documentType = String(devForm.documentType || 'OTHER').trim().toUpperCase();
    payload.note = String(devForm.reason || '').trim();
    payload.fileId = String(devForm.reference || '').trim();
    payload.originalFilename = String(devForm.appointee || '').trim();
    payload.fileUrl = String(devForm.instruction || '').trim();
  }
  return payload;
}


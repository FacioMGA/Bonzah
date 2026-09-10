// Layer façade: re-exports the canonical risk-transaction-type
// constants from the domain layer so HTTP routers can consume them
// without violating the http→app→domain boundary enforced by
// `tools/quality/check-backend-layer-imports.mjs`.
//
// Do not move these definitions back here — domain stays canonical.
export {
  ISSUANCE_TRANSACTION_TYPES,
  POLICY_CHANGE_TRANSACTION_TYPES,
  VERSION_HISTORY_TRANSACTION_TYPES,
  isEndorsementTransactionType,
  isIssuanceTransactionType,
  isPolicyChangeTransactionType,
  isRenewalTransactionType,
  isVersionHistoryTransactionType,
} from '../domain/riskTransactionTypes.js';

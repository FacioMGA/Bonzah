/**
 * Claim Worksheet Command Types — Domain Contract
 *
 * These belong to the Claims domain, not to the transport kernel.
 * Extracted from httpTransport.ts to enforce CHAMPS ownership.
 */

/** All supported claim worksheet command types */
export type ClaimWorksheetCommandType =
    | 'SUBMIT_FNOL'
    | 'SUBMIT_FNOL_FINAL'
    | 'CONFIRM_FNOL'
    | 'REQUEST_FNOL_CLARIFICATION'
    | 'FNOL_CLARIFICATION_RECEIVED'
    | 'AMEND_FNOL'
    | 'APPROVE_REFERRAL'
    | 'LINK_POLICY'
    | 'UPDATE_SUMMARY'
    | 'SET_RESERVE'
    | 'ADJUST_RESERVE'
    | 'ADD_PAYMENT'
    | 'SET_RECOVERY_EXPECTED'
    | 'ADD_RECOVERY_RECEIVED'
    | 'DENY_CLAIM'
    | 'CREATE_APPOINTMENT'
    | 'ADD_CLAIM_NOTE'
    | 'ADD_CLAIM_EVIDENCE'
    | 'SET_REFERRAL'
    | 'CLOSE'
    | 'REOPEN'
    | 'WITHDRAW'
    | 'ACKNOWLEDGE_CLAIM'
    | 'CREATE_DIARY_ITEM'
    | 'COMPLETE_DIARY_ITEM'
    | 'INSTRUCT_FIELD_ADJUSTER'
    | 'RECORD_ADJUSTER_REPORT'
    | 'RECEIVE_COMPLAINT'
    | 'RESOLVE_COMPLAINT'
    | 'ESCALATE_COMPLAINT_TO_LONDON'
    | 'RECORD_PEER_REVIEW'
    | 'LOG_COMMUNICATION_SENT'
    | 'LOG_COMMUNICATION_RECEIVED'
    | 'ASSIGN_HANDLER'
    | 'SEND_FNOL_LINK';

/** Payload shape for executeClaimWorksheetCommand */
export interface ClaimWorksheetCommandPayload {
    type: ClaimWorksheetCommandType;
    idempotencyKey?: string;
    payload?: Record<string, unknown>;
}

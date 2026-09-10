import { dispatchClaimCommand } from '../domain/commands/index.js';
import { enqueueAccountProjectionRefreshByClaimId } from '../../accounts360/app/accountProjectionRefresh.js';
import {
  appendClaimEvent,
  asRecord,
  assertFnolConfirmedForFinancialCommands,
  maybeFlagLargeLoss,
  refreshClaimSnapshot,
  resolveClaimGovernanceProfile,
} from '../domain/commands/shared.js';
import { FINANCIAL_COMMANDS, type ClaimCommandType, type ClaimWorksheetCommandInput } from '../domain/commands/types.js';
import { buildClaimWorksheetProjection } from '../domain/worksheetProjection.js';
import { loadWorksheetClaim, runWorksheetTransaction, syncClaimStatusField } from './worksheetRepo.js';

export type { ClaimCommandType, ClaimWorksheetCommandInput };

type OperationalState = 'PENDING' | 'OPEN' | 'UNDER_REVIEW' | 'DENIED' | 'CLOSED';

function resolveOperationalState(args: {
  status: string;
  denied: 'Y' | 'N';
  phase: string;
}): OperationalState {
  const status = String(args.status || '').trim().toUpperCase();
  if (status === 'PENDING') return 'PENDING';
  if (args.denied === 'Y' || status === 'DENIED') return 'DENIED';
  if (status === 'CLOSED' || status === 'CLOSED_THIS_MONTH' || status === 'CLOSED_RECOVERY_PURSUED' || status === 'WITHDRAWN') return 'CLOSED';
  if (String(args.phase || '').trim().toUpperCase() === 'INVESTIGATION' || String(args.phase || '').trim().toUpperCase() === 'DECISION') {
    return 'UNDER_REVIEW';
  }
  return 'OPEN';
}

function assertActionAllowedForOperationalState(args: {
  type: ClaimCommandType;
  operationalState: OperationalState;
}) {
  const activeOnly = new Set<ClaimCommandType>([
    'SET_RESERVE',
    'ADJUST_RESERVE',
    'ADD_PAYMENT',
    'SET_RECOVERY_EXPECTED',
    'ADD_RECOVERY_RECEIVED',
    'CREATE_APPOINTMENT',
    'DENY_CLAIM',
    'CLOSE',
  ]);
  if (args.operationalState === 'PENDING' && activeOnly.has(args.type)) {
    throw new Error(`Action ${args.type} is not allowed before FNOL is completed`);
  }
  if (activeOnly.has(args.type) && (args.operationalState === 'CLOSED' || args.operationalState === 'DENIED')) {
    throw new Error(`Action ${args.type} is not allowed when claim is ${args.operationalState}`);
  }
  if (args.type === 'REOPEN' && args.operationalState !== 'CLOSED') {
    throw new Error('Action REOPEN is only allowed when claim is CLOSED');
  }
}

export async function openClaimCommand(args: {
  claimId: string;
  claimNumber: string;
  payload: {
    certificateReference: string;
    dateOfLossFrom: string;
    dateOfLossTo?: string;
    lossCountry: string;
    causeOfLossCode?: string;
    lossDescription?: string;
    originalCurrency: string;
    openedAt?: string;
    referredToUw?: boolean;
  };
  input: ClaimWorksheetCommandInput;
}) {
  await runWorksheetTransaction(async (tx) => {
    await appendClaimEvent({
      tx,
      claimId: args.claimId,
      claimNumber: args.claimNumber,
      command: 'OPEN_CLAIM',
      eventType: 'CLAIM_OPENED',
      input: args.input,
      payload: {
        cr0029_certificate_reference: args.payload.certificateReference,
        cr0119_date_of_loss_from: args.payload.dateOfLossFrom,
        cr0120_date_of_loss_to: args.payload.dateOfLossTo || null,
        cr0116_loss_country: args.payload.lossCountry,
        cr0117_cause_of_loss_code: args.payload.causeOfLossCode || null,
        cr0118_loss_description: args.payload.lossDescription || null,
        cr0109_original_currency: args.payload.originalCurrency,
        cr0300_date_claim_opened: args.payload.openedAt || new Date().toISOString().slice(0, 10),
      },
    });
    if (args.payload.referredToUw) {
      await appendClaimEvent({
        tx,
        claimId: args.claimId,
        claimNumber: args.claimNumber,
        command: 'SET_REFERRAL',
        eventType: 'REFERRED_SET',
        input: args.input,
        payload: { referred: true },
      });
    }
    const sync = await refreshClaimSnapshot(tx, args.claimId);
    if (sync) {
      await syncClaimStatusField(tx, args.claimId, sync);
    }
    await enqueueAccountProjectionRefreshByClaimId(tx, args.claimId);
  });
}

export async function executeClaimWorksheetCommand(args: {
  claimId: string;
  type: ClaimCommandType;
  payload: Record<string, unknown>;
  input: ClaimWorksheetCommandInput;
}) {
  await runWorksheetTransaction(async (tx) => {
    const claim = await loadWorksheetClaim(tx, args.claimId);
    if (!claim) throw new Error('Claim not found');

    const claimNumber = String(claim.claimNumber || '');
    const payload = args.payload || {};
    const claimData = asRecord(claim.data);
    const projection = buildClaimWorksheetProjection({
      claimId: claim.id,
      claimReference: claimNumber,
      certificateReference: String(claimData.cr0029_certificate_reference || ''),
      events: claim.events,
    });
    const operationalState = resolveOperationalState({
      status: projection.status,
      denied: projection.cr0107Denial,
      phase: projection.phase,
    });
    assertActionAllowedForOperationalState({ type: args.type, operationalState });

    assertFnolConfirmedForFinancialCommands({ type: args.type, projection });
    const governance = await resolveClaimGovernanceProfile({
      tx,
      policyId: claim.policyId || String(claimData.policyId || ''),
    });

    const result = await dispatchClaimCommand({
      tx,
      claim,
      claimNumber,
      claimData,
      projection,
      payload,
      input: args.input,
      type: args.type,
      governance,
    });

    if (result.handled && result.shortCircuit) return;

    if (FINANCIAL_COMMANDS.has(args.type)) {
      await maybeFlagLargeLoss({
        tx,
        claimId: claim.id,
        claimNumber,
        input: args.input,
        command: args.type,
        largeLossThreshold: governance.largeLossThreshold,
        governanceSource: governance.source,
      });
    }

    const sync = await refreshClaimSnapshot(tx, claim.id);
    if (sync) {
      await syncClaimStatusField(tx, claim.id, sync);
    }
    await enqueueAccountProjectionRefreshByClaimId(tx, claim.id);
  });
}

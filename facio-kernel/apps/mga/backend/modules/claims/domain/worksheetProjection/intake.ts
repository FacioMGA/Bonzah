// Intake projection: derives the FNOL/clarification surface from a
// replayed `LedgerState`. Extracted from `../worksheetProjection.ts`
// in sprint follow-up F4a.

import { deriveRequiredActions } from '../requiredActions/index.js';
import type {
  ActorRef,
  IntakeGate,
  IntakeProjection,
  LedgerState,
  RequiredAction,
} from './types.js';
import { asText, readPath } from './internal/helpers.js';

export function deriveIntake(state: LedgerState): IntakeProjection {
  const hasFnol = Boolean(state.fnolCurrentVersion);
  const isConfirmed = Boolean(state.fnolCurrentVersion && state.fnolCurrentVersion === state.fnolConfirmedVersion);
  const status: IntakeProjection['status'] = !hasFnol
    ? 'NONE'
    : state.clarificationOpen
      ? 'AWAITING_CLARIFICATION'
      : isConfirmed
        ? 'FNOL_CONFIRMED'
        : 'FNOL_SUBMITTED';

  // `spine/v2` Wave 5 deleted the alias resolution branches:
  //   `incident.type | incident.lossType | claimType`
  //   `incident.date | incident.dateOfLoss | incidentDate`
  //   `incident.location.address | incident.location | incident.city | lossLocation`
  //   `incident.description | narrative | description`
  // The persisted snapshot is now the canonical `CanonicalIntakeSchema`
  // shape (zod-stripped of unknown keys), so each gate reads exactly one
  // path. If the canonical name is missing the gate fails — there's no
  // silent rescue from a legacy synonym.
  const fnol = state.fnolSnapshot;
  const lossType = asText(readPath(fnol, 'incident.type'));
  const dateOfLoss = asText(readPath(fnol, 'incident.date'));
  const location = asText(readPath(fnol, 'incident.location.address') ?? readPath(fnol, 'incident.location.city'));
  const narrative = asText(readPath(fnol, 'incident.description'));

  const gates: IntakeGate[] = [
    { key: 'lossTypePresent', label: 'Loss type present', status: lossType ? 'PASS' : 'FAIL', reason: lossType ? undefined : 'Loss type is missing' },
    { key: 'dateOfLossPresent', label: 'Date of loss present', status: dateOfLoss ? 'PASS' : 'FAIL', reason: dateOfLoss ? undefined : 'Date of loss is missing' },
    { key: 'locationPresent', label: 'Location present', status: location ? 'PASS' : 'FAIL', reason: location ? undefined : 'Location is missing' },
    { key: 'narrativePresent', label: 'Narrative present', status: narrative.length >= 10 ? 'PASS' : 'FAIL', reason: narrative.length >= 10 ? undefined : 'Narrative is too short' },
    { key: 'fnolConfirmed', label: 'FNOL confirmed', status: isConfirmed ? 'PASS' : 'FAIL', reason: isConfirmed ? undefined : 'FNOL confirmation is required' },
  ];

  const failingGateKeys = gates.filter((gate) => gate.status === 'FAIL').map((gate) => gate.key);
  const requiredActions: RequiredAction[] = deriveRequiredActions({
    intakeStatus: status,
    failingGateKeys,
    referralRequired: state.referralRequired,
    referralApprovedAt: state.referralApprovedAt,
    largeLossIndicator: state.largeLossIndicator,
    largeLossNotifiedAt: state.largeLossNotifiedAt,
    lockedDeductible: state.lockedDeductible,
  });

  const changedFieldIndex = new Map<string, { path: string; changedAt: string; changedBy?: ActorRef }>();
  for (const amendment of state.amendments) {
    for (const change of amendment.changes || []) {
      if (!change.path) continue;
      changedFieldIndex.set(change.path, {
        path: change.path,
        changedAt: amendment.amendedAt,
        changedBy: amendment.amendedBy,
      });
    }
  }
  const changedFields = Array.from(changedFieldIndex.values()).sort((a, b) => a.path.localeCompare(b.path));

  return {
    status,
    currentVersion: state.fnolCurrentVersion,
    confirmedVersion: state.fnolConfirmedVersion,
    fnol,
    submittedAt: state.fnolSubmittedAt,
    submittedBy: state.fnolSubmittedBy,
    confirmedAt: state.fnolConfirmedAt,
    confirmedBy: state.fnolConfirmedBy,
    clarificationOpen: state.clarificationOpen,
    clarificationHistory: state.clarificationHistory,
    amendments: state.amendments,
    changedFields,
    gates,
    requiredActions,
  };
}


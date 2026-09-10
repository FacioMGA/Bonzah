import { executeClaimWorksheetCommand } from '../../domain/worksheetCommands.js';

export type ClaimsActorInput = {
  actorType: 'USER' | 'SYSTEM' | 'CUSTOMER' | 'UNDERWRITER' | 'OPS';
  actorId: string;
  actorName: string;
  idempotencyKey?: string;
};

export async function executeWorksheetCommand(input: {
  claimId: string;
  type: string;
  payload: Record<string, unknown>;
  actor: ClaimsActorInput;
}) {
  await executeClaimWorksheetCommand({
    claimId: input.claimId,
    type: input.type as Parameters<typeof executeClaimWorksheetCommand>[0]['type'],
    payload: input.payload,
    input: input.actor,
  });
}

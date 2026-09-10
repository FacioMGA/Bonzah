import { reserveNextClaimNumber } from '../infra/platformIds.js';
import { openClaimCommand, executeClaimWorksheetCommand } from '../domain/worksheetCommands.js';
import { buildClaimWorksheetProjection } from '../domain/worksheetProjection.js';
import { normalizeCanonicalIntake } from '../domain/intakeCanonical.js';
import { appendClaimEvent } from '../domain/commands/shared.js';
import { WebhookDispatcher } from '../../communications/app/webhooks/webhookDispatcher.js';

// Transitional app-level facade so HTTP stays conductor-only.
// HTTP routes consume domain helpers exclusively through this object;
// direct `http -> domain/commands/*` imports are blocked by the layer
// boundary guard (`tools/quality/check-backend-layer-imports.mjs`).
export const claimsHttpDeps = {
  reserveNextClaimNumber,
  openClaimCommand,
  executeClaimWorksheetCommand,
  buildClaimWorksheetProjection,
  normalizeCanonicalIntake,
  // ABY-260 — exposed so the create-claim route handler can append a
  // `POLICY_LINKED` event in the same transaction as `tx.claim.create`
  // when a known policy is supplied at case creation. Atomic with the
  // claim insert; no separate command transaction means no orphan
  // window if a follow-up step fails.
  appendClaimEvent,
  dispatchWebhook: WebhookDispatcher.dispatch.bind(WebhookDispatcher),
};

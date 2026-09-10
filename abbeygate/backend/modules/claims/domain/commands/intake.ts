import type { CommandContext } from './shared.js';
import { appendClaimEvent, asRecord, extractLockedDeductible } from './shared.js';
import { normalizeCanonicalIntake } from '../intakeCanonical.js';
import type { PrismaInputJsonValue } from '../../../../platform/types/prisma.js';
type JsonValue = null | string | number | boolean | { [key: string]: JsonValue } | JsonValue[];

type DispatchResult = { handled: boolean; shortCircuit?: boolean };

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => asRecord(acc)[segment], source);
}

function normalizeIncidentType(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, '_');
}

function mapFnolCauseToCr0117(incidentType: string, productType?: string): string {
  const token = normalizeIncidentType(incidentType);
  const prefix = (productType || 'GENERAL').toUpperCase();
  const genericMap: Record<string, string> = {
    collision: 'COLLISION',
    theft: 'THEFT',
    damage_parked: 'PARKED_DAMAGE',
    parked: 'PARKED_DAMAGE',
    vandalism: 'VANDALISM',
    weather: 'WEATHER',
    windscreen: 'WINDSCREEN',
    glass: 'WINDSCREEN',
    fire: 'FIRE',
    third_party: 'THIRD_PARTY',
    other: 'OTHER',
  };
  const suffix = genericMap[token] ?? (token ? token.toUpperCase().replace(/[^A-Z0-9]+/g, '_') : '');
  return suffix ? `${prefix}_${suffix}` : '';
}

function buildClaimOpenedPayload(ctx: CommandContext, fnolSnapshot: Record<string, unknown>) {
  // `spine/v2` Wave 5 deleted the alias resolution branch:
  //   `incident.type | incident.lossType | incidentType | claimType`
  //   `incident.description | description | narrative`
  //   `incident.date | incident.dateOfLoss | incidentDate`
  //   `incident.location.country | incident.country | location.country`
  // The FNOL snapshot is now the canonical `CanonicalIntakeSchema` shape
  // (zod-stripped of unknown keys), so each path has exactly one read.
  const incidentType = String(readPath(fnolSnapshot, 'incident.type') || '').trim();
  const incidentDescription = String(readPath(fnolSnapshot, 'incident.description') || '').trim();
  const incidentDate = String(
    readPath(fnolSnapshot, 'incident.date')
    || String(ctx.claimData.cr0119_date_of_loss_from || '')
    || '',
  ).trim();
  const incidentCountry = String(
    readPath(fnolSnapshot, 'incident.location.country')
    || String(ctx.claimData.cr0116_loss_country || '')
    || '',
  ).trim();
  return {
    cr0029_certificate_reference: String(ctx.claimData.cr0029_certificate_reference || ''),
    cr0119_date_of_loss_from: incidentDate,
    cr0120_date_of_loss_to: String(ctx.claimData.cr0120_date_of_loss_to || '') || null,
    cr0116_loss_country: incidentCountry,
    cr0117_cause_of_loss_code: mapFnolCauseToCr0117(incidentType, String(ctx.claimData.productType || '')) || String(ctx.claimData.cr0117_cause_of_loss_code || '') || null,
    cr0118_loss_description: incidentDescription || String(ctx.claimData.cr0118_loss_description || '') || null,
    cr0109_original_currency: String(ctx.claimData.cr0109_original_currency || 'EUR'),
    cr0300_date_claim_opened: new Date().toISOString().slice(0, 10),
  };
}

export async function handleIntakeCommands(ctx: CommandContext): Promise<DispatchResult> {
  if (ctx.type === 'SUBMIT_FNOL_FINAL' || ctx.type === 'SUBMIT_FNOL') {
    const fnol = normalizeCanonicalIntake(ctx.payload.fnol);
    if (!Object.keys(fnol).length) throw new Error('FNOL snapshot is required');
    const version = Number(ctx.payload.version || ctx.projection.intake.currentVersion || 0) + 1;
    await ctx.tx.claim.update({
      where: { id: ctx.claim.id },
      data: {
        data: {
          ...ctx.claimData,
          fnolFinal: fnol as JsonValue,
          fnolFinalSubmittedAt: new Date().toISOString(),
          fnolVersion: version,
        },
      },
    });
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: 'SUBMIT_FNOL',
      input: ctx.input,
      eventType: 'FNOL_SUBMITTED',
      payload: { fnol, version, submittedAt: new Date().toISOString(), hasForm: true },
    });
    if (ctx.input.actorType === 'CUSTOMER') {
      await appendClaimEvent({
        tx: ctx.tx,
        claimId: ctx.claim.id,
        claimNumber: ctx.claimNumber,
        command: 'SUBMIT_FNOL',
        input: ctx.input,
        eventType: 'FNOL_SUBMITTED_BY_CUSTOMER',
        payload: { version, submittedAt: new Date().toISOString() },
      });
    }
    return { handled: true };
  }

  if (ctx.type === 'CONFIRM_FNOL') {
    if (!ctx.projection.intake.currentVersion) throw new Error('Cannot confirm FNOL before submission');
    const blockingGates = ctx.projection.intake.gates.filter((gate) => gate.key !== 'fnolConfirmed' && gate.status !== 'PASS');
    if (blockingGates.length) {
      throw new Error(`Cannot confirm FNOL while gates are failing: ${blockingGates.map((gate) => gate.key).join(', ')}`);
    }
    const policyId = String(ctx.claimData.policyId || ctx.claim.policyId || '').trim();
    const policy = policyId ? await ctx.tx.policy.findUnique({
      where: { id: policyId },
      select: { id: true, quoteData: true, vehicleInfo: true },
    }) : null;
    const deductibleAmount = policy ? extractLockedDeductible(asRecord(policy)) : undefined;
    const fnolSnapshot = asRecord(ctx.projection.intake.fnol);
    const incidentType = String(readPath(fnolSnapshot, 'incident.type') || '').trim();
    const incidentDescription = String(readPath(fnolSnapshot, 'incident.description') || '').trim();
    const incidentDate = String(readPath(fnolSnapshot, 'incident.date') || '').trim();
    const incidentCountry = String(readPath(fnolSnapshot, 'incident.location.country') || '').trim();
    const parsedIncidentDate = incidentDate ? new Date(incidentDate) : null;
    const claimDataPatch: Record<string, unknown> = {
      ...ctx.claimData,
      cr0117_cause_of_loss_code: mapFnolCauseToCr0117(incidentType, String(ctx.claimData.productType || '')) || ctx.claimData.cr0117_cause_of_loss_code || null,
      cr0118_loss_description: incidentDescription || ctx.claimData.cr0118_loss_description || null,
      cr0119_date_of_loss_from: incidentDate || ctx.claimData.cr0119_date_of_loss_from || null,
      cr0116_loss_country: incidentCountry || ctx.claimData.cr0116_loss_country || null,
    };
    await ctx.tx.claim.update({
      where: { id: ctx.claim.id },
      data: {
        claimType: incidentType || undefined,
        description: incidentDescription || undefined,
        causeOfLossCode: mapFnolCauseToCr0117(incidentType, String(ctx.claimData.productType || '')) || undefined,
        lossDescription: incidentDescription || undefined,
        dateOfLossFrom: parsedIncidentDate && !Number.isNaN(parsedIncidentDate.getTime()) ? parsedIncidentDate : undefined,
        lossCountry: incidentCountry || undefined,
        data: claimDataPatch as PrismaInputJsonValue,
      },
    });
    if (!ctx.projection.firstNotifiedAt) {
      await appendClaimEvent({
        tx: ctx.tx,
        claimId: ctx.claim.id,
        claimNumber: ctx.claimNumber,
        command: 'OPEN_CLAIM',
        input: ctx.input,
        eventType: 'CLAIM_OPENED',
        payload: buildClaimOpenedPayload(ctx, fnolSnapshot),
      });
    }
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'FNOL_CONFIRMED',
      payload: {
        confirmedVersion: ctx.projection.intake.currentVersion,
        confirmedAt: new Date().toISOString(),
      },
    });
    if (typeof deductibleAmount === 'number' && deductibleAmount > 0) {
      await appendClaimEvent({
        tx: ctx.tx,
        claimId: ctx.claim.id,
        claimNumber: ctx.claimNumber,
        command: ctx.type,
        input: ctx.input,
        eventType: 'DEDUCTIBLE_LOCKED',
        payload: {
          deductibleAmount,
          lockedAt: new Date().toISOString(),
        },
      });
    }
    return { handled: true };
  }

  if (ctx.type === 'REQUEST_FNOL_CLARIFICATION') {
    if (!ctx.projection.intake.currentVersion) throw new Error('Cannot request clarification before FNOL submission');
    const fieldsRequested = Array.isArray(ctx.payload.fieldsRequested) ? ctx.payload.fieldsRequested.map((field) => String(field)) : [];
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'FNOL_CLARIFICATION_REQUESTED',
      payload: {
        requestId: String(ctx.payload.requestId || `clar-${Date.now()}`),
        fieldsRequested,
        message: String(ctx.payload.message || ''),
        requestedAt: new Date().toISOString(),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'FNOL_CLARIFICATION_RECEIVED') {
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'FNOL_CLARIFICATION_RECEIVED',
      payload: {
        requestId: String(ctx.payload.requestId || ''),
        message: String(ctx.payload.message || ''),
        receivedAt: new Date().toISOString(),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'AMEND_FNOL') {
    if (!ctx.projection.intake.currentVersion) throw new Error('Cannot amend FNOL before submission');
    const fnol = normalizeCanonicalIntake(ctx.payload.fnol);
    if (!Object.keys(fnol).length) throw new Error('Amended FNOL snapshot is required');
    const fromVersion = ctx.projection.intake.currentVersion;
    const toVersion = fromVersion + 1;
    const changes = Array.isArray(ctx.payload.changes)
      ? ctx.payload.changes
      : Object.entries(fnol).map(([path, to]) => ({ path, from: (ctx.projection.intake.fnol || {})[path], to }));
    await ctx.tx.claim.update({
      where: { id: ctx.claim.id },
      data: {
        data: {
          ...ctx.claimData,
          fnolFinal: fnol as JsonValue,
          fnolVersion: toVersion,
          fnolFinalSubmittedAt: new Date().toISOString(),
        },
      },
    });
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'FNOL_AMENDED',
      payload: {
        fromVersion,
        toVersion,
        fnol,
        changes,
        amendedAt: new Date().toISOString(),
      },
    });
    return { handled: true };
  }

  return { handled: false };
}


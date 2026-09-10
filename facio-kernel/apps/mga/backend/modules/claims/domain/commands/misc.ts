import type { CommandContext } from './shared.js';
import { appendClaimEvent, asRecord } from './shared.js';
import type { PrismaInputJsonValue } from '../../../../platform/types/prisma.js';

type DispatchResult = { handled: boolean; shortCircuit?: boolean };

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function handleMiscCommands(ctx: CommandContext): Promise<DispatchResult> {
  if (ctx.type === 'ACKNOWLEDGE_CLAIM') {
    const alreadyAcknowledged = ctx.claim.events.some((ev) => ev.eventType === 'CLAIM_ACKNOWLEDGED');
    if (alreadyAcknowledged) return { handled: true, shortCircuit: true };
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'CLAIM_ACKNOWLEDGED',
      payload: {
        acknowledgedAt: String(ctx.payload.acknowledgedAt || new Date().toISOString()),
        channel: String(ctx.payload.channel || ''),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'CREATE_DIARY_ITEM') {
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'DIARY_CREATED',
      payload: {
        diaryId: String(ctx.payload.diaryId || `diary-${Date.now()}`),
        title: String(ctx.payload.title || ''),
        dueDate: String(ctx.payload.dueDate || new Date().toISOString()),
        priority: String(ctx.payload.priority || 'NORMAL'),
        createdAt: String(ctx.payload.createdAt || new Date().toISOString()),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'COMPLETE_DIARY_ITEM') {
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'DIARY_COMPLETED',
      payload: {
        diaryId: String(ctx.payload.diaryId || ''),
        completedAt: String(ctx.payload.completedAt || new Date().toISOString()),
        outcome: String(ctx.payload.outcome || ''),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'INSTRUCT_FIELD_ADJUSTER') {
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'FIELD_ADJUSTER_INSTRUCTED',
      payload: {
        instructionId: String(ctx.payload.instructionId || `adj-${Date.now()}`),
        instructedAt: String(ctx.payload.instructedAt || new Date().toISOString()),
        companyName: String(ctx.payload.companyName || ''),
        affiliated: Boolean(ctx.payload.affiliated),
        note: String(ctx.payload.note || ''),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'CREATE_APPOINTMENT') {
    const appointeeType = String(ctx.payload.appointeeType || '').trim().toUpperCase();
    const appointee = String(ctx.payload.appointee || '').trim();
    if (!appointeeType) throw new Error('appointeeType is required');
    if (!appointee) throw new Error('appointee is required');
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'APPOINTMENT_CREATED',
      payload: {
        appointmentId: String(ctx.payload.appointmentId || `apt-${Date.now()}`),
        appointeeType,
        appointee,
        instruction: String(ctx.payload.instruction || '').trim(),
        appointedAt: new Date().toISOString(),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'ADD_CLAIM_NOTE') {
    const note = String(ctx.payload.note || '').trim();
    if (note.length < 4) throw new Error('note must be at least 4 characters');
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'CLAIM_NOTE_ADDED',
      payload: {
        note,
        createdAt: new Date().toISOString(),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'ADD_CLAIM_EVIDENCE') {
    const documentType = String(ctx.payload.documentType || '').trim().toUpperCase();
    const fileId = String(ctx.payload.fileId || '').trim();
    const originalFilename = String(ctx.payload.originalFilename || '').trim();
    if (!documentType) throw new Error('documentType is required');
    if (!fileId) throw new Error('fileId is required');
    if (!originalFilename) throw new Error('originalFilename is required');
    const note = String(ctx.payload.note || '').trim();
    const fileUrl = String(ctx.payload.fileUrl || '').trim();
    const uploadedAt = new Date().toISOString();
    const documents = asArray<Record<string, unknown>>(ctx.claim.documents);
    documents.push({
      id: fileId,
      documentType,
      label: documentType,
      note,
      originalName: originalFilename,
      filename: originalFilename,
      url: fileUrl,
      uploadedBy: ctx.input.actorName || ctx.input.actorId,
      uploadedByName: ctx.input.actorName || '',
      uploadedAt,
      createdAt: uploadedAt,
      source: 'handler',
    });
    await ctx.tx.claim.update({
      where: { id: ctx.claim.id },
      data: {
        documents: documents as PrismaInputJsonValue,
      },
    });
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'CLAIM_EVIDENCE_ADDED',
      payload: {
        documentType,
        note,
        fileId,
        originalFilename,
        fileUrl,
        uploadedAt,
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'RECORD_ADJUSTER_REPORT') {
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'ADJUSTER_REPORT_RECEIVED',
      payload: {
        instructionId: String(ctx.payload.instructionId || ''),
        reportReceivedAt: String(ctx.payload.reportReceivedAt || new Date().toISOString()),
        reportReference: String(ctx.payload.reportReference || ''),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'RECEIVE_COMPLAINT') {
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'COMPLAINT_RECEIVED',
      payload: {
        complaintId: String(ctx.payload.complaintId || `cmp-${Date.now()}`),
        receivedAt: String(ctx.payload.receivedAt || new Date().toISOString()),
        stage: String(ctx.payload.stage || 'INITIAL'),
        slaDays: Number(ctx.payload.slaDays || 8),
        reason: String(ctx.payload.reason || ''),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'RESOLVE_COMPLAINT') {
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'COMPLAINT_RESOLVED',
      payload: {
        complaintId: String(ctx.payload.complaintId || ''),
        resolvedAt: String(ctx.payload.resolvedAt || new Date().toISOString()),
        stage: String(ctx.payload.stage || 'INITIAL'),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'ESCALATE_COMPLAINT_TO_LONDON') {
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'COMPLAINT_ESCALATED_TO_LONDON',
      payload: {
        complaintId: String(ctx.payload.complaintId || ''),
        escalatedAt: String(ctx.payload.escalatedAt || new Date().toISOString()),
        reason: String(ctx.payload.reason || ''),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'RECORD_PEER_REVIEW') {
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'PEER_REVIEW_RECORDED',
      payload: {
        reviewedAt: String(ctx.payload.reviewedAt || new Date().toISOString()),
        reviewOutcome: String(ctx.payload.reviewOutcome || ''),
        reviewerUserId: String(ctx.payload.reviewerUserId || ctx.input.actorId || ''),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'LOG_COMMUNICATION_SENT' || ctx.type === 'LOG_COMMUNICATION_RECEIVED') {
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: ctx.type === 'LOG_COMMUNICATION_SENT' ? 'COMMUNICATION_SENT' : 'COMMUNICATION_RECEIVED',
      payload: {
        occurredAt: String(ctx.payload.occurredAt || new Date().toISOString()),
        communicationType: String(ctx.payload.communicationType || 'GENERAL'),
        partyType: String(ctx.payload.partyType || 'FIRST_PARTY'),
        channel: String(ctx.payload.channel || ''),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'ASSIGN_HANDLER') {
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'ASSIGNED_TO',
      payload: {
        handlerUserId: String(ctx.payload.handlerUserId || ''),
        assignedAt: String(ctx.payload.assignedAt || new Date().toISOString()),
        role: String(ctx.payload.role || 'CLAIMS_EXAMINER'),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'SEND_FNOL_LINK') {
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'FNOL_LINK_SENT',
      payload: {
        sentAt: String(ctx.payload.sentAt || new Date().toISOString()),
        channel: String(ctx.payload.channel || 'EMAIL'),
        recipient: String(ctx.payload.recipient || ''),
      },
    });
    return { handled: true };
  }

  if (ctx.type === 'LINK_POLICY') {
    const policyId = String(ctx.payload.policyId || '').trim();
    if (!policyId) throw new Error('policyId is required');
    if (ctx.claim.policyId) throw new Error('Policy already linked; relinking is not allowed');
    const policy = await ctx.tx.policy.findUnique({
      where: { id: policyId },
      select: { id: true, policyNumber: true, productType: true },
    });
    if (!policy) throw new Error('Policy not found');
    await ctx.tx.claim.update({
      where: { id: ctx.claim.id },
      data: {
        policyId: policy.id,
        data: {
          ...ctx.claimData,
          policyNumber: policy.policyNumber,
          productType: policy.productType,
        },
      },
    });
    await appendClaimEvent({
      tx: ctx.tx,
      claimId: ctx.claim.id,
      claimNumber: ctx.claimNumber,
      command: ctx.type,
      input: ctx.input,
      eventType: 'POLICY_LINKED',
      payload: {
        policyId: policy.id,
        linkReason: String(ctx.payload.linkReason || ''),
        linkedAt: new Date().toISOString(),
      },
    });
    return { handled: true };
  }

  if (ctx.type !== 'UPDATE_SUMMARY') return { handled: false };

  const summary = asRecord(ctx.payload.summary);
  if (!Object.keys(summary).length) throw new Error('summary payload is required');
  await ctx.tx.claim.update({
    where: { id: ctx.claim.id },
    data: {
      description: typeof summary.description === 'string' ? String(summary.description).trim() : undefined,
      claimType: typeof summary.claimType === 'string' ? String(summary.claimType).trim() : undefined,
      data: {
        ...ctx.claimData,
        ...summary,
        claimSummaryUpdatedAt: new Date().toISOString(),
      },
    },
  });
  await appendClaimEvent({
    tx: ctx.tx,
    claimId: ctx.claim.id,
    claimNumber: ctx.claimNumber,
    command: ctx.type,
    input: ctx.input,
    eventType: 'CLAIM_SUMMARY_UPDATED',
    payload: summary,
  });
  return { handled: true };
}


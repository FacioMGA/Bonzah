import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma, tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { claimsAuditLog } from './claimsAuditMiddleware.js';
import { claimsHttpDeps } from '../app/httpConductorDeps.js';
import { sendFnolLinkForClaim } from '../app/claimsFnolLinkService.js';
import { loadFnolLinkDeliveryStatus } from '../app/loadFnolLinkDeliveryStatus.js';
import {
  createClaimInfoRequest,
  respondToClaimInfoRequest,
} from '../app/claimInfoRequestService.js';
import { buildClaimWorksheetCompliance } from '../app/claimWorksheetComplianceService.js';
import { listClaimCounterparties } from '../app/claimCounterpartyService.js';
import { listClaimPaymentEligibilityRulesForHttp } from '../app/paymentClassificationService.js';
import { executeWorksheetCommand } from '../app/commands/executeWorksheetCommand.js';
import { getClaimWorksheetView } from '../app/queries/getClaimWorksheetView.js';
import { getClaimStatutoryTimetable } from '../app/queries/getClaimStatutoryTimetable.js';
import { listClaimsPage } from '../app/queries/listClaimsPage.js';
import { getClaimMemory } from '../app/mailgraph/getClaimMemory.js';
import { askClaimMemory } from '../app/mailgraph/askClaimMemory.js';
import { enqueueClaimMemoryRefresh } from '../app/mailgraph/enqueueClaimMemoryRefresh.js';
import { requirePermission } from '../../accessControl/http/permissionMiddleware.js';

const router = Router();

type Actor = { id?: string; role?: string; name?: string; email?: string } | null | undefined;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCaseLocationDetails(value: unknown) {
  const raw = asRecord(value);
  const address = asText(raw.address);
  const city = asText(raw.city);
  const state = asText(raw.state);
  const zip = asText(raw.zip);
  const country = asText(raw.country);
  if (!address && !city && !state && !zip && !country) return null;
  return {
    address,
    city,
    state,
    zip,
    country: country || undefined,
  };
}

function normalizeCaseIntakeDraft(value: unknown) {
  const raw = asRecord(value);
  const locationDetails = normalizeCaseLocationDetails(raw.locationDetails);
  const draft = {
    reporterType: asText(raw.reporterType),
    contactName: asText(raw.contactName),
    contactPhone: asText(raw.contactPhone),
    contactEmail: asText(raw.contactEmail),
    contactDetails: asText(raw.contactDetails),
    shortDescription: asText(raw.shortDescription),
    dateOfLoss: asText(raw.dateOfLoss),
    location: asText(raw.location),
    locationDetails,
    insuredName: asText(raw.insuredName),
  };
  return Object.values(draft).some((item) => {
    if (typeof item === 'string') return Boolean(item);
    return Boolean(item);
  })
    ? draft
    : null;
}

function serializeInfoRequests(value: Array<Record<string, unknown>> | undefined) {
  return (value || []).map((request) => ({
    id: asText(request.id),
    status: asText(request.status),
    message: asText(request.message),
    requestedAt: request.requestedAt ? new Date(String(request.requestedAt)).toISOString() : '',
    requestedByUserId: asText(request.requestedByUserId),
    responseMessage: asText(request.responseMessage) || undefined,
    respondedAt: request.respondedAt ? new Date(String(request.respondedAt)).toISOString() : undefined,
    resolvedAt: request.resolvedAt ? new Date(String(request.resolvedAt)).toISOString() : undefined,
    resolvedByUserId: asText(request.resolvedByUserId) || undefined,
  }));
}

function actorTypeFromRole(roleRaw: unknown): 'USER' | 'SYSTEM' | 'CUSTOMER' | 'UNDERWRITER' | 'OPS' {
  const role = String(roleRaw || '').toUpperCase();
  if (role === 'CUSTOMER') return 'CUSTOMER';
  if (role === 'UNDERWRITER') return 'UNDERWRITER';
  if (role === 'ADMIN' || role === 'PROGRAM ADMINISTRATOR') return 'OPS';
  return 'USER';
}

const CreateClaimSchema = z.object({
  policyId: z.string().trim().min(1).nullable().optional(),
  description: z.string().trim().min(3).optional(),
  caseIntakeDraft: z.object({
    reporterType: z.string().trim().optional(),
    contactName: z.string().trim().optional(),
    contactPhone: z.string().trim().optional(),
    contactEmail: z.string().trim().email().optional(),
    contactDetails: z.string().trim().optional(),
    shortDescription: z.string().trim().optional(),
    dateOfLoss: z.string().trim().optional(),
    location: z.string().trim().optional(),
    locationDetails: z.object({
      address: z.string().trim().optional(),
      city: z.string().trim().optional(),
      state: z.string().trim().optional(),
      zip: z.string().trim().optional(),
      country: z.string().trim().optional(),
    }).optional(),
    insuredName: z.string().trim().optional(),
  }).optional(),
  worksheet: z.object({
    certificateReference: z.string().trim().optional(),
    dateOfLossFrom: z.string().trim().optional(),
    dateOfLossTo: z.string().trim().optional(),
    lossCountry: z.string().trim().max(2).optional(),
    causeOfLossCode: z.string().trim().optional(),
    lossDescription: z.string().trim().optional(),
    originalCurrency: z.string().trim().max(3).optional(),
    openedAt: z.string().trim().optional(),
    referredToUw: z.boolean().optional(),
  }).optional(),
});

const EmptyPayload = z.object({}).default({});
const ReasonPayload = z.object({
  reasonCode: z.string().trim().min(1),
  reason: z.string().trim().min(1).optional(),
  explanation: z.string().trim().min(1).optional(),
});

const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SUBMIT_FNOL'), payload: z.object({ fnol: z.record(z.string(), z.unknown()) }).or(z.object({ form: z.record(z.string(), z.unknown()) })), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('SUBMIT_FNOL_FINAL'), payload: z.object({ fnol: z.record(z.string(), z.unknown()) }).or(z.object({ form: z.record(z.string(), z.unknown()) })), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('CONFIRM_FNOL'), payload: z.object({ version: z.number().int().optional() }).default({}), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('REQUEST_FNOL_CLARIFICATION'), payload: z.object({ fieldsRequested: z.array(z.string()).default([]), message: z.string().optional(), requestId: z.string().optional() }), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('FNOL_CLARIFICATION_RECEIVED'), payload: z.object({ requestId: z.string().optional(), message: z.string().optional() }).default({}), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('AMEND_FNOL'), payload: z.object({ fnol: z.record(z.string(), z.unknown()), changes: z.array(z.object({ path: z.string(), from: z.unknown(), to: z.unknown() })).optional() }), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('APPROVE_REFERRAL'), payload: EmptyPayload, idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('LINK_POLICY'), payload: z.object({ policyId: z.string().trim().min(1), linkReason: z.string().optional() }), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('UPDATE_SUMMARY'), payload: z.object({ summary: z.record(z.string(), z.unknown()) }), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('SET_RESERVE'), payload: z.object({ bucket: z.string().trim().min(1), newOutstandingAmount: z.number().nonnegative().optional(), amount: z.number().nonnegative().optional(), effectiveDate: z.string().optional(), internalNote: z.string().optional() }).and(ReasonPayload), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('ADJUST_RESERVE'), payload: z.object({ bucket: z.string().trim().min(1), deltaAmount: z.number().optional(), amount: z.number().optional(), effectiveDate: z.string().optional(), internalNote: z.string().optional() }).and(ReasonPayload), idempotencyKey: z.string().trim().optional() }),
  z.object({
    type: z.literal('ADD_PAYMENT'),
    payload: z.object({
      bucket: z.string().trim().min(1).optional(),
      costCategory: z.string().trim().optional(),
      costSubType: z.string().trim().optional(),
      amount: z.number().positive().optional(),
      paymentDate: z.string().optional(),
      paymentType: z.string().optional(),
      payeeType: z.string().optional(),
      payeeCounterpartyId: z.string().trim().min(1).optional(),
      payeeRoleUsed: z.string().trim().optional(),
      reference: z.string().optional(),
      invoiceReference: z.string().optional(),
      note: z.string().optional(),
      overrideOutstanding: z.number().nonnegative().optional(),
      overrideReasonCode: z.string().optional(),
      overrideReason: z.string().optional(),
      allowOutstandingOverride: z.boolean().optional(),
      strictMode: z.boolean().optional(),
      allowOnRepudiated: z.boolean().optional(),
    }).and(ReasonPayload),
    idempotencyKey: z.string().trim().optional(),
  }),
  z.object({ type: z.literal('SET_RECOVERY_EXPECTED'), payload: z.object({ bucket: z.string().trim().min(1), amount: z.number().positive().optional(), expectedAmount: z.number().positive().optional(), recoveryType: z.string().optional(), expectedDate: z.string().optional(), effectiveDate: z.string().optional(), note: z.string().optional(), allowAboveIncurred: z.boolean().optional() }).and(ReasonPayload), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('ADD_RECOVERY_RECEIVED'), payload: z.object({ bucket: z.string().trim().min(1), amount: z.number().positive(), recoveryType: z.string().optional(), recoveryDate: z.string().optional(), reference: z.string().optional(), note: z.string().optional(), allowAboveIncurred: z.boolean().optional() }).and(ReasonPayload), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('DENY_CLAIM'), payload: z.object({ denialReason: z.string().trim().min(1), summary: z.string().trim().min(1), note: z.string().trim().optional() }), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('CREATE_APPOINTMENT'), payload: z.object({ appointeeType: z.string().trim().min(1), appointee: z.string().trim().min(1), instruction: z.string().trim().optional() }), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('SET_REFERRAL'), payload: ReasonPayload.extend({ referred: z.boolean().optional(), summary: z.string().optional() }), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('CLOSE'), payload: z.object({ closureReason: z.string().trim().min(1), summary: z.string().trim().min(1), note: z.string().trim().optional() }), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('REOPEN'), payload: z.object({ reopenReason: z.string().trim().min(1), summary: z.string().trim().min(1), note: z.string().trim().optional() }), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('ADD_CLAIM_NOTE'), payload: z.object({ note: z.string().trim().min(4) }), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('ADD_CLAIM_EVIDENCE'), payload: z.object({ documentType: z.string().trim().min(1), note: z.string().trim().optional(), fileId: z.string().trim().min(1), originalFilename: z.string().trim().min(1), fileUrl: z.string().trim().optional() }), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('WITHDRAW'), payload: z.object({ withdrawnAt: z.string().optional() }).and(ReasonPayload), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('ACKNOWLEDGE_CLAIM'), payload: z.object({ acknowledgedAt: z.string().optional(), channel: z.string().optional() }).default({}), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('CREATE_DIARY_ITEM'), payload: z.object({ diaryId: z.string().optional(), title: z.string().optional(), dueDate: z.string().optional(), priority: z.string().optional(), createdAt: z.string().optional() }).default({}), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('COMPLETE_DIARY_ITEM'), payload: z.object({ diaryId: z.string().optional(), completedAt: z.string().optional(), outcome: z.string().optional() }).default({}), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('INSTRUCT_FIELD_ADJUSTER'), payload: z.object({ instructionId: z.string().optional(), instructedAt: z.string().optional(), companyName: z.string().optional(), affiliated: z.boolean().optional(), note: z.string().optional() }).default({}), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('RECORD_ADJUSTER_REPORT'), payload: z.object({ instructionId: z.string().optional(), reportReceivedAt: z.string().optional(), reportReference: z.string().optional() }).default({}), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('RECEIVE_COMPLAINT'), payload: z.object({ complaintId: z.string().optional(), receivedAt: z.string().optional(), stage: z.string().optional(), slaDays: z.number().optional(), reason: z.string().optional() }).default({}), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('RESOLVE_COMPLAINT'), payload: z.object({ complaintId: z.string().optional(), resolvedAt: z.string().optional(), stage: z.string().optional() }).default({}), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('ESCALATE_COMPLAINT_TO_LONDON'), payload: z.object({ complaintId: z.string().optional(), escalatedAt: z.string().optional(), reason: z.string().optional() }).default({}), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('RECORD_PEER_REVIEW'), payload: z.object({ reviewedAt: z.string().optional(), reviewOutcome: z.string().optional(), reviewerUserId: z.string().optional() }).default({}), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('LOG_COMMUNICATION_SENT'), payload: z.object({ occurredAt: z.string().optional(), communicationType: z.string().optional(), partyType: z.string().optional(), channel: z.string().optional() }).default({}), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('LOG_COMMUNICATION_RECEIVED'), payload: z.object({ occurredAt: z.string().optional(), communicationType: z.string().optional(), partyType: z.string().optional(), channel: z.string().optional() }).default({}), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('ASSIGN_HANDLER'), payload: z.object({ handlerUserId: z.string().optional(), assignedAt: z.string().optional(), role: z.string().optional() }).default({}), idempotencyKey: z.string().trim().optional() }),
  z.object({ type: z.literal('SEND_FNOL_LINK'), payload: z.object({ sentAt: z.string().optional(), channel: z.string().optional(), recipient: z.string().email().optional() }).default({}), idempotencyKey: z.string().trim().optional() }),
]);

const FnolSubmitSchema = z.object({
  form: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().trim().optional(),
});

const CreateInfoRequestSchema = z.object({
  message: z.string().trim().min(3),
});

const RespondInfoRequestSchema = z.object({
  message: z.string().trim().min(1),
  documents: z.array(z.record(z.string(), z.unknown())).optional(),
});

const SendFnolLinkSchema = z.object({
  email: z.string().trim().email().optional(),
});

function mapCommandFailure(error: unknown): { status: number; code: string; message: string } {
  const message = error instanceof Error ? error.message : 'Failed to execute command';
  const normalized = message.toLowerCase();
  if (normalized.includes('fnol must be confirmed')) {
    return { status: 409, code: 'FNOL_NOT_CONFIRMED', message };
  }
  if (normalized.includes('requires reasoncode') || normalized.includes('requires explanation')) {
    return { status: 400, code: 'MOVEMENT_METADATA_REQUIRED', message };
  }
  if (normalized.includes('payment exceeds outstanding')) {
    return { status: 409, code: 'PAYMENT_EXCEEDS_OUTSTANDING', message };
  }
  if (normalized.includes('invalid payee role')) {
    return { status: 400, code: 'INVALID_PAYMENT_PAYEE_ROLE', message };
  }
  if (normalized.includes('invalid claim payment classification')) {
    return { status: 400, code: 'INVALID_PAYMENT_CLASSIFICATION', message };
  }
  if (normalized.includes('referral approval required')) {
    return { status: 409, code: 'REFERRAL_REQUIRED', message };
  }
  if (normalized.includes('cannot close while')) {
    return { status: 409, code: 'CLOSURE_INVARIANT_FAILED', message };
  }
  if (normalized.includes('cannot be closed while outstanding reserve')) {
    return { status: 409, code: 'CLOSURE_INVARIANT_FAILED', message };
  }
  if (normalized.includes('cannot deny claim')) {
    return { status: 409, code: 'DENIAL_INVARIANT_FAILED', message };
  }
  if (normalized.includes('is not allowed when claim is') || normalized.includes('only allowed when claim is')) {
    return { status: 409, code: 'ACTION_NOT_ALLOWED_IN_STATE', message };
  }
  if (normalized.includes('policy already linked')) {
    return { status: 409, code: 'POLICY_ALREADY_LINKED', message };
  }
  if (normalized.includes('policy not found')) {
    return { status: 404, code: 'POLICY_NOT_FOUND', message };
  }
  return { status: 400, code: 'COMMAND_FAILED', message };
}

router.get('/', claimsAuditLog, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 100)));
    const result = await listClaimsPage({
      page,
      pageSize,
      policyId: String(req.query.policyId || '').trim() || undefined,
      statusIn: String(req.query.statusIn || '').trim() || undefined,
      status: String(req.query.status || '').trim() || undefined,
      search: String(req.query.search || '').trim() || undefined,
      sortBy: String(req.query.sortBy || '').trim() || undefined,
      sortDir: String(req.query.sortDir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc',
    });
    return res.json({
      success: true,
      data: result.items,
      pagination: { page, pageSize, total: result.total, totalPages: result.totalPages },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: { code: 'CLAIMS_LIST_FAILED', message: error instanceof Error ? error.message : 'Failed to list claims' } });
  }
});

router.post('/', claimsAuditLog, async (req, res) => {
  try {
    const parsed = CreateClaimSchema.parse(req.body || {});
    const actor = req.user as Actor;
    const worksheet = parsed.worksheet || {};
    const requestedPolicyId = typeof parsed.policyId === 'string' ? parsed.policyId : null;
    const caseIntakeDraft = parsed.caseIntakeDraft || {};
    const dateOfLossFrom = String(worksheet.dateOfLossFrom || '').trim() || new Date().toISOString().slice(0, 10);
    const dateOfLossToRaw = String(worksheet.dateOfLossTo || '').trim();
    const parsedDateOfLossTo = dateOfLossToRaw ? new Date(dateOfLossToRaw) : null;
    const dateOfLossTo = parsedDateOfLossTo && !Number.isNaN(parsedDateOfLossTo.getTime()) ? parsedDateOfLossTo : null;
    const originalCurrency = String(worksheet.originalCurrency || '').trim().toUpperCase() || 'EUR';
    const lossCountry = String(worksheet.lossCountry || '').trim().toUpperCase();
    const created = await runTenantScopedTransaction(async (_tx) => {
      const tx = _tx as unknown as Prisma.TransactionClient;
      const policy = requestedPolicyId
        ? await tx.policy.findUnique({
            where: { id: requestedPolicyId },
            select: { id: true, quoteData: true, policyNumber: true, productType: true },
          })
        : null;
      if (requestedPolicyId && !policy) throw new Error('Policy not found');
      const incidentDate = new Date(dateOfLossFrom);
      const claimNumber = await claimsHttpDeps.reserveNextClaimNumber(
        tx,
        Number.isNaN(incidentDate.getTime()) ? new Date() : incidentDate,
      );
      // ABY-260 — Atomic claim creation when a policy is known at
      // case-create time. Previously the claim was inserted with
      // `policyId: null`, the transaction committed, and a separate
      // `LINK_POLICY` command (in its own transaction) updated
      // `claim.policyId`. If anything between those two transactions
      // failed (RLS rejection, validation, network blip), the claim
      // was left orphaned with `policyId: null` — the operator saw
      // an error but the half-created case lingered. Effie's report
      // "the case was not shown in the claims list" was the operator
      // looking for the case under the policy and not finding it
      // because the link never landed.
      //
      // Setting `policyId` directly on creation + emitting the
      // `POLICY_LINKED` event in the SAME transaction makes the
      // post-create `LINK_POLICY` command call below unnecessary and
      // closes the orphan-claim window. The `openClaimCommand` still
      // runs (it emits `CLAIM_OPENED` + refreshes the projection
      // snapshot); if it fails the operator sees an error, but the
      // claim is now persistently linked + visible in the list.
      const claim = await tx.claim.create({
        data: {
          policyId: requestedPolicyId,
          claimNumber,
          incidentDate: Number.isNaN(incidentDate.getTime()) ? new Date() : incidentDate,
          reportedDate: new Date(),
          firstNotifiedAt: new Date(),
          status: 'PENDING',
          description: parsed.description || worksheet.lossDescription || null,
          claimType: worksheet.causeOfLossCode || null,
          certificateReference: worksheet.certificateReference || null,
          dateOfLossFrom: Number.isNaN(incidentDate.getTime()) ? null : incidentDate,
          dateOfLossTo,
          lossCountry: lossCountry || null,
          causeOfLossCode: worksheet.causeOfLossCode || null,
          lossDescription: worksheet.lossDescription || null,
          originalCurrency: originalCurrency,
          data: {
            cr0029_certificate_reference: worksheet.certificateReference || null,
            cr0119_date_of_loss_from: dateOfLossFrom,
            cr0120_date_of_loss_to: worksheet.dateOfLossTo || null,
            cr0116_loss_country: lossCountry || null,
            cr0117_cause_of_loss_code: worksheet.causeOfLossCode || null,
            cr0118_loss_description: worksheet.lossDescription || null,
            cr0109_original_currency: originalCurrency,
            policyNumber: policy?.policyNumber || null,
            productType: policy?.productType || null,
            caseIntakeDraft,
          },
        } as unknown as Prisma.ClaimUncheckedCreateInput,
      });
      if (requestedPolicyId && policy) {
        // Emit the POLICY_LINKED audit event in the same tx so the
        // event log mirrors the schema state. The standalone
        // `LINK_POLICY` command path remains valid for later
        // policy-link flows (Link policy modal on an unlinked case);
        // this short-circuit only applies to known-policy case
        // creation. Routed through the `claimsHttpDeps` app-facade
        // (per `check-backend-layer-imports.mjs` — http never imports
        // from `domain/commands/*` directly).
        await claimsHttpDeps.appendClaimEvent({
          tx,
          claimId: claim.id,
          claimNumber: claim.claimNumber,
          command: 'LINK_POLICY',
          eventType: 'POLICY_LINKED',
          input: {
            actorType: actorTypeFromRole(actor?.role),
            actorId: String(actor?.id || 'system'),
            actorName: String(actor?.name || actor?.email || ''),
          },
          payload: {
            policyId: policy.id,
            linkReason: 'Known policy at case creation',
            linkedAt: new Date().toISOString(),
          },
        });
      }
      return claim;
    });

    if (requestedPolicyId) {
      await claimsHttpDeps.openClaimCommand({
        claimId: created.id,
        claimNumber: created.claimNumber,
        payload: {
          certificateReference: String(worksheet.certificateReference || ''),
          dateOfLossFrom,
          dateOfLossTo: worksheet.dateOfLossTo,
          lossCountry,
          causeOfLossCode: worksheet.causeOfLossCode,
          lossDescription: worksheet.lossDescription,
          originalCurrency,
          openedAt: worksheet.openedAt,
          referredToUw: worksheet.referredToUw,
        },
        input: {
          actorType: actorTypeFromRole(actor?.role),
          actorId: String(actor?.id || 'system'),
          actorName: String(actor?.name || actor?.email || ''),
        },
      });
    }

    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_BODY', message: error.issues[0]?.message || 'Invalid request body' } });
    }
    return res.status(400).json({ success: false, error: { code: 'CLAIM_CREATE_FAILED', message: error instanceof Error ? error.message : 'Failed to create claim' } });
  }
});

router.get('/:id', claimsAuditLog, async (req, res) => {
  try {
    const claim = await tenantScopedPrisma.claim.findUnique({
      where: { id: String(req.params.id) },
      include: {
        policy: { include: { policyHolder: true, binder: true } },
        events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
        infoRequests: { orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }] },
      },
    });
    if (!claim) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Claim not found' } });
    const claimData = asRecord(claim.data);
    const projection = claimsHttpDeps.buildClaimWorksheetProjection({
      claimId: claim.id,
      claimReference: claim.claimNumber,
      certificateReference: String(claimData.cr0029_certificate_reference || ''),
      events: claim.events,
    });
    return res.json({
      success: true,
      data: {
        ...claim,
        infoRequests: serializeInfoRequests(asArray<Record<string, unknown>>(claim.infoRequests)),
        worksheet: projection,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: { code: 'CLAIM_FETCH_FAILED', message: error instanceof Error ? error.message : 'Failed to fetch claim' } });
  }
});

router.get('/:id/statutory-timetable', claimsAuditLog, async (req, res) => {
  try {
    const result = await getClaimStatutoryTimetable(String(req.params.id));
    if (!result) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Claim not found' } });
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, error: { code: 'CLAIM_TIMETABLE_FAILED', message: error instanceof Error ? error.message : 'Failed to compute statutory timetable' } });
  }
});

router.get('/:id/worksheet', claimsAuditLog, async (req, res) => {
  try {
    const claim = await tenantScopedPrisma.claim.findUnique({
      where: { id: String(req.params.id) },
      include: {
        policy: { include: { binder: true, policyHolder: true } },
        events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
        infoRequests: { orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }] },
      },
    });
    if (!claim) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Claim not found' } });
    const claimData = asRecord(claim.data);
    const projection = claimsHttpDeps.buildClaimWorksheetProjection({
      claimId: claim.id,
      claimReference: claim.claimNumber,
      certificateReference: String(claimData.cr0029_certificate_reference || ''),
      events: claim.events,
    });
    const fnolSnapshot = asRecord(projection.intake?.fnol);
    const { resolvedLossCountry, complianceGaps } = buildClaimWorksheetCompliance({
      claimData,
      fnolSnapshot,
      projection,
    });

    const docsFromClaim = asArray<Record<string, unknown>>(claim.documents);
    const caseIntakeDraft = normalizeCaseIntakeDraft(claimData.caseIntakeDraft);
    const infoRequests = serializeInfoRequests(asArray<Record<string, unknown>>(claim.infoRequests));
    // ABY-268: read the actual worker delivery state for the FNOL link
    // email so the UI can say "Queued / Sent / Failed" instead of
    // stamping "Sent" on every queue acceptance.
    const fnolLinkDelivery = await loadFnolLinkDeliveryStatus(claim.id);
    const paymentModel = {
      classifications: listClaimPaymentEligibilityRulesForHttp().map((rule) => ({
        costCategory: rule.costCategory,
        costSubType: rule.costSubType,
        allowedPayeeRoles: rule.allowedPayeeRoles,
        reportingTreatment: rule.reportingTreatment,
        operationalBucket: rule.operationalBucket,
        requiresInvoiceReference: rule.requiresInvoiceReference,
        requiresNote: rule.requiresNote,
        uiLabel: rule.uiLabel,
        guidance: rule.guidance || null,
      })),
      payees: await listClaimCounterparties(prisma, claim.id),
    };

    return res.json({
      success: true,
      data: {
        claimId: claim.id,
        claimReference: claim.claimNumber,
        policyId: claim.policyId,
        policyNumber: claim.policy?.policyNumber || '',
        topBar: {
          status: projection.status,
          phase: projection.phase,
          referredToUw: projection.cr0106ReferredToUnderwriters,
          denied: projection.cr0107Denial,
          lastUpdatedAt: projection.latestActivityAt || '',
          lastActorName: projection.latestActorName || '',
        },
        summary: {
          claimType: claim.claimType || '',
          description: claim.description || '',
          cr0029_certificate_reference: String(claimData.cr0029_certificate_reference || ''),
          cr0119_date_of_loss_from: String(claimData.cr0119_date_of_loss_from || ''),
          cr0120_date_of_loss_to: String(claimData.cr0120_date_of_loss_to || ''),
          cr0116_loss_country: resolvedLossCountry,
          cr0117_cause_of_loss_code: String(claimData.cr0117_cause_of_loss_code || ''),
          cr0118_loss_description: String(claimData.cr0118_loss_description || ''),
          cr0109_original_currency: String(claimData.cr0109_original_currency || 'EUR'),
          fnolFinalSubmittedAt: String(claimData.fnolFinalSubmittedAt || ''),
          financials: {
            paidIndemnity: projection.paidIndemnity,
            paidFees: projection.paidFees,
            reserveIndemnity: projection.reserveIndemnity,
            reserveFees: projection.reserveFees,
            totalPaid: projection.totalPaid,
            totalOutstanding: projection.totalOutstanding,
            totalIncurred: projection.totalIncurred,
            grossIncurred: projection.totalIncurred,
            totalRecovered: projection.totalRecovered,
            netIncurred: projection.netIncurred,
            recoveriesExpected: projection.recoveriesExpected,
            salvageRealized: projection.salvageRealized,
            salvageExpected: projection.salvageExpected,
            buckets: projection.buckets,
          },
        },
        intake: projection.intake,
        case: {
          isUnlinked: !claim.policyId,
          firstNotifiedAt: projection.firstNotifiedAt || '',
          policyLinkedAt: projection.policyLinkedAt || null,
          intakeDraft: caseIntakeDraft,
          infoRequests,
        },
        orientation: {
          cr0105Status: projection.status,
          referredToUw: projection.cr0106ReferredToUnderwriters,
          denied: projection.cr0107Denial,
        },
        complianceGaps,
        timeline: projection.timeline,
        documents: docsFromClaim,
        paymentModel,
        comms: {
          entityType: 'CLAIM',
          entityId: claim.id,
          policyholder: {
            name: String(claim.policy?.policyHolder?.name || ''),
            email: String(claim.policy?.policyHolder?.contact || ''),
            phone: '',
          },
          fnolLinkDelivery,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: { code: 'WORKSHEET_FETCH_FAILED', message: error instanceof Error ? error.message : 'Failed to fetch worksheet' } });
  }
});

router.post('/:id/fnol/submit', claimsAuditLog, async (req, res) => {
  try {
    const parsed = FnolSubmitSchema.parse(req.body || {});
    const actor = req.user as Actor;
    await executeWorksheetCommand({
      claimId: String(req.params.id),
      type: 'SUBMIT_FNOL',
      payload: { fnol: claimsHttpDeps.normalizeCanonicalIntake(parsed.form) },
      actor: {
        actorType: actorTypeFromRole(actor?.role),
        actorId: String(actor?.id || 'system'),
        actorName: String(actor?.name || actor?.email || ''),
        idempotencyKey: parsed.idempotencyKey,
      },
    });
    return res.json({ success: true, data: { ok: true } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_BODY', message: error.issues[0]?.message || 'Invalid request body' } });
    }
    return res.status(400).json({ success: false, error: { code: 'FNOL_SUBMIT_FAILED', message: error instanceof Error ? error.message : 'Failed to submit FNOL final form' } });
  }
});

router.post('/:id/commands', claimsAuditLog, requirePermission('claims', 'reserve'), async (req, res) => {
  try {
    const parsed = CommandSchema.parse(req.body || {});
    const actor = req.user as Actor;
    await executeWorksheetCommand({
      claimId: String(req.params.id),
      type: parsed.type,
      payload: parsed.payload,
      actor: {
        actorType: actorTypeFromRole(actor?.role),
        actorId: String(actor?.id || 'system'),
        actorName: String(actor?.name || actor?.email || ''),
        idempotencyKey: parsed.idempotencyKey,
      },
    });
    const view = await getClaimWorksheetView(String(req.params.id));
    if (!view) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Claim not found' } });
    return res.json({ success: true, data: view });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_BODY', message: error.issues[0]?.message || 'Invalid request body' } });
    }
    const mapped = mapCommandFailure(error);
    return res.status(mapped.status).json({ success: false, error: { code: mapped.code, message: mapped.message } });
  }
});

router.post('/:id/info-requests', claimsAuditLog, async (req, res) => {
  try {
    const parsed = CreateInfoRequestSchema.parse(req.body || {});
    const claimId = String(req.params.id);
    const actor = req.user as Actor;
    const result = await createClaimInfoRequest({
      claimId,
      message: parsed.message,
      requestedByUserId: String(actor?.id || ''),
      requestedByName: String(actor?.name || actor?.email || ''),
    });
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        error: { code: result.code, message: result.message },
      });
    }
    return res.status(201).json({ success: true, data: result.data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_BODY', message: error.issues[0]?.message || 'Invalid request body' } });
    }
    return res.status(500).json({ success: false, error: { code: 'INFO_REQUEST_CREATE_FAILED', message: error instanceof Error ? error.message : 'Failed to create info request' } });
  }
});

router.post('/:id/info-requests/:requestId/respond', claimsAuditLog, async (req, res) => {
  try {
    const parsed = RespondInfoRequestSchema.parse(req.body || {});
    const claimId = String(req.params.id);
    const requestId = String(req.params.requestId);
    const actor = req.user as Actor;
    const result = await respondToClaimInfoRequest({
      claimId,
      requestId,
      message: parsed.message,
      documents: parsed.documents,
      resolvedByUserId: String(actor?.id || ''),
    });
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        error: { code: result.code, message: result.message },
      });
    }
    return res.json({ success: true, data: result.data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_BODY', message: error.issues[0]?.message || 'Invalid request body' } });
    }
    return res.status(500).json({ success: false, error: { code: 'INFO_REQUEST_RESPONSE_FAILED', message: error instanceof Error ? error.message : 'Failed to respond to info request' } });
  }
});

// ADR-0041 — Claim Memory projection read + manual refresh.
// The projection is built asynchronously by the `CLAIM_MEMORY.REFRESH`
// worker; the Claim Workspace co-pilot card polls the GET endpoint and
// the Refresh button posts to the enqueue endpoint.
router.get('/:id/memory', claimsAuditLog, async (req, res) => {
  try {
    const claimId = String(req.params.id);
    const memory = await getClaimMemory({ claimId });
    if (!memory) {
      return res.json({
        success: true,
        data: {
          claimId,
          status: 'absent' as const,
          projection: null,
          stalenessWarning: false,
        },
      });
    }
    return res.json({
      success: true,
      data: {
        claimId,
        status: 'present' as const,
        stalenessWarning: memory.stalenessWarning,
        projection: {
          summary: memory.projection.summary,
          summaryCitations: memory.projection.summaryCitations,
          memoryObject: memory.projection.memoryObject,
          similarClaims: memory.projection.similarClaims,
          graphSignals: memory.projection.graphSignals,
          refreshStatus: memory.projection.refreshStatus,
          refreshError: memory.projection.refreshError,
          lastRefreshedAt: memory.projection.lastRefreshedAt,
          updatedAt: memory.projection.updatedAt,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'CLAIM_MEMORY_READ_FAILED',
        message: error instanceof Error ? error.message : 'Failed to load claim memory',
      },
    });
  }
});

router.post('/:id/memory/refresh', claimsAuditLog, async (req, res) => {
  try {
    const claimId = String(req.params.id);
    const exists = await tenantScopedPrisma.claim.findUnique({ where: { id: claimId }, select: { id: true } });
    if (!exists) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Claim not found' } });
    }
    const actor = req.user as Actor;
    await enqueueClaimMemoryRefresh(prisma, {
      claimId,
      reason: 'bo_route',
      actorId: String(actor?.id || 'system'),
      actorName: String(actor?.name || actor?.email || ''),
      // AuditLogger accepts only USER | SYSTEM — BO refreshes are USER-driven.
      actorType: actor?.id ? 'USER' : 'SYSTEM',
    });
    return res.json({
      success: true,
      data: {
        claimId,
        enqueued: true,
        message: 'Claim memory refresh enqueued; projection will update shortly.',
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'CLAIM_MEMORY_REFRESH_ENQUEUE_FAILED',
        message: error instanceof Error ? error.message : 'Failed to enqueue claim memory refresh',
      },
    });
  }
});

// ADR-0044 — retrieval-grounded, read-only "ask" over claim memory.
// The LLM may only phrase the cited evidence; it cannot mutate state or
// decide a gate.
const AskMemorySchema = z.object({ question: z.string().trim().min(2).max(500) });

router.post('/:id/memory/ask', claimsAuditLog, async (req, res) => {
  const parsed = AskMemorySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_BODY', message: 'question is required' } });
  }
  try {
    const claimId = String(req.params.id);
    const result = await askClaimMemory({ claimId, question: parsed.data.question });
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'CLAIM_MEMORY_ASK_FAILED', message: error instanceof Error ? error.message : 'Ask failed' },
    });
  }
});

router.post('/:id/fnol-link/send', claimsAuditLog, async (req, res) => {
  try {
    const parsed = SendFnolLinkSchema.parse(req.body || {});
    const claimId = String(req.params.id);
    const actor = req.user as Actor;
    const result = await sendFnolLinkForClaim({
      claimId,
      requestedEmail: parsed.email,
      actor: {
        actorType: actorTypeFromRole(actor?.role),
        actorId: String(actor?.id || 'system'),
        actorName: String(actor?.name || actor?.email || ''),
      },
    });
    if (!result.ok) {
      return res
        .status(result.status)
        .json({ success: false, error: { code: result.code, message: result.message } });
    }
    return res.json({
      success: true,
      data: {
        sent: true,
        recipientEmail: result.recipientEmail,
        fnolLink: result.fnolLink,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_BODY', message: error.issues[0]?.message || 'Invalid request body' } });
    }
    return res.status(500).json({ success: false, error: { code: 'FNOL_LINK_SEND_FAILED', message: error instanceof Error ? error.message : 'Failed to send FNOL link' } });
  }
});

export default router;


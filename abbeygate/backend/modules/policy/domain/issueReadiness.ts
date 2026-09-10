/**
 * Issue-Readiness: Orchestrator + Façade
 *
 * Evaluates whether a policy is ready for issuance by checking payment,
 * documents, underwriting, pricing, and compliance gates.
 *
 * Re-exports types and guards for backward compatibility — downstream
 * consumers continue to import from this module unchanged.
 */

import { issueReadinessResultSchema } from '../../../platform/types/contracts.js';
import { ProductRegistry } from './ProductRegistry.js';
import { getIssueReadinessRepository } from './issueReadinessRepositoryPort.js';
import {
  isEndorsementTransactionType,
  isPolicyChangeTransactionType,
} from './riskTransactionTypes.js';
import { buildQuoteDataInvalidBlocker } from './quoteDataInvalidBlocker.js';
import { computePricingIntegrityStamp } from './pricingIntegrityStamp.js';

// ─── Re-exports (façade) ─────────────────────────────────────────────
export * from './issueReadinessTypes.js';
export * from './issueReadinessGuards.js';

// ─── Imports from extracted modules ──────────────────────────────────
import type { IssueBlocker, IssueBlockerGroup, IssueChannel, IssueReadinessResult } from './issueReadinessTypes.js';
import {
  actorFromChannel,
  asRecord,
  getPaymentConfirmed,
  getWelcomeEmailSentFromSnapshot,
  hasMeaningfulValue,
  isObject,
  parseIsoOrEmpty,
  parseSnapshot,
  resolveUwWorkflowState,
  toLastModifiedByLabel,
  type UnknownRecord,
} from './issueReadinessGuards.js';

type LifecycleStatus = import('./status.js').LifecycleStatus;

// quoteReadyFieldKeys are resolved per-product via the adapter — no module-level motor constant.
// QUOTE_DATA_INVALID blocker construction (humanization, group, message,
// details) lives in `./quoteDataInvalidBlocker.ts` — the canonical
// builder. Adding a parallel implementation here would re-introduce
// the duplication that used to ship two divergent messages for the
// same validation failure.

// Helper extractions live under `./issueReadiness/` (sprint follow-up F4b)
// to keep this orchestrator under the file-size cap.
import {
  buildValidationDiagnostics,
  formatConditionalRequirementsMessage,
} from './issueReadiness/diagnostics.js';
import { evaluateAuthorityWindowBlockers } from './issueReadiness/authorityWindow.js';


// `evaluateIssueReadinessForQuoteData` was deleted alongside the
// QUOTE_DATA_INVALID humanization fix. It was a parallel orchestrator
// that emitted a divergent blocker (group `'PRICING'`, no humanized
// missing-fields list) for the same `adapter.validateForIssuance(...)`
// result the canonical `evaluateIssueReadiness` consumed — the textbook
// canonical-ownership violation called out in
// `docs/architecture/contracts/canonical-ownership.md`.
//
// Callers that need only the structured adapter verdict (e.g. BDX
// import constructing its own gap rows) MUST use
// `validateQuoteDataForIssuanceCanonical` from
// `./quoteDataIssuanceValidator.ts`. Callers that need a full readiness
// derivation MUST go through `evaluateIssueReadiness` below.

// ─── Full Issue-Readiness Evaluator (Orchestrator) ───────────────────

export async function evaluateIssueReadiness(
  policyId: string,
  channel: IssueChannel,
  opts?: { riskTransactionId?: string | null }
): Promise<IssueReadinessResult> {
  const repository = getIssueReadinessRepository();
  const policy = await repository.findPolicyForIssueReadiness(policyId);
  const productType = policy?.productType ? String(policy.productType) : null;
  const adapter = productType ? ProductRegistry.getInstance().getAdapter(productType) : null;

  // Short-circuit early-returns. Removed in `spine/v2` Wave 5: the
  // previous `adapter?.foo() ?? default` cascade ran every downstream
  // check against an absent adapter even after pushing
  // PRODUCT_NOT_SUPPORTED / PRODUCT_NOT_ASSIGNED — fail-open noise.
  // Now: if policy / product / adapter is missing, return the blocker
  // result immediately. Below this point `policy`, `productType`, and
  // `adapter` are all guaranteed non-null.
  const emptyDerived = {
    hasQuoteData: false,
    hasQuoteResponse: false,
    hasPaymentConfirmed: false,
    hasBoundInceptionTransaction: false,
    hasIssuedPackDocuments: false,
    hasWelcomeEmailSent: false,
    isLocked: false,
    hasUwCompleted: false,
    pricingHashMatches: false,
    missingForQuotePack: [],
    missingForIssuedPack: [],
    missingIssuedDocumentTypes: [],
  } as const;
  const emptyUwStateMeta = {
    hasOpenFollowUps: false,
    openFollowUpsCount: 0,
    isQuoteReady: false,
  } as const;
  function blockerOnlyResult(blocker: IssueBlocker): IssueReadinessResult {
    return {
      channel,
      policyId,
      status: 'DRAFT',
      canIssue: false,
      canGenerateQuotePack: false,
      canGenerateIssuedDocs: false,
      missingFields: [],
      conditionalRequirements: [],
      blockers: [blocker],
      uwState: 'NOT_STARTED',
      uwStateMeta: { ...emptyUwStateMeta },
      derived: { ...emptyDerived, missingForQuotePack: [], missingForIssuedPack: [], missingIssuedDocumentTypes: [] },
    };
  }
  if (!policy) {
    return blockerOnlyResult({ code: 'UNKNOWN', message: 'Policy not found' });
  }
  if (!productType) {
    return blockerOnlyResult({
      code: 'PRODUCT_NOT_ASSIGNED',
      message: 'No product type assigned to this policy. Select a program to assign a product.',
      group: 'OTHER',
      severity: 'BLOCK',
    });
  }
  if (!adapter) {
    return blockerOnlyResult({
      code: 'PRODUCT_NOT_SUPPORTED',
      message: `Product type '${productType}' does not have a registered readiness adapter. Contact support.`,
      group: 'OTHER',
      severity: 'BLOCK',
    });
  }

  const journeyMeta = adapter.getRuntimeDefinition()?.customerJourney ?? adapter.getCustomerJourneyMeta() ?? {};

  const policyStatusModule = await import('./status.js');
  const status = policyStatusModule.resolveLifecycleStatus(policy.status, {
    inceptionDate: policy.inceptionDate,
    expiryDate: policy.expiryDate
  });
  const hasPaymentConfirmed = getPaymentConfirmed(policy);
  const hasWelcomeEmailSentFromSnapshot = getWelcomeEmailSentFromSnapshot(policy);
  const isLocked = Boolean(policy.isLocked);

  const inception = await repository.findBoundInceptionTransaction(policyId);
  const hasBoundInceptionTransaction = Boolean(inception?.id);
  const requiredIssuedDocTypes = adapter.getRequiredIssuedDocTypes();
  const generatedIssuedDocs = await repository.findGeneratedIssuedDocuments(policy.id, requiredIssuedDocTypes);
  const generatedIssuedDocTypes = new Set(
    generatedIssuedDocs.map((d) => String(d.type || '').trim()).filter(Boolean)
  );
  const missingIssuedDocumentTypes = requiredIssuedDocTypes.filter((t) => !generatedIssuedDocTypes.has(t));
  const hasIssuedPackDocuments = missingIssuedDocumentTypes.length === 0;
  const latestPaidPayment = hasPaymentConfirmed
    ? await repository.findLatestPaidPayment(policy.id)
    : null;
  const welcomeEmailEvent = latestPaidPayment?.id
    ? await repository.findPaymentEvent(latestPaidPayment.id, 'WELCOME_EMAIL_SENT')
    : null;
  const welcomeEmailFailureEvent = latestPaidPayment?.id
    ? await repository.findLatestPaymentFailureEvent(latestPaidPayment.id, 'WELCOME_EMAIL_FAILED')
    : null;
  const hasWelcomeEmailSent = hasWelcomeEmailSentFromSnapshot || Boolean(welcomeEmailEvent?.paymentId);
  const welcomeFailurePayload = asRecord(welcomeEmailFailureEvent?.payload);
  const welcomeFailureReason = String(welcomeFailurePayload.reason || '').trim();
  const welcomeFailureAt = welcomeEmailFailureEvent?.receivedAt ? new Date(welcomeEmailFailureEvent.receivedAt).toISOString() : '';
  const paidAtIso = latestPaidPayment?.createdAt ? new Date(latestPaidPayment.createdAt).toISOString() : '';
  const pendingMinutesSincePaid =
    latestPaidPayment?.createdAt ? Math.max(0, Math.floor((Date.now() - new Date(latestPaidPayment.createdAt).getTime()) / 60000)) : 0;

  // ADR-0017 — terminal `customerOutcome: 'failed'` detection.
  // Compare the latest worker-side issued-pack failure audit against
  // the latest GENERATED `ISSUED_POLICY_PACK` document. If a failure
  // was recorded after the last successful generation (or no doc has
  // ever been generated), the pack is permanently failed: surface a
  // BLOCK-severity blocker AND flip `customerOutcome` so the wizard
  // exits its `pending` polling loop. Without this signal, ABY-97/98
  // showed "stuck on document generation" forever and the customer
  // silently bounced back to the payment step.
  const [latestIssuedPackFailure, latestGeneratedIssuedAt] = hasPaymentConfirmed
    ? await Promise.all([
        repository.findLatestIssuedPackFailureEvent(policy.id),
        repository.findLatestGeneratedIssuedDocumentTimestamp(policy.id),
      ])
    : [null, null];
  const issuedPackFailureNewerThanLastDoc = (() => {
    if (!latestIssuedPackFailure) return false;
    if (!latestGeneratedIssuedAt) return true;
    return latestIssuedPackFailure.receivedAt.getTime() > new Date(latestGeneratedIssuedAt).getTime();
  })();
  const docsGenerationFailed = Boolean(
    latestIssuedPackFailure && issuedPackFailureNewerThanLastDoc && !hasIssuedPackDocuments,
  );
  const issuedPackFailurePayload = asRecord(latestIssuedPackFailure?.payload);
  const issuedPackFailureReason = String(issuedPackFailurePayload.reason || '').trim();
  const issuedPackFailureAt = latestIssuedPackFailure?.receivedAt
    ? new Date(latestIssuedPackFailure.receivedAt).toISOString()
    : '';

  const blockers: IssueBlocker[] = [];

  // Authority lifecycle window — Wave 4 of `spine/v2`. Blocks
  // issuance when Program / Binder / BinderProductAuthority is
  // non-ACTIVE or when policy.inceptionDate is outside the
  // configured `[effectiveFrom, effectiveTo]` window.
  const authorityWindowBlockers = await evaluateAuthorityWindowBlockers(repository, policyId, productType);
  for (const blocker of authorityWindowBlockers) {
    blockers.push(blocker);
  }

  const snapObj = parseSnapshot(policy?.stateCurrent?.snapshot);
  const sanctionsSnapshot = asRecord(asRecord(asRecord(snapObj).compliance).sanctions);
  const sanctionsStatus = String(sanctionsSnapshot.status || '').trim().toLowerCase();
  const sanctionsBlocking = Boolean(sanctionsSnapshot.blocking);
  if (sanctionsBlocking && sanctionsStatus) {
    const sanctionsEvidence = {
      provider: sanctionsSnapshot.provider,
      actionType: sanctionsSnapshot.actionType,
      reasonCode: sanctionsSnapshot.reasonCode,
      screeningRunId: sanctionsSnapshot.screeningRunId,
      providerSearchId: sanctionsSnapshot.providerSearchId,
      providerRiskRating: sanctionsSnapshot.providerRiskRating,
      hitCount: sanctionsSnapshot.hitCount,
      // Top-hit projection persisted by SanctionsService — drives the
      // single-row table rendered by PremiumNotes + UnderwritingReadinessCard.
      firstHit: sanctionsSnapshot.firstHit ?? null,
      // Document.id of the Creditsafe PDF report; the BO surfaces a download
      // link to /api/documents/{reportFilename}. Null until the PDF lands
      // (or when the run was clean / provider was unavailable).
      reportDocumentId: sanctionsSnapshot.reportDocumentId ?? null,
      reportFilename: sanctionsSnapshot.reportFilename ?? null,
    };
    const evidenceMissing = !String(sanctionsEvidence.providerSearchId || '').trim() ||
      !String(sanctionsEvidence.providerRiskRating || '').trim();
    if (sanctionsStatus === 'provider_unavailable' || sanctionsStatus === 'error') {
      blockers.push({
        code: 'SANCTIONS_PROVIDER_UNAVAILABLE',
        message: 'Sanctions screening is unavailable. Binding/issuance is blocked until screening succeeds.',
        group: 'UNDERWRITING',
        severity: 'BLOCK',
        details: sanctionsEvidence,
      });
    } else if (sanctionsStatus === 'possible_match' || sanctionsStatus === 'match') {
      blockers.push({
        code: evidenceMissing ? 'SANCTIONS_EVIDENCE_MISSING' : 'SANCTIONS_BLOCKED',
        message: evidenceMissing
          ? 'Sanctions screening evidence is incomplete. Re-run screening before manual review or bind/issue.'
          : 'Sanctions screening returned a potential match. Manual review is required before bind/issue.',
        group: 'UNDERWRITING',
        severity: 'BLOCK',
        details: sanctionsEvidence,
      });
    }
  }

  const ctxRtId = opts?.riskTransactionId ? String(opts.riskTransactionId).trim() : '';
  const ctxIsActive = Boolean(ctxRtId);
  let ctxRtType: string = '';
  let ctxSnapshotObj: UnknownRecord = snapObj;
  let ctxStatusForGates: LifecycleStatus = status;

  if (ctxIsActive) {
    const rt = await repository.findRiskTransactionContext(ctxRtId, policy.id);
    if (rt) {
      const rtStatus = String(rt.status || '').toUpperCase();
      const rtType = String(rt.transactionType || '').toUpperCase();
      ctxRtType = rtType;
      const rawSnap = rtStatus === 'BOUND' ? rt.snapshotFinal : rt.snapshotDraft;
      ctxSnapshotObj = parseSnapshot(rawSnap);

      // Treat endorsement drafts as an editable quote workspace, even when the policy lifecycle is ISSUED.
      if (isPolicyChangeTransactionType(rtType) && rtStatus === 'DRAFT') ctxStatusForGates = 'QUOTED';
      else if (rtStatus === 'BOUND') ctxStatusForGates = 'BOUND';
    }
  }
  const alreadyIssued = !ctxIsActive && (status === 'ACTIVE' || status === 'ISSUED');

  // BO workspace uses policyStateCurrent.snapshot as the source of truth for in-progress drafts
  // (including endorsement drafts). Prefer snapshot quoteData/quoteResponse when present.
  const snapshotRec = asRecord(ctxSnapshotObj);
  const snapshotQuoteData = snapshotRec.quoteData;
  const snapshotQuoteResponse = snapshotRec.quoteResponse;
  // Keep quote-data extraction resilient even when quoteResponse shape drifts.
  // Readiness checks must not depend on strict snapshot-wide schema parsing.
  const effectiveQuoteData = isObject(snapshotQuoteData) ? snapshotQuoteData : policy.quoteData;
  const effectiveQuoteResponse = isObject(snapshotQuoteResponse) ? snapshotQuoteResponse : policy.quoteResponse;
  const hasQuoteData = Boolean(effectiveQuoteData);
  const hasQuoteResponse = adapter.hasValidQuoteResponse(effectiveQuoteResponse);
  const manualUwApproval = asRecord(asRecord(snapObj?.uw).manualApproval);
  const hasManualUwApproval = Boolean(manualUwApproval.approvedAt);
  const effectiveQuoteDataRecord = asRecord(effectiveQuoteData);
  const quoteReadyFieldKeys = adapter.getQuoteReadyFieldKeys();
  const quoteReadyRequiredMissing = quoteReadyFieldKeys.filter((key) => !hasMeaningfulValue(effectiveQuoteDataRecord[key]));
  const customerFlow = asRecord(snapshotRec.customerFlow);
  const questionnaireSentAt = parseIsoOrEmpty(customerFlow.inviteSentAt);
  const customerStartedAt = parseIsoOrEmpty(customerFlow.customerStartedAt);
  const uwStartedAt = parseIsoOrEmpty(customerFlow.uwStartedAt);
  const lastSavedAt = parseIsoOrEmpty(customerFlow.lastSavedAt);
  const followUpsSentAt =
    parseIsoOrEmpty(asRecord(effectiveQuoteDataRecord.__meta).lastFollowUpRequestedAt) ||
    parseIsoOrEmpty(customerFlow.followUpsSentAt);
  const followUpRequests = Array.isArray(effectiveQuoteDataRecord.__followUpRequests)
    ? effectiveQuoteDataRecord.__followUpRequests
    : [];
  const followUpAnswers = asRecord(effectiveQuoteDataRecord.__followUpAnswers);
  const openFollowUpsCount = followUpRequests.filter((req) => {
    const id = String(asRecord(req).id || '').trim();
    if (!id) return true;
    return !String(followUpAnswers[id] || '').trim();
  }).length;
  const hasOpenFollowUps = openFollowUpsCount > 0;
  const flowContext = asRecord(snapshotRec.flow_context);
  const channelActor = actorFromChannel(flowContext.channel);
  const lastSavedByRaw = String(customerFlow.lastSavedBy || '').trim().toLowerCase();
  const lastSavedBy: 'customer' | 'underwriter' | 'system' | undefined =
    lastSavedByRaw === 'customer' || lastSavedByRaw === 'underwriter' || lastSavedByRaw === 'system'
      ? lastSavedByRaw
      : channelActor;
  const lastSavedByName = String(customerFlow.lastSavedByName || '').trim() || undefined;
  const lastModifiedBy = lastSavedBy === 'customer'
    ? 'Customer'
    : lastSavedBy === 'underwriter'
      ? 'Underwriter'
      : lastSavedBy === 'system'
        ? 'System'
        : toLastModifiedByLabel(String(flowContext.channel || ''));
  const isQuoteReady = hasQuoteResponse || quoteReadyRequiredMissing.length === 0;
  const uwState = resolveUwWorkflowState({
    hasOpenFollowUps,
    isQuoteReady,
    questionnaireSentAt,
    customerStartedAt,
    uwStartedAt,
    lastSavedBy,
  });

  // Locked: already issued/active
  if (!ctxIsActive && (status === 'ACTIVE' || status === 'ISSUED')) {
    // Not a "blocker" for customer outcome; but for canIssue we treat as already done.
    blockers.push({ code: 'POLICY_LOCKED_BY_TRANSACTION', message: 'Policy is already issued.' });
  }

  // Locked surface: prevent issuance attempts when locked in a non-issued state (e.g. payment pending)
  if (isLocked && !(status === 'ACTIVE' || status === 'ISSUED') && !(ctxIsActive && isPolicyChangeTransactionType(ctxRtType))) {
    blockers.push({
      code: 'POLICY_LOCKED_BY_TRANSACTION',
      message: 'This quote is locked while a transaction is in progress.',
      group: 'LOCK',
      severity: 'BLOCK',
      details: { status }
    });
  }

  // Referral/decline gates
  if (status === 'REFERRAL' && !hasManualUwApproval) {
    blockers.push({
      code: 'REFERRAL_PENDING_APPROVAL',
      message: 'Underwriting referral requires approval before issuing.',
      group: 'STATUS',
      severity: 'BLOCK',
      actions: [{ label: 'Manual underwriter approval', actionId: 'BO.MANUAL_UW_APPROVAL' }],
    });
  }
  if (status === 'DECLINED') {
    blockers.push({
      code: 'DECLINED',
      message: 'This risk was declined and cannot be issued.',
      group: 'STATUS',
      severity: 'BLOCK',
    });
  }

  // Pricing gate: must be rated
  const isRatedStatus =
    ctxStatusForGates === 'QUOTED' ||
    ctxStatusForGates === 'AWAITING_PAYMENT' ||
    ctxStatusForGates === 'REFERRAL' ||
    ctxStatusForGates === 'DECLINED' ||
    ctxStatusForGates === 'BOUND' ||
    ctxStatusForGates === 'BOUND_DRAFT_ISSUED';
  if (!alreadyIssued && status !== 'DECLINED' && (!hasQuoteResponse || !isRatedStatus)) {
    blockers.push({
      code: 'PRICING_INVALID',
      message: 'Premium is not finalized yet. Please rate the quote before issuing.',
      group: 'PRICING',
      severity: 'BLOCK',
      actions: [
        { label: 'Recalculate premium', actionId: 'BO.RECALC_PREMIUM' },
        // BO must resolve the public session token client-side (UUID policyId is not valid in customer flow URLs).
        { label: 'Open customer quote', actionId: 'BO.OPEN_CUSTOMER_QUOTE', hash: journeyMeta.pricingStep || 'your-quote' },
      ],
      details: { status: ctxStatusForGates, hasQuoteResponse },
    });
  }

  // Product adapters own issue-data validation. Snapshot compliance is a legacy
  // draft-time cache and is deliberately not issue-blocking.
  const productValidation = adapter ? await adapter.validateForIssuance(effectiveQuoteData) : {
    valid: true, schemaIssues: [], missingSlugs: [],
    missingForQuotePack: [], missingForIssuedPack: [], conditionalRequirements: [],
  };
  const missingForQuotePack = productValidation.missingForQuotePack;
  const missingForIssuedPack = productValidation.missingForIssuedPack;
  const conditionalRequirements = productValidation.conditionalRequirements as IssueReadinessResult['conditionalRequirements'];
  const quoteValidationIssues = productValidation.schemaIssues;
  const validationDiagnostics = buildValidationDiagnostics({
    productType,
    quoteData: effectiveQuoteDataRecord,
    missingForIssuedPack,
    schemaIssues: quoteValidationIssues,
    conditionalRequirements,
  });

  const uw = asRecord(snapObj?.uw);
  const uwCompletedMarker = Boolean(uw.completedAt) && Boolean(asRecord(uw.validationResult).isValid);
  const uwCompletedDerivedForBo = channel === 'bo' && hasQuoteData && adapter.isUwComplete(effectiveQuoteData, missingForIssuedPack);
  const uwCompleted = uwCompletedMarker || uwCompletedDerivedForBo;
  const skipUwBecauseIssued = !ctxIsActive && (status === 'ACTIVE' || status === 'ISSUED');
  const skipUwBecauseEndorsement = ctxIsActive && isEndorsementTransactionType(ctxRtType);
  const skipStrictIssuedDataChecksForEndorsement = ctxIsActive && isEndorsementTransactionType(ctxRtType);
  if (!skipUwBecauseIssued && !skipUwBecauseEndorsement && !uwCompleted) {
    blockers.push({
      code: 'UW_INCOMPLETE',
      message: 'Underwriting is incomplete. Please complete the quote journey before issuing.',
      group: 'UNDERWRITING',
      severity: 'BLOCK',
      actions: [
        // BO must resolve the public session token client-side (UUID policyId is not valid in customer flow URLs).
        { label: 'Open customer quote', actionId: 'BO.OPEN_CUSTOMER_QUOTE', hash: journeyMeta.uwStep || '' },
        { label: 'Send questionnaire to customer', actionId: 'BO.SEND_QUESTIONNAIRE' },
      ],
      details: { status, missingForIssuedPackCount: missingForIssuedPack.length },
    });
  }

  // Pricing hash integrity: presence + recompute parity. Absence means the
  // quote was not finalised through the canonical rater path; mismatch means
  // the persisted snapshot drifted from the rated inputs (snapshotHash) or
  // from the operator overrides / binder version (pricingHash).
  const storedPricing = asRecord(ctxSnapshotObj?.pricing);
  const storedSnapshotHash = String(storedPricing.snapshotHash || '').trim();
  const storedPricingHash = String(storedPricing.pricingHash || '').trim();
  const storedOverrideExcess = (() => {
    const v = storedPricing.overrideExcess;
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' || typeof v === 'string') return v;
    return null;
  })();
  const storedBinderVersion = (() => {
    const v = storedPricing.binderVersion;
    return typeof v === 'string' && v.trim() ? v : 'default';
  })();
  const pricingHashPresent = Boolean(storedSnapshotHash) && Boolean(storedPricingHash);
  let pricingHashRecomputed: { snapshotHash: string; pricingHash: string } | null = null;
  if (pricingHashPresent && hasQuoteResponse) {
    pricingHashRecomputed = computePricingIntegrityStamp({
      quoteData: effectiveQuoteData,
      quoteResponse: effectiveQuoteResponse,
      overrideExcess: storedOverrideExcess,
      binderVersion: storedBinderVersion,
    });
  }
  const pricingHashMatches =
    pricingHashPresent &&
    Boolean(pricingHashRecomputed) &&
    pricingHashRecomputed!.snapshotHash === storedSnapshotHash &&
    pricingHashRecomputed!.pricingHash === storedPricingHash;
  if (hasQuoteResponse && !pricingHashPresent) {
    blockers.push({
      code: 'PRICING_HASH_MISMATCH',
      message: 'Pricing integrity check is missing. Please re-rate to finalize pricing.',
      group: 'PRICING',
      severity: 'BLOCK',
      actions: [{ label: 'Recalculate premium', actionId: 'BO.RECALC_PREMIUM' }],
    });
  } else if (hasQuoteResponse && pricingHashPresent && !pricingHashMatches) {
    blockers.push({
      code: 'PRICING_DRIFT',
      message: 'The quote was edited after the last premium calculation. Recalculate premium so the displayed price matches the current risk details.',
      group: 'PRICING',
      severity: 'BLOCK',
      actions: [{ label: 'Recalculate premium', actionId: 'BO.RECALC_PREMIUM' }],
      details: {
        storedSnapshotHash,
        storedPricingHash,
        recomputedSnapshotHash: pricingHashRecomputed?.snapshotHash,
        recomputedPricingHash: pricingHashRecomputed?.pricingHash,
      },
    });
  }

  if (!skipStrictIssuedDataChecksForEndorsement && missingForIssuedPack.length > 0) {
    blockers.push({
      code: 'DOCUMENT_FIELDS_MISSING',
      message: 'Some required details are missing for the issued document pack.',
      group: 'DOCUMENTS',
      severity: 'BLOCK',
      actions: (() => {
        const first = missingForIssuedPack[0];
        if (!first?.customerHash) return [{ label: 'Open customer quote', actionId: 'BO.OPEN_CUSTOMER_QUOTE', hash: journeyMeta.detailsStep || '' }];
        return [{ label: `Open ${first.customerHash.replace(/-/g, ' ')}`, actionId: 'BO.OPEN_CUSTOMER_QUOTE', hash: first.customerHash }];
      })(),
      details: {
        missingSlugs: missingForIssuedPack.map((field) => field.slug),
        missingForIssuedPack,
        missingForQuotePack,
        manualUwApprovalApprovedAt: String(manualUwApproval.approvedAt || '').trim() || undefined,
      },
    });
  }
  if (!skipStrictIssuedDataChecksForEndorsement && quoteValidationIssues.length > 0) {
    blockers.push(
      buildQuoteDataInvalidBlocker({
        productType,
        schemaIssues: quoteValidationIssues,
        detailsStepHash: journeyMeta.detailsStep || '',
      }),
    );
  }
  if (conditionalRequirements.length > 0) {
    blockers.push({
      code: 'CONDITIONAL_REQUIREMENTS_UNMET',
      message: formatConditionalRequirementsMessage(conditionalRequirements),
      group: 'UNDERWRITING',
      severity: 'BLOCK',
      details: { conditionalRequirements },
    });
  }

  // Payment gate (customer channel only)
  if (channel === 'customer' && !hasPaymentConfirmed) {
    blockers.push({
      code: 'PAYMENT_REQUIRED_NOT_RECEIVED',
      message: 'Payment is required before we can issue your policy.',
      group: 'PAYMENT',
      severity: 'BLOCK',
      actions: [{ label: 'Go to payment', actionId: 'CUSTOMER.GO_TO_STEP', href: `/quote/${policyId}#payment`, hash: 'payment' }],
    });
  }
  if (channel === 'customer' && hasPaymentConfirmed && !hasIssuedPackDocuments) {
    if (docsGenerationFailed) {
      // ADR-0017 — terminal failed surface. We do NOT stack the
      // `DOCUMENTS_PENDING_GENERATION` WARN on top: the failure is
      // newer than any successful doc, so showing both would be
      // misleading. The wizard reads `customerOutcome === 'failed'`
      // (set below) AND this BLOCK-severity blocker to render an
      // operator-contact recovery surface.
      blockers.push({
        code: 'DOCUMENTS_GENERATION_FAILED',
        message:
          'We could not generate your policy documents automatically. Our team has been alerted and will reach out shortly.',
        group: 'DOCUMENTS',
        severity: 'BLOCK',
        details: {
          missingIssuedDocumentTypes,
          failureEventType: latestIssuedPackFailure?.eventType,
          failureReason: issuedPackFailureReason || undefined,
          failureAt: issuedPackFailureAt || undefined,
          ...(paidAtIso ? { paidAt: paidAtIso, pendingMinutesSincePaid } : {}),
        },
      });
    } else {
      blockers.push({
        code: 'DOCUMENTS_PENDING_GENERATION',
        message: 'Your policy documents are still being generated.',
        group: 'DOCUMENTS',
        severity: 'WARN',
        details: { missingIssuedDocumentTypes },
      });
    }
  }
  if (channel === 'customer' && hasPaymentConfirmed && hasIssuedPackDocuments && !hasWelcomeEmailSent) {
    blockers.push({
      code: welcomeFailureReason ? 'WELCOME_EMAIL_FAILED' : 'WELCOME_EMAIL_PENDING',
      message: welcomeFailureReason
        ? 'Your welcome email failed to send automatically. Our team has been alerted and will retry shortly.'
        : 'Your welcome email is still being sent.',
      group: 'OTHER',
      severity: 'WARN',
      details: {
        ...(welcomeFailureReason ? { failureReason: welcomeFailureReason, failureAt: welcomeFailureAt } : {}),
        ...(paidAtIso ? { paidAt: paidAtIso, pendingMinutesSincePaid } : {}),
      },
    });
  }

  // Derived permissions
  const canGenerateQuotePack = hasQuoteData && hasQuoteResponse && status !== 'DECLINED' && missingForQuotePack.length === 0;
  const canGenerateIssuedDocs = hasBoundInceptionTransaction;

  // canIssue: for BO we require no BLOCK-severity blockers (WARN are informational)
  const hardBlockers = blockers.filter(
    (b) => b.code !== 'POLICY_LOCKED_BY_TRANSACTION' && (b.severity ?? 'BLOCK') === 'BLOCK'
  );
  const canIssue =
    !alreadyIssued &&
    hardBlockers.length === 0 &&
    (channel === 'bo' || hasPaymentConfirmed);

  // ADR-0017 — three-state customer outcome:
  //   issued  → docs present and inception bound → wizard advances.
  //   failed  → worker recorded a permanent failure newer than any
  //             generated doc → wizard stops polling and shows the
  //             operator-contact recovery surface.
  //   pending → still in flight (pre-payment, mid-generation, or a
  //             worker retry that may yet succeed).
  const customerOutcome: IssueReadinessResult['customerOutcome'] =
    channel === 'customer'
      ? (hasPaymentConfirmed && hasBoundInceptionTransaction && hasIssuedPackDocuments
          ? 'issued'
          : (docsGenerationFailed ? 'failed' : 'pending'))
      : undefined;

  const result: IssueReadinessResult = {
    channel,
    policyId,
    status,
    canIssue,
    canGenerateQuotePack,
    canGenerateIssuedDocs,
    customerOutcome,
    missingFields: missingForIssuedPack,
    conditionalRequirements,
    blockers,
    ...(process.env.NODE_ENV === 'production' ? {} : { diagnostics: { validation: validationDiagnostics } }),
    uwState,
    uwStateMeta: {
      questionnaireSentAt,
      customerStartedAt,
      uwStartedAt,
      followUpsSentAt,
      hasOpenFollowUps,
      openFollowUpsCount,
      lastSavedBy,
      lastSavedByName,
      lastSavedAt,
      isQuoteReady,
      lastModifiedBy,
    },
    blockerGroups: Object.entries(
      blockers.reduce<Record<string, IssueBlocker[]>>((acc, b) => {
        const g = (b.group || 'OTHER') as IssueBlockerGroup;
        acc[g] = acc[g] || [];
        acc[g].push(b);
        return acc;
      }, {})
    ).map(([group, bs]) => ({ group: group as IssueBlockerGroup, blockers: bs as IssueBlocker[] })),
    derived: {
      hasQuoteData,
      hasQuoteResponse,
      hasPaymentConfirmed,
      hasBoundInceptionTransaction,
      hasIssuedPackDocuments,
      hasWelcomeEmailSent,
      isLocked,
      hasUwCompleted: uwCompleted,
      pricingHashMatches,
      missingForQuotePack,
      missingForIssuedPack,
      missingIssuedDocumentTypes,
    },
  };
  return issueReadinessResultSchema.parse(result) as IssueReadinessResult;
}

/**
 * service.ts — Public Auto Quote orchestration.
 *
 * This file retains only the two densest orchestration flows:
 *   - updatePublicAutoDraft() — draft-save hot path (validation → projection → persistence)
 *   - rateQuote() — canonical cross-surface rating entrypoint (wizard +
 *                   BO recalculation): UW, pricing, hashes, tokens, persistence.
 *                   (Renamed from `rateQuoteWorkspace` per ADR-0007 Wave 4.)
 *
 * Pure validation/filtering lives in ./quoteDataGuards.ts
 * Session lifecycle CRUD lives in ./quoteSessionOps.ts
 *
 * NOTE: This is an interim orchestration shell (~590 LOC). Future decomposition
 *       candidates: draft-update projection, rating pipeline helpers.
 */
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { Prisma } from '@prisma/client';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { resolveLifecycleStatus } from '../../../modules/policy/app/status.js';
import { computePricingIntegrityStamp } from '../../../modules/policy/domain/pricingIntegrityStamp.js';
import { sha256Hex, stableStringify } from '../../../modules/policy/domain/hashes.js';
import { jsonStringify } from '../../../modules/policy/app/shared.js';
import {
  normalizeCoverageSelectionSnapshot,
  parseCoverageSelectionSnapshot,
  resolveEffectiveCoverageContract,
} from '../../../modules/policy/app/coverageSelectionContract.js';
import type { QuoteData, QuoteResponse } from '../../../platform/types/autoInsurance.js';
import type { MotorUwConfig } from '../underwriting/motorUwAutomation.js';
import { normalizeMotorcycleNamedRidersOnly } from './quoteDataGuards.js';
import { signQuoteToken } from '../../../modules/pricing/app/quoteToken.js';
import { computeCalculatedPolicyExcess } from '../pricing/canonicalRules.js';
import { enqueuePolicyListIndexUpdate } from '../../../modules/policy/infra/projections/policyListIndex.js';
import { logger } from '../../../platform/utils/logger.js';
import { patchDiff } from '../../../platform/utils/patchDiff.js';
import { recordPriceAudit } from '../../../modules/policy/app/pricing/priceAuditRecorder.js';
import type { CalculationStep } from '../../../platform/types/pricing.js';
import {
  buildBoOverrideOverlayTrigger,
  buildUnderwritingAnalysis,
  buildValueMismatchOverlayTrigger,
} from '../../../modules/underwriting/domain/underwritingAnalysis.js';
import {
  customerContactFromQuoteData,
  hasCompleteCustomerContact,
  materializeCustomerAccountForPolicy,
  type CustomerAccountResolution,
} from '../../../modules/policy/app/customerAccountMaterialization.js';
import { rebuildAccountProjectionsNow } from '../../../modules/accounts360/app/accountProjectionRefresh.js';

// ── Re-exports from extracted modules (barrel contract stability) ─

export {
  filterQuoteDataPatchByStep,
  preserveIssueDetailsNonClobberFields,
  asRecord,
  asBool,
  hasNonEmptyValue,
  sanitizeAdditionalDrivers,
  assertStartDateWithinWindow,
  quoteDataToRecord,
  ISSUE_DETAILS_NON_CLOBBER_PATHS,
} from './quoteDataGuards.js';

export {
  createPublicAutoSession,
  getPublicIssueReadiness,
  queuePublicQuotePackGeneration,
  getOrQueuePublicIssuedPackLinks,
  unlockPublicAutoPolicy,
  forkPublicAutoPolicy,
} from './quoteSessionOps.js';

// ── Local imports from extracted modules ──────────────────────────

import {
  asRecord,
  asBool,
  hasNonEmptyValue,
  filterQuoteDataPatchByStep,
  preserveIssueDetailsNonClobberFields,
  sanitizeAdditionalDrivers,
  assertStartDateWithinWindow,
  quoteDataToRecord,
  ISSUE_DETAILS_NON_CLOBBER_PATHS,
  getAtPath,
} from './quoteDataGuards.js';
import type { UnknownRecord } from './quoteDataGuards.js';

type MappersModule = typeof import('../../../modules/quotes/app/mappers.js');
type ValidatorModule = typeof import('../../../modules/quotes/app/validator.js');
type ErrorsModule = typeof import('./errors.js');
const mappersModule: MappersModule = await import('../../../modules/quotes/app/mappers.js');
const validatorModule: ValidatorModule = await import('../../../modules/quotes/app/validator.js');
const errorsModule: ErrorsModule = await import('./errors.js');
const { buildDriverInfoFromQuoteData, buildVehicleInfoFromQuoteData } = mappersModule;
const { validateDraftQuote } = validatorModule;
const { PublicApiError } = errorsModule;

export type PublicAutoOrigin = 'customer' | 'bo';
const IMMUTABLE_PUBLIC_WIZARD_STATUSES = new Set([
  'BOUND',
  'BOUND_DRAFT_ISSUED',
  'ISSUED',
  'ACTIVE',
  'CANCELLED',
  'EXPIRED',
]);

function sanitizeVehicleIdentityForRating(source: Record<string, unknown>): Record<string, unknown> {
  const next = { ...source };
  const registrationNumber = String(next.registrationNumber || '').trim();
  const vin = String(next.vin || '').trim().toUpperCase();
  const vinPattern = /^[A-HJ-NPR-Z0-9]{11,17}$/;
  if (registrationNumber && registrationNumber.length < 3) next.registrationNumber = '';
  if (vin && !vinPattern.test(vin)) next.vin = '';
  return next;
}

// ── updatePublicAutoDraft ─────────────────────────────────────────

export async function updatePublicAutoDraft(args: {
  policyId: string;
  quoteData: Partial<QuoteData> & UnknownRecord;
  step?: string;
  origin?: PublicAutoOrigin;
  materializeAccount?: boolean;
  customerAccountResolution?: CustomerAccountResolution;
  correlationId?: string;
}) {
  // Hot-path (autosave): keep the initial read as light as possible.
  const policy = await tenantScopedPrisma.policy.findUnique({
    where: { id: args.policyId },
    select: {
      id: true,
      policyNumber: true,
      productType: true,
      status: true,
      isLocked: true,
      policyHolderId: true,
      inceptionDate: true,
      expiryDate: true,
    },
  });

  if (!policy) {
    throw new PublicApiError({ httpStatus: 404, code: 'NOT_FOUND', message: 'Session not found' });
  }
  const policyStatusUpper = String(policy.status || '').toUpperCase();
  if (IMMUTABLE_PUBLIC_WIZARD_STATUSES.has(policyStatusUpper)) {
    throw new PublicApiError({
      httpStatus: 409,
      code: 'POLICY_NOT_EDITABLE',
      message: 'This policy is already issued/active and cannot be edited in the public quote wizard.',
    });
  }
  if (policy.isLocked) {
    throw new PublicApiError({
      httpStatus: 423,
      code: 'POLICY_LOCKED',
      message:
        'This quote is locked while payment is in progress. Please complete or cancel payment to continue editing.',
    });
  }

  const existingState = await tenantScopedPrisma.policyStateCurrent.findUnique({
    where: { policyId: policy.id },
    select: { snapshot: true },
  });
  const prevSnapshot = asRecord(existingState?.snapshot);
  const stepKey = String(args.step || prevSnapshot.step || '').trim();
  const rawIncomingQuoteData = asRecord(args.quoteData);
  const incomingQuoteData = filterQuoteDataPatchByStep(rawIncomingQuoteData, stepKey);
  const filteredOutKeys = Object.keys(rawIncomingQuoteData).filter((key) => !(key in incomingQuoteData));
  if (filteredOutKeys.length > 0) {
    logger.info(
      {
        policyId: policy.id,
        step: stepKey || null,
        correlationId: args.correlationId || null,
        filteredOutKeys,
      },
      'public_auto_quote.patch_fields_filtered'
    );
  }
  const prevQuoteData = asRecord(prevSnapshot.quoteData);
  // Guard against issue-details payloads carrying default empty strings for fields
  // that were already captured in policy-holder step. Keep existing non-empty identity
  // values unless the user explicitly sends a non-empty replacement.
  if (stepKey === 'issue-details') {
    const preserved = preserveIssueDetailsNonClobberFields(incomingQuoteData, prevQuoteData);
    Object.keys(incomingQuoteData).forEach((key) => delete incomingQuoteData[key]);
    Object.assign(incomingQuoteData, preserved);
  }
  // Root-cause fix for data leakage:
  // PATCH payloads can be partial and cross-step autosave can include stale/blank values.
  // Keep updates step-scoped and merge onto last snapshot to avoid clobbering unrelated data.
  const mergedQuoteData: Partial<QuoteData> & UnknownRecord = { ...prevQuoteData, ...incomingQuoteData };
  const quoteData = normalizeMotorcycleNamedRidersOnly(mergedQuoteData);
  const droppedCriticalFields = ISSUE_DETAILS_NON_CLOBBER_PATHS.filter(
    (path) =>
      hasNonEmptyValue(getAtPath(prevQuoteData as UnknownRecord, path)) &&
      !hasNonEmptyValue(getAtPath(quoteData as UnknownRecord, path))
  );
  if (droppedCriticalFields.length > 0) {
    logger.warn(
      {
        policyId: policy.id,
        step: stepKey || null,
        correlationId: args.correlationId || null,
        droppedCriticalFields,
      },
      'public_auto_quote.critical_fields_dropped'
    );
  }
  assertStartDateWithinWindow(quoteData.renewalDate, 'Renewal date');
  if (asBool(quoteData.hasAdditionalDrivers)) {
    quoteData.additionalDrivers = sanitizeAdditionalDrivers(quoteData.additionalDrivers);
  } else {
    quoteData.additionalDrivers = [];
  }

  const vehicleInfo = buildVehicleInfoFromQuoteData(quoteData);
  const driverInfo = buildDriverInfoFromQuoteData(quoteData);

  // "Account generation" gate:
  // We keep a placeholder PolicyHolder until the customer completes Step 1 and proceeds to Step 2 (vehicle-cover),
  // or until we have explicitly materialized the account once.
  const quoteDataRecord = asRecord(quoteData);
  const meta = asRecord(quoteDataRecord.__meta);
  const alreadyMaterialized = Boolean(String(meta.accountMaterializedAt || '').trim());
  const hasIdentity = hasCompleteCustomerContact(quoteData);
  const shouldMaterializeAccount = alreadyMaterialized || Boolean(args.materializeAccount) || (stepKey !== 'policy-holder' && hasIdentity);

  const customerContact = customerContactFromQuoteData(quoteData);
  let policyHolderName = shouldMaterializeAccount ? customerContact.name : 'New Submission';
  let policyHolderAddress = shouldMaterializeAccount ? customerContact.addressText : '';
  let contact: Record<string, unknown> = shouldMaterializeAccount ? customerContact.contact : {};

  if (shouldMaterializeAccount && !alreadyMaterialized) {
    const nowIso = new Date().toISOString();
    quoteDataRecord.__meta = { ...(meta || {}), accountMaterializedAt: nowIso };
  }

  const hasContact = Boolean(customerContact.email || customerContact.phone);
  const currentLifecycleStatus = String(policy.status || '').toUpperCase();
  const protectedStatuses = ['QUOTED', 'REFERRAL', 'DECLINED', 'BOUND', 'ISSUED', 'ACTIVE', 'CANCELLED'];

  // Only calculate "draft" lifecycle movements if we are not in a protected status
  const nextLifecycleStatus = protectedStatuses.includes(currentLifecycleStatus)
    ? currentLifecycleStatus
    : currentLifecycleStatus === 'INFO_REQUIRED'
      ? hasContact
        ? 'REFERRAL'
        : 'DRAFT'
      : hasContact
        ? 'INTAKE'
        : 'DRAFT';

  const activityOrigin: PublicAutoOrigin = args.origin === 'bo' ? 'bo' : 'customer';
  const updated = await tenantScopedPrisma.$transaction(async (tx) => {
    const stateInTxn = await tx.policyStateCurrent.findUnique({ where: { policyId: policy.id } });
    const prevSnapshotInTxn = asRecord(stateInTxn?.snapshot);
    const prevQuoteDataInTxn = asRecord(prevSnapshotInTxn.quoteData);
    const prevCustomerFlow = asRecord(prevSnapshotInTxn.customerFlow);
    const nowIso = new Date().toISOString();
    const nextCustomerFlow: UnknownRecord = {
      ...prevCustomerFlow,
      lastSavedBy: activityOrigin === 'bo' ? 'underwriter' : 'customer',
      lastSavedAt: nowIso,
      ...(activityOrigin === 'customer'
        ? { customerStartedAt: String(prevCustomerFlow.customerStartedAt || '').trim() || nowIso }
        : {}),
    };
    const quoteDataChanged =
      sha256Hex(stableStringify(prevQuoteDataInTxn)) !== sha256Hex(stableStringify(quoteData));

    if (quoteDataChanged) {
      logger.info({
        event: 'quote.patch.applied',
        policyId: policy.id,
        product: 'MOTOR',
        step: stepKey || null,
        diff: patchDiff(prevQuoteDataInTxn as Record<string, unknown>, quoteData as Record<string, unknown>),
      }, 'quote.patch.applied');
    }

    const materialized = shouldMaterializeAccount
      ? await materializeCustomerAccountForPolicy({
        tx,
        policyId: policy.id,
        currentPolicyHolderId: policy.policyHolderId,
        quoteData,
        segment: 'Auto Insurance',
        conflictMode: activityOrigin === 'bo' ? 'requireResolution' : 'autoAttach',
        resolution: args.customerAccountResolution || null,
      })
      : {
        status: 'materialized' as const,
        attachedExisting: false,
        policyHolder: await tx.policyHolder.update({
          where: { id: policy.policyHolderId },
          data: {
            name: policyHolderName,
            segment: 'Auto Insurance',
            address: policyHolderAddress || null,
            contact: JSON.stringify(contact || {}),
          },
        }),
      };
    if (materialized.status === 'conflict') {
      throw new PublicApiError({
        httpStatus: 409,
        code: 'CUSTOMER_ACCOUNT_CONFLICT',
        message: 'A customer account already exists with this email or NIF.',
        details: { matches: materialized.matches },
      });
    }
    const updatedHolder = materialized.policyHolder;
    policyHolderName = updatedHolder.name;
    policyHolderAddress = updatedHolder.address || '';
    try {
      contact = asRecord(JSON.parse(updatedHolder.contact || '{}'));
    } catch {
      contact = {};
    }

    const updatedPolicy = await tx.policy.update({
      where: { id: policy.id },
      data: {
        status: nextLifecycleStatus,
        quoteData: jsonStringify(quoteData),
        vehicleInfo,
        driverInfo: jsonStringify(driverInfo),
        ...(quoteDataChanged ? { quoteResponse: jsonStringify({}) } : {}),
      },
    });

    const nextSnapshot: UnknownRecord = {
      ...prevSnapshotInTxn,
      quoteData,
      vehicleInfo,
      driverInfo,
      step: args.step || null,
      customerFlow: nextCustomerFlow,
      flow_context: {
        channel: activityOrigin === 'bo' ? 'bo' : 'customer_wizard',
        step: String(args.step || 'policy-holder').replace(/-/g, '_')
      },
      // If we were in INFO_REQUIRED, clear the pending request marker once the customer submits any update.
      infoRequest:
        currentLifecycleStatus === 'INFO_REQUIRED'
          ? {
            ...(prevSnapshotInTxn?.infoRequest || {}),
            resolvedAt: nowIso,
            resolvedBy: activityOrigin === 'bo' ? 'underwriter' : 'customer'
          }
          : prevSnapshotInTxn?.infoRequest,
    };
    if (quoteDataChanged) {
      delete nextSnapshot.quoteResponse;
      delete nextSnapshot.uwDecision;
      delete nextSnapshot.pricing;
      delete nextSnapshot.lane;
    }

    const stateCreateData: Prisma.PolicyStateCurrentUncheckedCreateInput = {
      operatingTenantId: getTenantConfig().id,
      policyId: policy.id,
      snapshot: jsonStringify(nextSnapshot),
    };
    await tx.policyStateCurrent.upsert({
      where: { policyId: policy.id },
      update: { snapshot: jsonStringify(nextSnapshot) },
      create: stateCreateData,
    });

    const searchCreateData: Prisma.PolicySearchIndexUncheckedCreateInput = {
      operatingTenantId: getTenantConfig().id,
      policyId: policy.id,
      policyNumber: updatedPolicy.policyNumber,
      insuredName: policyHolderName,
      status: updatedPolicy.status,
      address: policyHolderAddress,
      segment: 'Auto Insurance',
    };
    await tx.policySearchIndex.upsert({
      where: { policyId: policy.id },
      update: { insuredName: policyHolderName, address: policyHolderAddress, status: updatedPolicy.status, segment: 'Auto Insurance' },
      create: searchCreateData,
    });
    await enqueuePolicyListIndexUpdate(tx, policy.id);

    return { updatedPolicy, updatedHolder };
  });
  if (shouldMaterializeAccount) {
    await rebuildAccountProjectionsNow(updated.updatedHolder.id);
  }

  void AuditLogger.log(
    policy.id,
    'POLICY',
    'AUTO_QUOTE.DRAFT_UPDATED',
    activityOrigin === 'bo' ? 'underwriter' : 'customer',
    'USER',
    { step: args.step || null },
    activityOrigin === 'bo' ? 'Underwriter' : 'Customer'
  );

  return {
    policyId: args.policyId,
    status: resolveLifecycleStatus(updated.updatedPolicy.status, { inceptionDate: policy.inceptionDate, expiryDate: policy.expiryDate }),
  };
}

// ── rateQuote ────────────────────────────────────────────

export async function rateQuote(args: {
  policyId: string;
  quoteData: Partial<QuoteData> & UnknownRecord;
  overrideExcess?: string | number;
  previewOnly?: boolean;
  coverageSelection?: Record<string, unknown>;
  correlationId?: string;
}) {
  // Rating uses a minimal policy read first so immutable issued-like records
  // are rejected before any draft validation/repricing work runs.
  const policy = await tenantScopedPrisma.policy.findUnique({
    where: { id: args.policyId },
    select: {
      id: true,
      policyNumber: true,
      productType: true,
      status: true,
      isLocked: true,
      programId: true,
    },
  });

  if (!policy) throw new PublicApiError({ httpStatus: 404, code: 'NOT_FOUND', message: 'Session not found' });
  const policyStatusUpper = String(policy.status || '').toUpperCase();
  if (IMMUTABLE_PUBLIC_WIZARD_STATUSES.has(policyStatusUpper)) {
    throw new PublicApiError({
      httpStatus: 409,
      code: 'POLICY_NOT_EDITABLE',
      message: 'This policy is already issued/active and cannot be repriced in the public quote wizard.',
    });
  }
  if (policy.isLocked) {
    throw new PublicApiError({
      httpStatus: 423,
      code: 'POLICY_LOCKED',
      message: 'This quote is locked while payment is in progress. Please complete or cancel payment to continue.',
    });
  }
  const requestRecord = args as Record<string, unknown>;
  if (requestRecord.selectedOptions || requestRecord.paramsByCode) {
    throw new PublicApiError({
      httpStatus: 400,
      code: 'LEGACY_COVERAGE_SHAPE',
      message: 'Use coverageSelection for rating coverage choices.',
    });
  }

  const normalizedRecord = normalizeMotorcycleNamedRidersOnly(
    sanitizeVehicleIdentityForRating(asRecord(args.quoteData))
  );
  const ratingValidation = validateDraftQuote({
    quoteData: normalizedRecord,
    step: 'rate-quote-workspace',
    mode: 'quote',
    productType: String(policy.productType || '').trim() || 'MOTOR',
  });
  if (!ratingValidation.valid) {
    throw new PublicApiError({
      httpStatus: 400,
      code: 'INVALID_QUOTE_DATA',
      message: 'Quote data failed validation for rating',
      details: {
        correlationId: args.correlationId || null,
        missingSlugs: ratingValidation.missingSlugs,
        blockingErrors: ratingValidation.blockingErrors,
      },
    });
  }
  const normalizedQuoteData = ratingValidation.normalizedQuoteData;
  assertStartDateWithinWindow(normalizedQuoteData.renewalDate, 'Renewal date');
  const quoteDataForCalc = normalizedQuoteData;
  if (!String(normalizedQuoteData.requiredExcess || '').trim()) {
    const computed = computeCalculatedPolicyExcess(quoteDataForCalc);
    normalizedQuoteData.requiredExcess = computed > 0 ? `€${computed}` : '€0';
  }

  // Sanctions screening does NOT run at motor quote time (ADR-0067). The
  // mandatory AML/sanctions control lives exclusively at bind / payment /
  // issue, where a real identity exists and cover/money is about to change
  // hands (those gates remain fail-closed). Screening at quote previously
  // ran on placeholder identities before real details were saved and, on a
  // provider outage, failed closed and stopped all quoting (Aug 2026). See
  // ADR-0043 (spine) and ADR-0067 (this relocation).
  const { evaluateMotorUwAutomation } = await import('../underwriting/motorUwAutomation.js');

  // Program-driven configuration is now explicit by context only:
  // policy.programId or quoteData.__meta.programId.
  // We do not auto-pick latest ACTIVE program because that causes cross-tenant/product ambiguity.
  let uwConfig: Partial<MotorUwConfig> | undefined = undefined;
  let mbeConfig: unknown = undefined;
  const quoteMeta = asRecord(asRecord(normalizedQuoteData).__meta);
  const quoteProgramId = String(quoteMeta.programId || '').trim();
  let policyProgramId: string | null = policy.programId || quoteProgramId || null;
  try {
    const resolvedProgram = policyProgramId
      ? await tenantScopedPrisma.program.findUnique({ where: { id: policyProgramId } })
      : null;
    if (!resolvedProgram && policyProgramId) {
      logger.warn(
        {
          policyId: policy.id,
          correlationId: args.correlationId || null,
          policyProgramId,
        },
        'public_auto_quote.program_context_not_found'
      );
      policyProgramId = null;
    }
    if (resolvedProgram?.id) policyProgramId = String(resolvedProgram.id);
    const programMetadata = asRecord(resolvedProgram?.metadata);
    const uwConfigRaw = programMetadata.abbeygateMotorUwConfig;
    uwConfig = uwConfigRaw && typeof uwConfigRaw === 'object' ? (uwConfigRaw as Partial<MotorUwConfig>) : undefined;
    mbeConfig = programMetadata.mbeProductConfig;
  } catch {
    // best-effort: keep defaults
  }
  if (!policy.programId && policyProgramId && !args.previewOnly) {
    await tenantScopedPrisma.policy.update({
      where: { id: policy.id },
      data: { programId: policyProgramId },
    }).catch(() => undefined);
  }
  if (!policyProgramId) {
    logger.warn(
      {
        policyId: policy.id,
        correlationId: args.correlationId || null,
      },
      'public_auto_quote.program_context_missing'
    );
  }

  const { normalizeProgramMbeProductConfig } = await import('../../../modules/mbe/domain/programProduct.js');
  const normalizedMbeCfg = normalizeProgramMbeProductConfig(mbeConfig);

  // Policy/customer selection is resolved through the canonical coverage contract.
  let existingSnapshot: UnknownRecord = {};
  let existingCoverageSelection: Record<string, unknown> | undefined = undefined;
  try {
    const existingState = await tenantScopedPrisma.policyStateCurrent.findUnique({ where: { policyId: policy.id } });
    const snap = asRecord(existingState?.snapshot);
    existingSnapshot = snap;
    existingCoverageSelection = asRecord(snap.coverageSelection);
  } catch {
    // best-effort
  }

  // Customer-driven selection override (e.g., recommendations) takes precedence when provided.
  // Persist it so subsequent rating/payment/issuance is deterministic.
  const incomingSelectionRaw =
    args.coverageSelection && typeof args.coverageSelection === 'object'
      ? args.coverageSelection
      : undefined;
  const hasIncomingSelection = Boolean(incomingSelectionRaw);
  const normalizedIncomingSelection = hasIncomingSelection
    ? normalizeCoverageSelectionSnapshot({
      value: incomingSelectionRaw,
      programId: policyProgramId || null,
      programCode: normalizedMbeCfg.programCode,
      allowedCodes: [...(normalizedMbeCfg.base || []).map((item) => String(item.code || '')), ...(normalizedMbeCfg.options || []).map((item) => String(item.code || ''))],
      source: String(asRecord(incomingSelectionRaw).source || 'CUSTOMER_RECS'),
      updatedAt: new Date().toISOString(),
    })
    : undefined;
  if (hasIncomingSelection) {
    if (!args.previewOnly) {
      try {
        const coverageSelectionSnapshot = {
          ...existingSnapshot,
          coverageSelection: normalizedIncomingSelection,
        };
        await tenantScopedPrisma.policyStateCurrent.upsert({
          where: { policyId: policy.id },
          update: {
            snapshot: jsonStringify(coverageSelectionSnapshot),
          },
          create: {
            policyId: policy.id,
            snapshot: jsonStringify(coverageSelectionSnapshot),
          } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
        });
      } catch {
        // best-effort
      }
    }
  }

  const effectiveCoverage = resolveEffectiveCoverageContract({
    productType: 'MOTOR',
    quoteData: quoteDataForCalc,
    cfg: normalizedMbeCfg,
    storedSelection: normalizedIncomingSelection || existingCoverageSelection,
    programId: policyProgramId,
    source: normalizedIncomingSelection?.source || parseCoverageSelectionSnapshot(existingCoverageSelection).source,
  });

  const uwDecision = evaluateMotorUwAutomation(quoteDataForCalc, uwConfig);
  // Canonical pricing road: every recalculate must funnel through
  // `IProductAdapter.buildQuoteResponse`. Reaching into the leaf
  // calculator (`calculateAutoInsuranceQuoteResponse`) from a route
  // handler / use case is forbidden by Lock G (architecture-locks).
  // The local `uwDecision` above is kept because subsequent service-
  // level logic (override-excess overlay, value-mismatch lane) still
  // needs the same idempotent decision; the adapter recomputes it
  // internally and produces the same result for the same `programMeta`.
  const { ProductRegistry } = await import('../../../modules/policy/domain/ProductRegistry.js');
  const motorAdapter = ProductRegistry.getInstance().getAdapter('MOTOR');
  if (!motorAdapter) {
    throw new PublicApiError({ httpStatus: 500, code: 'NO_MOTOR_ADAPTER', message: 'Motor adapter not registered' });
  }
  const adapterResult = await motorAdapter.buildQuoteResponse(
    quoteDataForCalc,
    { abbeygateMotorUwConfig: uwConfig },
    {
      resolvedCoverageSet: effectiveCoverage.resolvedCoverageSet,
      reference: policy.policyNumber,
      currency: 'EUR',
      overrideExcess: args.overrideExcess ?? null,
    },
  );
  // The adapter contract returns `quoteResponse: Record<string, unknown>` to
  // stay product-agnostic; the cast below narrows to Motor's QuoteResponse
  // shape used by the rest of `rateQuote` (uw status mapping, currency,
  // primaryOption fields, validUntil, warnings). Tightening the contract to a
  // per-product generic touches every adapter so it's deferred.
  const quoteResponse = adapterResult.quoteResponse as unknown as QuoteResponse; // TODO(FAC-9101): drop cast once QuoteResponseResult.quoteResponse becomes a per-product generic instead of Record<string, unknown>.

  const declaredValue = Number(args.quoteData.vehicleValue || 0);
  const marketValue = Number(args.quoteData.marketValue || 0);
  const valueMismatchYellowLane = Number.isFinite(marketValue) && marketValue > 0 && declaredValue > marketValue * 2;
  const computedMinExcess = computeCalculatedPolicyExcess(quoteDataForCalc);
  const overrideExcessNum = Number(args.overrideExcess);
  const boOverrideNeedsApproval =
    Number.isFinite(overrideExcessNum) &&
    overrideExcessNum > 0 &&
    overrideExcessNum < computedMinExcess &&
      String(asRecord(asRecord(args.quoteData).__meta).origin || 'customer') === 'bo';

  const normalizedQuoteResponse = {
    ...quoteResponse,
    status:
      uwDecision.outcome === 'decline'
        ? 'declined'
        : uwDecision.outcome === 'referral' || boOverrideNeedsApproval || valueMismatchYellowLane
          ? 'referral'
          : 'quoted',
    referralMessage:
      uwDecision.outcome === 'referral'
        ? `Referred for underwriting review: ${uwDecision.reasons.join(' ')}`
        : quoteResponse.referralMessage,
    warnings: [
      ...(quoteResponse.warnings || []),
      ...(uwDecision.outcome !== 'accept' ? [`Underwriting ${uwDecision.lane.toUpperCase()} lane: ${uwDecision.reasons.join(' ')}`] : []),
      ...(boOverrideNeedsApproval ? [`Manual approval required: BO override excess €${overrideExcessNum} is below computed minimum €${computedMinExcess}.`] : []),
      ...(valueMismatchYellowLane ? [`Yellow lane: declared value (€${declaredValue}) exceeds 2x market value (€${marketValue}).`] : []),
    ],
  };
  const underwritingOverlayTriggers = [
    ...(boOverrideNeedsApproval ? [buildBoOverrideOverlayTrigger({
      requestedOverrideExcess: overrideExcessNum,
      computedMinimumExcess: computedMinExcess,
    })] : []),
    ...(valueMismatchYellowLane ? [buildValueMismatchOverlayTrigger({
      declaredValue,
      marketValue,
    })] : []),
  ];
  const underwritingAnalysis = buildUnderwritingAnalysis({
    uwDecision,
    quoteResponse: normalizedQuoteResponse,
    overlayTriggers: underwritingOverlayTriggers,
  });

  const nextStatus = uwDecision.outcome === 'decline' ? 'DECLINED' : (uwDecision.outcome === 'referral' || boOverrideNeedsApproval || valueMismatchYellowLane) ? 'REFERRAL' : 'QUOTED';
  const totalPremium = uwDecision.outcome === 'decline' ? 0 : normalizedQuoteResponse?.primaryOption?.annualPremium || 0;

  // Signed quote token: bind/create endpoints must verify price integrity.
  // Hash is computed from quoteData + effective excess (override or quoteData.requiredExcess).
  const { token: quoteToken, payload: quoteTokenPayload } = signQuoteToken({
    productType: 'MOTOR',
    quoteData: quoteDataToRecord(quoteDataForCalc),
    overrideExcess: args.overrideExcess || null,
    premium: totalPremium,
    currency: String(normalizedQuoteResponse?.currency || 'EUR'),
  });

  // Pricing integrity stamp — see
  // backend/modules/policy/domain/pricingIntegrityStamp.ts
  // For customer flow the binder may be assigned at issuance, so the
  // helper's 'default' binder version applies.
  const persistedQuoteData = jsonStringify(normalizedQuoteData);
  const persistedQuoteResponse = jsonStringify(normalizedQuoteResponse);
  const pricingStamp = computePricingIntegrityStamp({
    quoteData: persistedQuoteData,
    quoteResponse: persistedQuoteResponse,
    overrideExcess: args.overrideExcess || null,
  });
  const persistedCoverageSelection =
    normalizedIncomingSelection
    || (existingCoverageSelection && Object.keys(existingCoverageSelection).length > 0 ? existingCoverageSelection : undefined);
  // Rating updates quote/pricing state, but `coverageSelection` is owned by the coverage contract
  // and must survive rerates unchanged unless a new contract payload was provided explicitly.
  const nextWorkspaceSnapshot = {
    ...existingSnapshot,
    ...(persistedCoverageSelection ? { coverageSelection: persistedCoverageSelection } : {}),
    quoteData: persistedQuoteData,
    quoteResponse: persistedQuoteResponse,
    uwDecision,
    underwritingAnalysis,
    uw: {
      schemaVersion: 1,
      // In customer-direct motor, "UW completed" means the quote journey was completed + validated at rating time.
      completedAt: new Date().toISOString(),
      validationResult: { isValid: true, errors: [] },
    },
    pricing: {
      ...pricingStamp,
      authorityDecision: { status: uwDecision.outcome === 'referral' ? 'REFERRED' : 'WITHIN_AUTHORITY' },
      quoteTokenPayload,
      boOverrideApproval: boOverrideNeedsApproval
        ? {
          required: true,
          computedMinimumExcess: computedMinExcess,
          requestedOverrideExcess: overrideExcessNum,
          reason: 'Override is below computed minimum.',
        }
        : { required: false },
      enrichedMismatch: valueMismatchYellowLane
        ? { declaredValue, marketValue, reason: 'declared_value_gt_2x_market_value' }
        : null,
    },
    step: 'your-quote',
    flow_context: { channel: 'customer_wizard', step: 'quote' },
    lane: uwDecision?.lane?.toUpperCase?.() || undefined,
  };

  if (!args.previewOnly) {
    await tenantScopedPrisma.policy.update({
      where: { id: policy.id },
      data: {
        quoteData: persistedQuoteData,
        quoteResponse: persistedQuoteResponse,
        status: nextStatus,
      },
    });

    const workspaceStateCreate: Prisma.PolicyStateCurrentUncheckedCreateInput = {
      operatingTenantId: getTenantConfig().id,
      policyId: policy.id,
      snapshot: jsonStringify(nextWorkspaceSnapshot),
    };
    await tenantScopedPrisma.policyStateCurrent.upsert({
      where: { policyId: policy.id },
      update: {
        snapshot: jsonStringify(nextWorkspaceSnapshot),
      },
      create: workspaceStateCreate,
    });

    const submissionSearchCreate: Prisma.PolicySearchIndexUncheckedCreateInput = {
      operatingTenantId: getTenantConfig().id,
      policyId: policy.id,
      policyNumber: policy.policyNumber,
      insuredName: 'New Submission',
      status: nextStatus,
      totalPremium,
    };
    await tenantScopedPrisma.policySearchIndex.upsert({
      where: { policyId: policy.id },
      update: { totalPremium, status: nextStatus },
      create: submissionSearchCreate,
    });
    await enqueuePolicyListIndexUpdate(prisma, policy.id);

    if (nextStatus === 'REFERRAL') {
      // Notify the jurisdiction UW team whenever the policy enters REFERRAL —
      // including the BO-override-below-minimum-excess and value-mismatch yellow
      // lanes, not only uwDecision referrals. Previously the email fired only on
      // uwDecision.outcome === 'referral', so these two lanes referred silently.
      // Canonical flat EMAIL.UW_REFERRAL producer (shared with ratePolicyAndPersist).
      const referralReasons = [
        ...(uwDecision.outcome === 'referral' ? uwDecision.reasons : []),
        ...(boOverrideNeedsApproval
          ? [`BO override excess €${overrideExcessNum} is below computed minimum €${computedMinExcess}.`]
          : []),
        ...(valueMismatchYellowLane
          ? [`Declared value (€${declaredValue}) exceeds 2x market value (€${marketValue}).`]
          : []),
      ];
      const { enqueueUwReferralEmail } = await import('../../../modules/quotes/app/enqueueUwReferralEmail.js');
      await enqueueUwReferralEmail({
        policyId: policy.id,
        policyNumber: policy.policyNumber,
        quoteReference: normalizedQuoteResponse?.reference ?? null,
        reasons: referralReasons,
      });
    }

    void AuditLogger.log(policy.id, 'POLICY', 'AUTO_QUOTE.RATED', 'customer', 'USER', { premium: totalPremium, uwDecision }, 'Customer');

    // Immutable price audit for BDX reconciliation + debugging.
    try {
      const primary = normalizedQuoteResponse?.primaryOption as unknown as Record<string, unknown> | undefined;
      const trace = (primary?.calculationTrace ?? {}) as Record<string, unknown>;
      const steps = Array.isArray(trace.steps) ? (trace.steps as unknown as CalculationStep[]) : [];
      const calculatorVersion = typeof trace.calculatorVersion === 'string' && trace.calculatorVersion
        ? trace.calculatorVersion
        : 'motor@1.0.0';
      const excess = Number((primary?.totalExcess as unknown) ?? 0) || 0;
      await recordPriceAudit({
        policyId: policy.id,
        quoteId: policy.policyNumber,
        productType: String(policy.productType || 'MOTOR').toUpperCase(),
        calculatorVersion,
        inputs: normalizedQuoteData as unknown as Record<string, unknown>,
        steps,
        totalPremium,
        policyExcess: excess,
        currency: 'EUR',
        eventKind: 'QUOTE',
        createdBy: 'customer',
      });
    } catch (err) {
      logger.warn({ err, event: 'price_audit.public_rate.skip' }, 'price audit skipped');
    }
  }

  return { ...normalizedQuoteResponse, quoteToken, underwritingAnalysis };
}


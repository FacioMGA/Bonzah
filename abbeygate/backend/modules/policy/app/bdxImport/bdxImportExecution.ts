import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import type { WithoutTenantScope } from '../../../../platform/db/tenantExtension.js';
import { ProductRegistry } from '../../domain/ProductRegistry.js';
import { executeBindCoverage } from '../BindCoverage.js';
import { executeIssuePolicy } from '../IssuePolicy.js';
import { executeBindPolicy } from '../BindPolicy.js';
import {
  executeBindEndorsementDraft,
  executeCreateEndorsementDraft,
  executeIssueEndorsement,
  executePatchEndorsementDraft,
  executeRateEndorsementDraft,
} from '../endorsementCommands.js';
import { enqueuePolicyListIndexUpdate } from '../policyListIndex.js';
import { computePricingIntegrityStamp } from '../../domain/pricingIntegrityStamp.js';
import { cleanupImportedPolicy } from './bdxImportCleanup.js';
import { alignQuoteResponseToDeclaredPremium } from './declaredPremiumAlignment.js';
import { synchronizeProjectionAfterImport } from './bdxImportProjectionSync.js';
import { materializeCustomerAccountForPolicy } from '../customerAccountMaterialization.js';
import { enqueueAccountProjectionRefreshByAccountId } from '../../../accounts360/app/accountProjectionRefresh.js';
import {
  endorsementEffectiveDate,
  endorsementReasonCode,
  findImportedPolicyByPolicyNumber,
  findImportedPolicyByRowKey,
  migrationManualUwApprovalSnapshot,
  replayTransactionType,
} from './bdxImportContext.js';
import { findImportedEndorsementByRowKey } from '../bdxImportRecovery.js';
import type {
  BdxEndorsementReplayCommand,
  BdxImportExecutionContext,
  BdxPolicyRowImportCommand,
  BdxRenewalTermImportCommand,
} from './bdxImportTypes.js';

// This module owns row execution only.
// It must not import Express/router types or any HTTP handlers.

function segmentForProduct(productType: string): string {
  if (productType === 'TRAVEL') return 'Travel Insurance';
  if (productType === 'HOME') return 'Home Insurance';
  return 'Auto Insurance';
}

// PR8: shared code does not branch on productType anymore. The adapter
// method `getLegacyPolicyColumnFields` (default `{}`, motor overrides) is
// the single mapper to the legacy top-level Policy columns. Per ADR-0015
// these columns themselves are scheduled for extraction into a generic
// `Policy.productData JSON?` column in the next release.
function getProductLegacyColumns(productType: string, productFields: Record<string, unknown>): Record<string, unknown> {
  const adapter = ProductRegistry.getInstance().getAdapter(productType);
  if (!adapter) return {};
  return adapter.getLegacyPolicyColumnFields(productFields);
}

async function issueImportedPolicy(args: {
  policyId: string;
  context: BdxImportExecutionContext;
}): Promise<{ ok: boolean; error?: string }> {
  const result = await executeIssuePolicy({
    policyId: args.policyId,
    actor: args.context.actor,
    correlationId: args.context.correlationId,
    // Historical BDX migration: suppress welcome email + doc-pack generation.
    // These are already-issued historical policies, so a welcome email is
    // wrong and per-policy doc-pack generation is the bulk-migration
    // throughput/DB bottleneck. Doc packs regenerate on demand if needed.
    suppressIssuedPack: true,
  });
  return result.status === 'SUCCESS'
    ? { ok: true }
    : { ok: false, error: JSON.stringify(result.error) };
}

async function executeBindPolicyDirect(args: {
  policyId: string;
  context: BdxImportExecutionContext;
}): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const result = await executeBindPolicy({
    policyId: args.policyId,
    actor: args.context.actor,
    correlationId: args.context.correlationId,
    debugBind: String(process.env.DEBUG_BIND || '').toLowerCase() === 'true',
  });
  return result.status === 'SUCCESS'
    ? { ok: true, data: result.data }
    : { ok: false, error: JSON.stringify(result.error) };
}


// Refuse silent default-PASS for migration compliance: the validator MUST emit
// an explicit verdict. A null/undefined value at this boundary indicates a
// corrupt evaluator output and we fail closed rather than import as PASS.
type MigrationComplianceVerdict = { state: string; reasonCodes: string[] };
function requireMigrationCompliance(input: unknown): MigrationComplianceVerdict {
  if (
    input
    && typeof input === 'object'
    && typeof (input as Record<string, unknown>).state === 'string'
    && Array.isArray((input as Record<string, unknown>).reasonCodes)
  ) {
    return input as MigrationComplianceVerdict;
  }
  throw new Error('[bdxImportExecution] migrationCompliance is missing on evaluator output — refusing silent default-PASS. The validator must emit an explicit verdict.');
}

export async function importPassingRow(args: BdxPolicyRowImportCommand): Promise<{
  policyId?: string;
  policyHolderId?: string;
  status?: 'imported' | 'already_imported';
  error?: string;
  projectionWarning?: string;
}> {
  const { evaluation, request, programId, binderId, accountId, runId, context } = args;
  const bindMode = args.bindMode || 'full';
  const rowKey = evaluation.dto.rowKey;
  const existingPolicyId = await findImportedPolicyByRowKey(rowKey);
  if (existingPolicyId) return { policyId: existingPolicyId, status: 'already_imported' };
  const policyNumber = String(evaluation.dto.policyRef || '').trim();
  const existingByPolicyNumber = await findImportedPolicyByPolicyNumber(policyNumber, evaluation.dto.termKey);
  if (existingByPolicyNumber) return { policyId: existingByPolicyNumber, status: 'already_imported' };
  if (!evaluation.normalizedQuoteData) return { error: 'Missing normalized quote data for passing row' };

  const quoteData = evaluation.normalizedQuoteData;
  const productType = String((evaluation.dto as Record<string, unknown>).productType || '');
  if (!productType) return { error: 'Missing productType on BDX row; cannot import without explicit product' };
  const segment = segmentForProduct(productType);
  const adapter = ProductRegistry.getInstance().getAdapter(productType);
  if (!adapter) return { error: `No product adapter for: ${productType}` };
  const { normalizeProgramMbeProductConfig, resolveCoverageV1 } = await import('../../../mbe/domain/programProduct.js');
  const normalizedMbeCfg = normalizeProgramMbeProductConfig({}, {
    productType,
    programCode: `abbeygate_${String(productType || '').trim().toLowerCase()}`,
  });
  const resolvedCoverageSet = resolveCoverageV1({
    productType,
    quoteData,
    cfg: normalizedMbeCfg,
  });
  const { quoteResponse, underwritingAnalysis } = await adapter.buildQuoteResponse(quoteData, {}, { resolvedCoverageSet });
  // ADR-0056: the bordereau's declared premium is authoritative for imported
  // policies. The calculator output stays as provenance; any gap is persisted
  // as an explicit loading/discount with a `bdxPremiumAlignment` audit block.
  const alignment = alignQuoteResponseToDeclaredPremium({ quoteResponse, evaluation, runId });
  const uwDecision = underwritingAnalysis || {};
  const productFields = adapter.normalizeUwData(quoteData).productFields || {};
  const inceptionDate = new Date(evaluation.dto.inceptionDate || new Date().toISOString());
  const expiryDate = new Date(evaluation.dto.expiryDate || new Date(Date.now() + 365 * 86400000).toISOString());
  const migrationUw = migrationManualUwApprovalSnapshot(uwDecision);
  // Compute pricing stamp AFTER JSON-roundtrip so it matches what
  // `evaluateIssueReadiness` recomputes from the persisted snapshot
  // (PolicyStateCurrent.snapshot.quoteData/quoteResponse are JSON-roundtripped).
  // Computing pre-roundtrip leads to PRICING_DRIFT blockers at bind time
  // for any quote that contained Date/non-plain values.
  const persistedQuoteData = JSON.parse(JSON.stringify(quoteData)) as Prisma.InputJsonValue;
  const persistedQuoteResponse = JSON.parse(JSON.stringify(alignment.quoteResponse)) as Prisma.InputJsonValue;
  const pricingStamp = computePricingIntegrityStamp({
    quoteData: persistedQuoteData,
    quoteResponse: persistedQuoteResponse,
  });

  const policy = await tenantScopedPrisma.$transaction(async (_tx) => {
    const tx = _tx as Prisma.TransactionClient;
    const policyHolderData: WithoutTenantScope<Prisma.PolicyHolderUncheckedCreateInput> = {
      name: `Imported ${evaluation.dto.policyRef}`,
      segment,
      address: '',
      contact: JSON.stringify({}),
    };
    const policyHolder = await tx.policyHolder.create({
      data: policyHolderData as Prisma.PolicyHolderUncheckedCreateInput,
    });
    const policyData: WithoutTenantScope<Prisma.PolicyUncheckedCreateInput> = {
      accountId: accountId || undefined,
      policyNumber,
      status: 'QUOTED',
      productType,
      policyHolderId: policyHolder.id,
      inceptionDate,
      expiryDate,
      programId,
      binderId,
      quoteData: persistedQuoteData,
      quoteResponse: persistedQuoteResponse,
      ...getProductLegacyColumns(productType, productFields),
    };
    const created = await tx.policy.create({
      data: policyData as Prisma.PolicyUncheckedCreateInput,
    });
    const materialized = await materializeCustomerAccountForPolicy({
      tx,
      policyId: created.id,
      currentPolicyHolderId: policyHolder.id,
      quoteData,
      segment,
      conflictMode: 'autoAttach',
    });
    if (materialized.status === 'conflict') {
      throw new Error('Unexpected customer account conflict during BDX auto-attach');
    }
    const stateCreate: WithoutTenantScope<Prisma.PolicyStateCurrentUncheckedCreateInput> = {
      policyId: created.id,
      // Use the same JSON-roundtripped values that the pricing stamp was
      // computed against — keeps PRICING_DRIFT from firing at bind time.
      snapshot: JSON.parse(JSON.stringify({
        quoteData: persistedQuoteData,
        quoteResponse: persistedQuoteResponse,
        uwDecision,
        pricing: pricingStamp,
        ...(migrationUw ? { uw: migrationUw } : {}),
        bdxImport: {
          runId,
          rowKey,
          termKey: evaluation.dto.termKey,
          sourceRowNumber: evaluation.dto.sourceRowNumber,
          sourcePolicyRef: evaluation.dto.policyRef,
          sourceSheetName: evaluation.dto.sourceSheetName,
          sourceMonth: evaluation.dto.sourceMonth,
          dryRun: request.dryRun,
          sourceHash: request.sourceHash,
          enrichmentProfile: evaluation.enrichment?.profile || 'BDX_CONTRACT_PROFILE_MOTOR',
          enrichmentVersion: evaluation.enrichment?.version || 'v2',
          filledFields: evaluation.enrichment?.filledFields || [],
          fieldSources: evaluation.enrichment?.fieldSources || {},
          migrationCompliance: requireMigrationCompliance(evaluation.migrationCompliance),
        },
      })),
    };
    await tx.policyStateCurrent.create({
      data: stateCreate as Prisma.PolicyStateCurrentUncheckedCreateInput,
    });
    const searchIndexCreate: WithoutTenantScope<Prisma.PolicySearchIndexUncheckedCreateInput> = {
      policyId: created.id,
      policyNumber: created.policyNumber,
      insuredName: materialized.policyHolder.name,
      status: created.status,
      segment,
      address: materialized.policyHolder.address || '',
    };
    await tx.policySearchIndex.upsert({
      where: { policyId: created.id },
      update: {
        policyNumber: created.policyNumber,
        insuredName: materialized.policyHolder.name,
        status: created.status,
        segment,
        address: materialized.policyHolder.address || '',
      },
      create: searchIndexCreate as Prisma.PolicySearchIndexUncheckedCreateInput,
    });
    await enqueuePolicyListIndexUpdate(tx, created.id);
    return { ...created, policyHolderId: materialized.policyHolder.id };
  });
  await enqueueAccountProjectionRefreshByAccountId(tenantScopedPrisma, policy.policyHolderId);

  if (bindMode === 'coverage') {
    const bindCoverageResult = await executeBindCoverage({
      policyId: policy.id,
      actor: context.actor,
      correlationId: context.correlationId,
    });
    if (bindCoverageResult.status !== 'SUCCESS') {
      await cleanupImportedPolicy({ policyId: policy.id, policyHolderId: policy.policyHolderId });
      return { error: JSON.stringify(bindCoverageResult.error) };
    }
    const projectionSync = await synchronizeProjectionAfterImport(policy.id);
    const issueResult = await issueImportedPolicy({ policyId: policy.id, context });
    if (!issueResult.ok) {
      await cleanupImportedPolicy({ policyId: policy.id, policyHolderId: policy.policyHolderId });
      return { error: issueResult.error || 'issue failed after coverage bind' };
    }
    await enqueueAccountProjectionRefreshByAccountId(tenantScopedPrisma, policy.policyHolderId);
    return {
      policyId: policy.id,
      policyHolderId: policy.policyHolderId,
      status: 'imported',
      projectionWarning: projectionSync.status === 'verified' ? undefined : projectionSync.warning,
    };
  }

  const bindResult = await executeBindPolicyDirect({ policyId: policy.id, context });
  if (!bindResult.ok) {
    await cleanupImportedPolicy({ policyId: policy.id, policyHolderId: policy.policyHolderId });
    return { error: bindResult.error || 'bind failed' };
  }
  const bindPayload = (bindResult.data && typeof bindResult.data === 'object')
    ? bindResult.data as Record<string, unknown>
    : {};
  const bindData = (bindPayload.data && typeof bindPayload.data === 'object')
    ? bindPayload.data as Record<string, unknown>
    : {};
  const statusFromBind = String(bindData.status || '');
  const docJobId = String(bindData.documentJobId || '').trim();
  if (!String(statusFromBind || '').toLowerCase().includes('issuing') || !docJobId) {
    await cleanupImportedPolicy({ policyId: policy.id, policyHolderId: policy.policyHolderId });
    return { error: 'bind did not reach issuing/doc-generation state' };
  }
  const projectionSync = await synchronizeProjectionAfterImport(policy.id);
  await enqueueAccountProjectionRefreshByAccountId(tenantScopedPrisma, policy.policyHolderId);
  return {
    policyId: policy.id,
    policyHolderId: policy.policyHolderId,
    status: 'imported',
    projectionWarning: projectionSync.status === 'verified' ? undefined : projectionSync.warning,
  };
}

export async function importRenewalTermRow(args: BdxRenewalTermImportCommand): Promise<{
  policyId?: string;
  status?: 'imported' | 'already_imported';
  error?: string;
  projectionWarning?: string;
}> {
  const { evaluation, request, priorPolicyId, binderId, runId, context } = args;
  const existingPolicyId = await findImportedPolicyByRowKey(evaluation.dto.rowKey);
  if (existingPolicyId) return { policyId: existingPolicyId, status: 'already_imported' };
  if (!evaluation.normalizedQuoteData) return { error: 'Missing normalized quote data for renewal row' };

  const priorPolicy = await tenantScopedPrisma.policy.findUnique({
    where: { id: priorPolicyId },
    select: {
      id: true,
      accountId: true,
      insuredEntityId: true,
      policyHolderId: true,
      policyNumber: true,
      programId: true,
      renewalFamilyId: true,
      renewalSequence: true,
      productType: true,
      policyHolder: {
        select: {
          name: true,
          address: true,
        },
      },
    },
  });
  if (!priorPolicy) return { error: `Prior term ${priorPolicyId} was not found for renewal import` };

  const quoteData = evaluation.normalizedQuoteData;
  const renewalProductType = String(priorPolicy.productType || (evaluation.dto as Record<string, unknown>).productType || '');
  if (!renewalProductType) return { error: 'Missing productType for renewal import; prior policy and BDX row both lack it' };
  const renewalSegment = segmentForProduct(renewalProductType);
  const renewalAdapter = ProductRegistry.getInstance().getAdapter(renewalProductType);
  if (!renewalAdapter) return { error: `No product adapter for: ${renewalProductType}` };
  const { normalizeProgramMbeProductConfig, resolveCoverageV1 } = await import('../../../mbe/domain/programProduct.js');
  const renewalMbeCfg = normalizeProgramMbeProductConfig({}, {
    productType: renewalProductType,
    programCode: `abbeygate_${String(renewalProductType || '').trim().toLowerCase()}`,
  });
  const renewalResolvedCoverageSet = resolveCoverageV1({
    productType: renewalProductType,
    quoteData,
    cfg: renewalMbeCfg,
  });
  const renewalResult = await renewalAdapter.buildQuoteResponse(quoteData, {}, { resolvedCoverageSet: renewalResolvedCoverageSet });
  // ADR-0056: renewal terms carry the declared bordereau premium too.
  const renewalAlignment = alignQuoteResponseToDeclaredPremium({
    quoteResponse: renewalResult.quoteResponse,
    evaluation,
    runId,
  });
  const quoteResponse = renewalAlignment.quoteResponse;
  const uwDecision = renewalResult.underwritingAnalysis || {};
  const renewalProductFields = renewalAdapter.normalizeUwData(quoteData).productFields || {};
  const inceptionDate = new Date(evaluation.dto.inceptionDate || new Date().toISOString());
  const expiryDate = new Date(evaluation.dto.expiryDate || new Date(Date.now() + 365 * 86400000).toISOString());
  const migrationUw = migrationManualUwApprovalSnapshot(uwDecision);
  // Compute pricing stamp on the JSON-roundtripped payload so the persisted
  // snapshot hashes to the same value evaluateIssueReadiness recomputes at
  // bind time (avoids PRICING_DRIFT blockers — see importPassingRow).
  const persistedQuoteData = JSON.parse(JSON.stringify(quoteData)) as Prisma.InputJsonValue;
  const persistedQuoteResponse = JSON.parse(JSON.stringify(quoteResponse)) as Prisma.InputJsonValue;
  const pricingStamp = computePricingIntegrityStamp({
    quoteData: persistedQuoteData,
    quoteResponse: persistedQuoteResponse,
  });

  const created = await tenantScopedPrisma.$transaction(async (_tx) => {
    const tx = _tx as Prisma.TransactionClient;
    const renewalPolicyData: WithoutTenantScope<Prisma.PolicyUncheckedCreateInput> = {
      accountId: priorPolicy.accountId || undefined,
      insuredEntityId: priorPolicy.insuredEntityId || undefined,
      policyHolderId: priorPolicy.policyHolderId,
      policyNumber: priorPolicy.policyNumber,
      productType: priorPolicy.productType,
      programId: priorPolicy.programId || undefined,
      binderId,
      renewalFamilyId: priorPolicy.renewalFamilyId,
      priorTermPolicyId: priorPolicy.id,
      renewalSequence: (priorPolicy.renewalSequence || 1) + 1,
      status: 'QUOTED',
      inceptionDate,
      expiryDate,
      quoteData: persistedQuoteData,
      quoteResponse: persistedQuoteResponse,
      ...getProductLegacyColumns(renewalProductType, renewalProductFields),
    };
    const policy = await tx.policy.create({
      data: renewalPolicyData as Prisma.PolicyUncheckedCreateInput,
    });
    const renewalStateCreate: WithoutTenantScope<Prisma.PolicyStateCurrentUncheckedCreateInput> = {
      policyId: policy.id,
      snapshot: JSON.parse(JSON.stringify({
        quoteData: persistedQuoteData,
        quoteResponse: persistedQuoteResponse,
        uwDecision,
        pricing: pricingStamp,
        renewal: {
          source: 'BDX_IMPORT',
          status: 'BOUND',
          familyId: priorPolicy.renewalFamilyId,
          priorTermPolicyId: priorPolicy.id,
          priorTermPolicyNumber: priorPolicy.policyNumber,
        },
        ...(migrationUw ? { uw: migrationUw } : {}),
        bdxImport: {
          runId,
          rowKey: evaluation.dto.rowKey,
          termKey: evaluation.dto.termKey,
          sourceRowNumber: evaluation.dto.sourceRowNumber,
          sourcePolicyRef: evaluation.dto.policyRef,
          sourceSheetName: evaluation.dto.sourceSheetName,
          sourceMonth: evaluation.dto.sourceMonth,
          dryRun: request.dryRun,
          sourceHash: request.sourceHash,
          renewalFamilyId: priorPolicy.renewalFamilyId,
          priorTermPolicyId: priorPolicy.id,
          enrichmentProfile: evaluation.enrichment?.profile || 'BDX_CONTRACT_PROFILE_MOTOR',
          enrichmentVersion: evaluation.enrichment?.version || 'v2',
          filledFields: evaluation.enrichment?.filledFields || [],
          fieldSources: evaluation.enrichment?.fieldSources || {},
          migrationCompliance: requireMigrationCompliance(evaluation.migrationCompliance),
        },
      })),
    };
    await tx.policyStateCurrent.create({
      data: renewalStateCreate as Prisma.PolicyStateCurrentUncheckedCreateInput,
    });
    const renewalSearchIndexCreate: WithoutTenantScope<Prisma.PolicySearchIndexUncheckedCreateInput> = {
      policyId: policy.id,
      policyNumber: policy.policyNumber,
      insuredName: priorPolicy.policyHolder?.name || `Imported ${policy.policyNumber}`,
      status: policy.status,
      segment: renewalSegment,
      address: priorPolicy.policyHolder?.address || '',
    };
    await tx.policySearchIndex.upsert({
      where: { policyId: policy.id },
      update: {
        policyNumber: policy.policyNumber,
        insuredName: priorPolicy.policyHolder?.name || `Imported ${policy.policyNumber}`,
        status: policy.status,
        segment: renewalSegment,
        address: priorPolicy.policyHolder?.address || '',
      },
      create: renewalSearchIndexCreate as Prisma.PolicySearchIndexUncheckedCreateInput,
    });
    await enqueuePolicyListIndexUpdate(tx, policy.id);
    return policy;
  });

  const bindCoverageResult = await executeBindCoverage({
    policyId: created.id,
    actor: context.actor,
    correlationId: context.correlationId,
  });
  if (bindCoverageResult.status !== 'SUCCESS') {
    await tenantScopedPrisma.policy.delete({ where: { id: created.id } }).catch(() => undefined);
    return { error: JSON.stringify(bindCoverageResult.error) };
  }
  const issueResult = await issueImportedPolicy({ policyId: created.id, context });
  if (!issueResult.ok) {
    await tenantScopedPrisma.policy.delete({ where: { id: created.id } }).catch(() => undefined);
    return { error: issueResult.error || 'issue failed after renewal bind' };
  }
  const projectionSync = await synchronizeProjectionAfterImport(created.id);
  await enqueueAccountProjectionRefreshByAccountId(tenantScopedPrisma, priorPolicy.policyHolderId);
  return {
    policyId: created.id,
    status: 'imported',
    projectionWarning: projectionSync.status === 'verified' ? undefined : projectionSync.warning,
  };
}

export async function replayEndorsementRow(args: BdxEndorsementReplayCommand): Promise<{
  policyId?: string;
  status?: 'imported' | 'already_imported';
  error?: string;
  projectionWarning?: string;
}> {
  const { evaluation, runId, context } = args;
  const existingEndorsement = await findImportedEndorsementByRowKey(evaluation.dto.rowKey);
  if (existingEndorsement) {
    return { policyId: existingEndorsement.policyId, status: 'already_imported' };
  }
  const policyId = args.policyId || await findImportedPolicyByPolicyNumber(evaluation.dto.policyRef);
  if (!policyId) {
    return { error: `Base policy ${evaluation.dto.policyRef} must be imported before replaying endorsements` };
  }
  if (!evaluation.normalizedQuoteData) {
    return { error: 'Missing normalized quote data for endorsement replay row' };
  }
  const transactionType = replayTransactionType(evaluation);
  const createResult = await executeCreateEndorsementDraft({
    policyId,
    effectiveDate: new Date(endorsementEffectiveDate(evaluation)),
    reason: `BDX replay ${evaluation.dto.entry || 'ENDORSEMENT'}`,
    reasonCode: endorsementReasonCode(evaluation),
    actor: context.actor,
    transactionType,
  });
  if (createResult.status !== 'SUCCESS') {
    return { error: JSON.stringify(createResult.error) };
  }
  const riskTransactionId = createResult.data.riskTransactionId;
  const patchResult = await executePatchEndorsementDraft({
    policyId,
    riskTransactionId,
    actor: context.actor,
    body: {
      effectiveDate: endorsementEffectiveDate(evaluation),
      expiryDate: evaluation.dto.expiryDate || undefined,
      quoteData: evaluation.normalizedQuoteData,
      endorsementMeta: {
        bdxImport: {
          runId,
          rowKey: evaluation.dto.rowKey,
          termKey: evaluation.dto.termKey,
          sourceRowNumber: evaluation.dto.sourceRowNumber,
          sourcePolicyRef: evaluation.dto.policyRef,
          sourceSheetName: evaluation.dto.sourceSheetName,
          sourceMonth: evaluation.dto.sourceMonth,
        },
      },
    },
  });
  if (patchResult.status !== 'SUCCESS') {
    return { error: JSON.stringify(patchResult.error) };
  }
  const rateResult = await executeRateEndorsementDraft({
    policyId,
    riskTransactionId,
    actor: context.actor,
  });
  if (rateResult.status !== 'SUCCESS') {
    return { error: JSON.stringify(rateResult.error) };
  }
  const bindResult = await executeBindEndorsementDraft({
    policyId,
    riskTransactionId,
    actor: context.actor,
  });
  if (bindResult.status !== 'SUCCESS') {
    return { error: JSON.stringify(bindResult.error) };
  }
  const issueResult = await executeIssueEndorsement({
    policyId,
    riskTransactionId,
    actor: context.actor,
    confirmManualRefundAck: true,
    correlationId: context.correlationId,
  });
  if (issueResult.status !== 'SUCCESS') {
    return { error: JSON.stringify(issueResult.error) };
  }
  const projectionSync = await synchronizeProjectionAfterImport(policyId);
  return {
    policyId,
    status: 'imported',
    projectionWarning: projectionSync.status === 'verified' ? undefined : projectionSync.warning,
  };
}

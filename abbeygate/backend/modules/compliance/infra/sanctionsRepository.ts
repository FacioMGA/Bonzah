// `Prisma` is imported as a runtime value (not `import type`) because the
// `firstHitJson` write path needs `Prisma.JsonNull` to explicitly null the
// JSONB column — the type-only import would compile-error on the value
// reference. The `Prisma.*` namespace types (InputJsonValue, etc.) are
// reachable through the value import as well.
import { Prisma } from '@prisma/client';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { appendDomainEvent, buildDomainEvent } from '../../../platform/events/domainEvents.js';
import { REUSABLE_SCREENING_OUTCOMES } from '../domain/sanctionsIdempotency.js';
import type {
  ComplianceDecisionRecord,
  ComplianceDecisionType,
  ComplianceReasonCode,
  SanctionFirstHit,
  SanctionOutcome,
  SanctionProvider,
  SanctionScreeningRunRecord,
  SanctionSubjectType,
  ScreeningActionType,
} from '../domain/sanctionsTypes.js';

type DecisionInsertInput = Omit<ComplianceDecisionRecord, 'id'>;
type RunInsertInput = Omit<SanctionScreeningRunRecord, 'id'>;
type ScreeningRunWithDecisions = Prisma.SanctionScreeningRunGetPayload<{
  include: { decisions: true };
}>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function toSanctionProvider(value: string): SanctionProvider {
  if (value === 'creditsafe') return value;
  throw new Error(`Unexpected sanction provider: ${value}`);
}

function toSanctionSubjectType(value: string): SanctionSubjectType {
  if (value === 'individual' || value === 'business') return value;
  throw new Error(`Unexpected sanction subject type: ${value}`);
}

function toScreeningActionType(value: string): ScreeningActionType {
  const allowed: ScreeningActionType[] = [
    'QUOTE_RATE',
    'PAYMENT_CHECKOUT',
    'POLICY_BIND',
    'POLICY_BIND_COVERAGE',
    'POLICY_ISSUE',
    'PUBLIC_API_BIND_ISSUE',
    'PAYMENT_ISSUE',
  ];
  if (allowed.includes(value as ScreeningActionType)) return value as ScreeningActionType;
  throw new Error(`Unexpected screening action type: ${value}`);
}

function toSanctionOutcome(value: string): SanctionOutcome {
  const allowed: SanctionOutcome[] = ['clear', 'non_blocking_hit', 'possible_match', 'match', 'provider_unavailable', 'error'];
  if (allowed.includes(value as SanctionOutcome)) return value as SanctionOutcome;
  throw new Error(`Unexpected sanction outcome: ${value}`);
}

function toComplianceDecisionType(value: string): ComplianceDecisionType {
  const allowed: ComplianceDecisionType[] = ['allow_bind', 'block_bind', 'manual_review_required'];
  if (allowed.includes(value as ComplianceDecisionType)) return value as ComplianceDecisionType;
  throw new Error(`Unexpected compliance decision type: ${value}`);
}

function toComplianceReasonCode(value: string): ComplianceReasonCode {
  const allowed: ComplianceReasonCode[] = ['NO_HITS', 'NON_BLOCKING_HITS', 'HITS_FOUND', 'PROVIDER_UNAVAILABLE', 'SCREENING_ERROR'];
  if (allowed.includes(value as ComplianceReasonCode)) return value as ComplianceReasonCode;
  throw new Error(`Unexpected compliance reason code: ${value}`);
}

function toDecisionActor(value: string): 'system' | 'user' {
  if (value === 'system' || value === 'user') return value;
  throw new Error(`Unexpected decision actor: ${value}`);
}

/**
 * Best-effort cast from the persisted JSONB column back to the domain shape.
 * The column is owned by `SanctionsService` writes — we never trust arbitrary
 * shapes here, so anything that doesn't structurally match yields null and
 * callers degrade gracefully (BO row hides, blocker still surfaces).
 */
function toFirstHit(value: unknown): SanctionFirstHit | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.hitId !== 'string' || record.hitId.trim() === '') return null;
  return {
    matchScore: typeof record.matchScore === 'number' ? record.matchScore : null,
    name: typeof record.name === 'string' ? record.name : '',
    country: typeof record.country === 'string' ? record.country : '',
    dateOfBirth: typeof record.dateOfBirth === 'string' ? record.dateOfBirth : '',
    gender: typeof record.gender === 'string' ? record.gender : '',
    pepTier: typeof record.pepTier === 'string' ? record.pepTier : '',
    reasonsListed: typeof record.reasonsListed === 'string' ? record.reasonsListed : '',
    hitId: record.hitId,
    hitIdsAll: Array.isArray(record.hitIdsAll)
      ? record.hitIdsAll.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [],
  };
}

export class SanctionsRepository {
  /**
   * Find a prior PAID Creditsafe result for the same policy + insured subject
   * that may be reused instead of paying for another search. The `subjectKey`
   * already carries the reuse-window bucket (see `deriveSanctionsSubjectKey`),
   * so an exact key match is by construction "same subject, within the current
   * window". Deliberately ignores `actionType` so a `clear` recorded at checkout
   * is reused at bind and issue. Failure outcomes (`provider_unavailable`,
   * `error`) are excluded so a retry after an outage re-screens. This is what
   * caps paid checks at ~one per purchasing customer per window.
   */
  async findReusableScreening(args: {
    policyId?: string | null;
    provider: 'creditsafe';
    subjectKey: string;
  }): Promise<{ run: SanctionScreeningRunRecord; decision: ComplianceDecisionRecord } | null> {
    if (!args.policyId || !args.subjectKey) return null;

    const existing = await tenantScopedPrisma.sanctionScreeningRun.findFirst({
      where: {
        policyId: args.policyId,
        provider: args.provider,
        idempotencyKey: args.subjectKey,
        outcome: { in: [...REUSABLE_SCREENING_OUTCOMES] },
      },
      include: { decisions: { orderBy: { decidedAt: 'desc' }, take: 1 } },
      orderBy: { executedAt: 'desc' },
    });

    return this.mapRunAndDecision(existing);
  }

  private async mapRunAndDecision(
    existing: ScreeningRunWithDecisions | null
  ): Promise<{ run: SanctionScreeningRunRecord; decision: ComplianceDecisionRecord } | null> {
    if (!existing || !existing.decisions[0]) return null;
    const decision: ComplianceDecisionRecord = {
      id: existing.decisions[0].id,
      screeningRunId: existing.decisions[0].screeningRunId,
      decision: toComplianceDecisionType(existing.decisions[0].decision),
      reasonCode: toComplianceReasonCode(existing.decisions[0].reasonCode),
      decidedAt: existing.decisions[0].decidedAt,
      decidedBy: toDecisionActor(existing.decisions[0].decidedBy),
      note: existing.decisions[0].note ?? undefined,
    };
    const reportFilename = await this.lookupReportFilename(existing.reportDocumentId);
    const run: SanctionScreeningRunRecord = {
      id: existing.id,
      tenantId: existing.operatingTenantId,
      policyId: existing.policyId ?? null,
      quoteSessionId: existing.quoteSessionId ?? null,
      customerId: existing.customerId ?? null,
      provider: toSanctionProvider(existing.provider),
      providerSearchId: existing.providerSearchId ?? undefined,
      subjectType: toSanctionSubjectType(existing.subjectType),
      subjectName: existing.subjectName,
      countryCodes: Array.isArray(existing.countryCodes) ? (existing.countryCodes as string[]) : [],
      threshold: existing.threshold,
      datasets: Array.isArray(existing.datasets) ? (existing.datasets as string[]) : [],
      actionType: toScreeningActionType(existing.actionType),
      outcome: toSanctionOutcome(existing.outcome),
      blocking: existing.blocking,
      hitCount: existing.hitCount,
      providerStatus: existing.providerStatus ?? undefined,
      providerRiskRating: existing.providerRiskRating ?? undefined,
      firstHit: toFirstHit(existing.firstHitJson),
      reportDocumentId: existing.reportDocumentId,
      reportFilename,
      requestJson: existing.requestJson,
      responseJson: existing.responseJson,
      executedAt: existing.executedAt,
      correlationId: existing.correlationId,
      idempotencyKey: existing.idempotencyKey ?? undefined,
    };

    return {
      run,
      decision,
    };
  }

  private async lookupReportFilename(documentId: string | null | undefined): Promise<string | null> {
    if (!documentId) return null;
    const doc = await tenantScopedPrisma.document.findUnique({
      where: { id: documentId },
      select: { filename: true },
    });
    return doc?.filename ?? null;
  }

  async createRunAndDecision(runInput: RunInsertInput, decisionInput: DecisionInsertInput): Promise<{
    run: SanctionScreeningRunRecord;
    decision: ComplianceDecisionRecord;
  }> {
    const result = await tenantScopedPrisma.$transaction(async (tx) => {
      const runData: Prisma.SanctionScreeningRunUncheckedCreateInput = {
        operatingTenantId: getTenantConfig().id,
        policyId: runInput.policyId || null,
        quoteSessionId: runInput.quoteSessionId || null,
        customerId: runInput.customerId || null,
        provider: runInput.provider,
        providerSearchId: runInput.providerSearchId,
        subjectType: runInput.subjectType,
        subjectName: runInput.subjectName,
        countryCodes: toInputJson(runInput.countryCodes),
        threshold: runInput.threshold,
        datasets: toInputJson(runInput.datasets),
        actionType: runInput.actionType,
        outcome: runInput.outcome,
        blocking: runInput.blocking,
        hitCount: runInput.hitCount,
        providerStatus: runInput.providerStatus,
        providerRiskRating: runInput.providerRiskRating,
        firstHitJson: runInput.firstHit ? toInputJson(runInput.firstHit) : Prisma.JsonNull,
        requestJson: toInputJson(runInput.requestJson),
        responseJson: toInputJson(runInput.responseJson),
        executedAt: runInput.executedAt,
        correlationId: runInput.correlationId,
        idempotencyKey: runInput.idempotencyKey || null,
      };
      const run = await tx.sanctionScreeningRun.create({
        data: runData,
      });

      const decision = await tx.complianceDecision.create({
        data: {
          screeningRunId: run.id,
          decision: decisionInput.decision,
          reasonCode: decisionInput.reasonCode,
          decidedAt: decisionInput.decidedAt,
          decidedBy: decisionInput.decidedBy,
          note: decisionInput.note,
        },
      });

      if (run.policyId) {
        const state = await tx.policyStateCurrent.findUnique({ where: { policyId: run.policyId } });
        const current = asRecord(state?.snapshot);
        const compliance = asRecord(current.compliance);
        const screening = {
          screeningRunId: run.id,
          provider: run.provider,
          status: run.outcome,
          blocking: run.blocking,
          hitCount: run.hitCount,
          providerSearchId: run.providerSearchId || null,
          providerRiskRating: run.providerRiskRating || null,
          reasonCode: decision.reasonCode,
          decidedAt: decision.decidedAt.toISOString(),
          actionType: run.actionType,
          correlationId: run.correlationId,
          // BO underwriting + premium tabs render the first-hit row from this
          // projection (no extra fetch). reportDocumentId is null at this
          // point — linkReportDocument patches it after the PDF lands.
          firstHit: runInput.firstHit ?? null,
          reportDocumentId: null as string | null,
          reportFilename: null as string | null,
        };
        const nextSnapshot = {
          ...current,
          compliance: {
            ...compliance,
            sanctions: screening,
          },
        };

        await tx.policyStateCurrent.upsert({
          where: { policyId: run.policyId },
          create: { operatingTenantId: getTenantConfig().id, policyId: run.policyId, snapshot: toInputJson(nextSnapshot) } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
          update: { snapshot: toInputJson(nextSnapshot) },
        });

        const event = buildDomainEvent({
          eventType: 'POLICY.COMPLIANCE.SANCTIONS_DECIDED',
          aggregateType: 'POLICY',
          aggregateId: run.policyId,
          aggregateVersion: 1,
          actorType: 'SYSTEM',
          actorId: 'system',
          correlationId: run.correlationId,
          reasonCode: decision.reasonCode,
          data: toInputJson({
            runId: run.id,
            decision: decision.decision,
            outcome: run.outcome,
            actionType: run.actionType,
            correlationId: run.correlationId,
          }),
        });
        // Cast: the extended tx is a structural superset of Prisma.TransactionClient.
        // The extension propagates into the transaction so operatingTenantId is
        // injected automatically on the outbox.create inside appendDomainEvent.
        await appendDomainEvent(tx as unknown as Prisma.TransactionClient, event);
      }

      return { run, decision };
    });

    const runRecord: SanctionScreeningRunRecord = {
      id: result.run.id,
      tenantId: result.run.operatingTenantId,
      policyId: result.run.policyId ?? null,
      quoteSessionId: result.run.quoteSessionId ?? null,
      customerId: result.run.customerId ?? null,
      provider: toSanctionProvider(result.run.provider),
      providerSearchId: result.run.providerSearchId ?? undefined,
      subjectType: toSanctionSubjectType(result.run.subjectType),
      subjectName: result.run.subjectName,
      countryCodes: Array.isArray(result.run.countryCodes) ? (result.run.countryCodes as string[]) : [],
      threshold: result.run.threshold,
      datasets: Array.isArray(result.run.datasets) ? (result.run.datasets as string[]) : [],
      actionType: toScreeningActionType(result.run.actionType),
      outcome: toSanctionOutcome(result.run.outcome),
      blocking: result.run.blocking,
      hitCount: result.run.hitCount,
      providerStatus: result.run.providerStatus ?? undefined,
      providerRiskRating: result.run.providerRiskRating ?? undefined,
      firstHit: toFirstHit(result.run.firstHitJson),
      reportDocumentId: result.run.reportDocumentId ?? null,
      reportFilename: null,
      requestJson: result.run.requestJson,
      responseJson: result.run.responseJson,
      executedAt: result.run.executedAt,
      correlationId: result.run.correlationId,
      idempotencyKey: result.run.idempotencyKey ?? undefined,
    };
    const decisionRecord: ComplianceDecisionRecord = {
      id: result.decision.id,
      screeningRunId: result.decision.screeningRunId,
      decision: toComplianceDecisionType(result.decision.decision),
      reasonCode: toComplianceReasonCode(result.decision.reasonCode),
      decidedAt: result.decision.decidedAt,
      decidedBy: toDecisionActor(result.decision.decidedBy),
      note: result.decision.note ?? undefined,
    };
    return { run: runRecord, decision: decisionRecord };
  }

  /**
   * Wire the persisted Creditsafe PDF (Document) onto the screening run and
   * patch the canonical `policyStateCurrent.snapshot.compliance.sanctions`
   * projection so the BO PremiumNotes / Underwriting card can render the
   * download link without a follow-up join.
   *
   * Deliberately a separate transaction from `createRunAndDecision`: the PDF
   * fetch is an external HTTP roundtrip we don't want holding a DB tx open,
   * and a PDF fetch failure must not undo a correctly-recorded blocking
   * decision. The canonical decision row (`SanctionScreeningRun`) is already
   * authoritative without the report.
   */
  async linkReportDocument(args: {
    runId: string;
    documentId: string;
    filename: string;
    policyId?: string | null;
  }): Promise<void> {
    await tenantScopedPrisma.$transaction(async (tx) => {
      await tx.sanctionScreeningRun.update({
        where: { id: args.runId },
        data: { reportDocumentId: args.documentId },
      });

      if (!args.policyId) return;

      const state = await tx.policyStateCurrent.findUnique({ where: { policyId: args.policyId } });
      if (!state) return;
      const current = asRecord(state.snapshot);
      const compliance = asRecord(current.compliance);
      const sanctions = asRecord(compliance.sanctions);
      // Defensive: only patch when this run still owns the projection. If a
      // later screening run has already overwritten the slot we leave it
      // alone — that newer decision is canonical.
      if (sanctions.screeningRunId !== args.runId) return;
      const nextSanctions = {
        ...sanctions,
        reportDocumentId: args.documentId,
        reportFilename: args.filename,
      };
      const nextSnapshot = {
        ...current,
        compliance: { ...compliance, sanctions: nextSanctions },
      };
      await tx.policyStateCurrent.update({
        where: { policyId: args.policyId },
        data: { snapshot: toInputJson(nextSnapshot) },
      });
    });
  }
}

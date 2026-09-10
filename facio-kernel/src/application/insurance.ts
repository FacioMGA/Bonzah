import type { RenewalInput } from '../contracts/insurance-renewal.js';
import { compareRenewalSubmissions } from '../domain/insurance-renewal.js';
import { randomUUID } from 'node:crypto';
import { scopeSchema, type Context, type Scope } from '../contracts/configuration.js';
import {
  insuranceOperations,
  insuranceRecordSchema,
  insuranceEventSchema,
  scopedRuntimePolicySchema,
  type ScopedRuntimePolicy,
  type RuntimePolicy,
  type ExternalQuote,
  type InsuranceRecord,
  type InsuranceEvent,
  type InsuranceOperationName,
  type InsuranceMutationResult,
} from '../contracts/insurance.js';
import { minorUnitSchema } from '../contracts/money.js';
import { allocateFinancials } from '../domain/money.js';
import { canonicalJson, hash, KernelError } from '../domain/canonical.js';
import { Store } from '../storage/store.js';
import {
  evaluateConfiguredCancellation,
  evaluateConfiguredService,
  effectiveConfiguredSubmission,
} from '../domain/insurance-service.js';
import type {
  ConfiguredCancellationInput,
  ConfiguredServiceInput,
} from '../contracts/insurance-service.js';
import { evaluateInsuranceProduct } from '../domain/insurance-decision.js';
import type { ApprovalGate, ApprovalTarget } from '../contracts/approval.js';
import { validateBindApproval } from './approval.js';
import { configuredSubmissionV2Schema } from '../contracts/insurance-definition.js';
import type {
  ConfiguredSubmission,
  InsuranceEvaluation,
} from '../contracts/insurance-definition.js';

const scopeOf = (context: Scope): Scope =>
  scopeSchema.parse({
    workspaceId: context.workspaceId,
    tenantId: context.tenantId,
    environment: context.environment,
    operatingEntityId: context.operatingEntityId,
  });
const scopeKey = (scope: Scope) => canonicalJson(scopeOf(scope));
const policyKey = (scope: Scope, id: string, version: string) =>
  canonicalJson([scopeKey(scope), id, version]);
function fail(code: string, message: string, status = 422): never {
  throw new KernelError(code, message, status);
}

/** A local manual workflow. It never contacts a carrier, payment provider or delivery service. */
export class InsuranceApplication {
  private readonly policies = new Map<string, ScopedRuntimePolicy>();
  constructor(
    private readonly store: Store,
    policies: readonly ScopedRuntimePolicy[],
    private readonly clock: () => Date = () => new Date(),
  ) {
    for (const raw of policies) {
      const entry = scopedRuntimePolicySchema.parse(raw);
      if (!['development', 'sandbox'].includes(entry.scope.environment))
        fail(
          'RUNTIME_ENVIRONMENT_UNSUPPORTED',
          'Runtime policy registration is limited to development and sandbox',
          403,
        );
      if (
        hash(entry.policy) !== entry.policyHash ||
        entry.policy.effectiveFrom > entry.policy.effectiveTo
      )
        fail('INTEGRITY_ERROR', 'Runtime policy content hash or effective window is invalid', 500);
      const key = policyKey(entry.scope, entry.policy.id, entry.policy.version);
      if (this.policies.has(key))
        fail(
          'INTEGRITY_ERROR',
          'A runtime product version may be registered only once per scope',
          500,
        );
      this.policies.set(key, entry);
    }
  }

  private policy(
    context: Context,
    id: string,
    version: string,
    expectedHash?: string,
    releaseId?: string,
  ): ScopedRuntimePolicy & { runtimeReleaseId?: string } {
    let entry: (ScopedRuntimePolicy & { runtimeReleaseId?: string }) | undefined;
    if (this.store.control.isManaged(context)) {
      if (expectedHash && !releaseId)
        fail(
          'POLICY_VERSION_CONFLICT',
          'Managed records must pin their immutable sandbox release',
          409,
        );
      const release = this.store.control.release(context, releaseId);
      const policy = release?.runtimeDraft.policies.find(
        (p) => p.id === id && p.version === version,
      );
      if (policy && release)
        entry = {
          scope: scopeOf(context),
          policy,
          policyHash: hash(policy),
          runtimeReleaseId: release.id,
        };
    } else entry = this.policies.get(policyKey(context, id, version));
    if (!entry)
      fail(
        'POLICY_NOT_AVAILABLE',
        'The selected runtime product version is not registered in this scope',
        422,
      );
    if (expectedHash && expectedHash !== entry.policyHash)
      fail(
        'POLICY_VERSION_CONFLICT',
        'The stored product policy differs from the registered version',
        409,
      );
    return entry;
  }

  private validateQuote(quote: ExternalQuote, policy: RuntimePolicy, now: Date) {
    const today = now.toISOString().slice(0, 10);
    if (today < policy.effectiveFrom || today > policy.effectiveTo)
      fail('POLICY_NOT_EFFECTIVE', 'The runtime product policy is not effective today');
    if (
      quote.term.startDate > quote.term.endDate ||
      quote.term.endDate < today ||
      quote.term.startDate < policy.effectiveFrom ||
      quote.term.startDate > policy.effectiveTo
    )
      fail(
        'INVALID_TERM',
        'The quote term must be ordered, unexpired and start within the product policy window',
      );
    if (Date.parse(quote.expiresAt) <= now.getTime())
      fail('QUOTE_EXPIRED', 'The external quote has expired');
    if (BigInt(quote.premiumMinor) > BigInt(policy.maximumPremiumMinor))
      fail('PREMIUM_LIMIT_EXCEEDED', 'The quote exceeds the registered gross premium limit');
    if (quote.participants.length > policy.maximumParticipants)
      fail('CAPACITY_LIMIT_EXCEEDED', 'The quote exceeds the registered participant count limit');
    return allocateFinancials({
      currency: policy.currency,
      premiumMinor: quote.premiumMinor,
      participants: quote.participants,
      commission: policy.commission,
    });
  }
  private productDefinition(
    context: Context,
    entry: ScopedRuntimePolicy & { runtimeReleaseId?: string },
  ) {
    const release = entry.runtimeReleaseId
      ? this.store.control.release(context, entry.runtimeReleaseId)
      : null;
    const insurance = release?.configuration.configuration.products.find(
      (product) => product.id === entry.policy.id && product.version === entry.policy.version,
    )?.insurance;
    return { insurance, release };
  }
  private evaluate(
    context: Context,
    productId: string,
    productVersion: string,
    submission: ConfiguredSubmission,
    now: Date,
    record?: InsuranceRecord,
  ) {
    if (
      record &&
      (record.sourceMode !== 'configured_product' ||
        record.productId !== productId ||
        record.productVersion !== productVersion)
    )
      fail(
        'RECORD_TYPE_MISMATCH',
        'The selected record does not use this configured insurance product',
        409,
      );
    const entry = this.policy(
      context,
      productId,
      productVersion,
      record?.productPolicyHash,
      record?.runtimeReleaseId,
    );
    const { insurance, release } = this.productDefinition(context, entry);
    if (!insurance || !release)
      fail(
        'INSURANCE_DEFINITION_NOT_AVAILABLE',
        'No active or retained executable insurance definition exists for this product',
      );
    return {
      entry,
      evaluation: evaluateInsuranceProduct(
        {
          productId,
          productVersion,
          definition: insurance,
          policy: entry.policy,
          policyHash: entry.policyHash,
          runtimeReleaseId: release.id,
          releaseHash: release.hash,
          now,
        },
        submission,
      ),
    };
  }
  private renewalSource(
    context: Context,
    input: { sourceRecordId: string; sourceVersion: number; sourceRecordHash: string },
    submission: ConfiguredSubmission,
    productId: string,
  ) {
    const source = this.current(
        context,
        input.sourceRecordId,
        input.sourceVersion,
        input.sourceRecordHash,
      ),
      effective = effectiveConfiguredSubmission(source);
    if (
      source.status !== 'bound' ||
      source.sourceMode !== 'configured_product' ||
      !effective ||
      !source.runtimeReleaseId
    )
      fail(
        'RENEWAL_SOURCE_UNSUPPORTED',
        'Renewal requires a bound configured source; cancellation belongs to a separate branch',
      );
    if (source.productId !== productId)
      fail('RENEWAL_PRODUCT_MISMATCH', 'A linked renewal must retain the product identity');
    if (submission.term.startDate <= effective.term.endDate)
      fail(
        'RENEWAL_TERM_OVERLAP',
        'The distinct renewal term must begin after the expiring effective term',
      );
    if (submission.reference === effective.reference)
      fail(
        'RENEWAL_REFERENCE_REQUIRED',
        'Use a separate source reference and evidence for the new term',
      );
    return { source, effective };
  }
  private evaluateRenewal(context: Context, input: RenewalInput, now: Date) {
    const { source, effective } = this.renewalSource(
      context,
      input,
      input.submission,
      input.productId,
    );
    const { entry, evaluation } = this.evaluate(
      context,
      input.productId,
      input.productVersion,
      input.submission,
      now,
    );
    const content = {
      source: {
        recordId: source.id,
        version: source.version,
        recordHash: source.recordHash,
        quoteHash: source.quoteHash,
        submissionHash: hash(effective),
        runtimeReleaseId: source.runtimeReleaseId!,
      },
      comparison: compareRenewalSubmissions(effective, input.submission),
      evaluation,
    };
    return { entry, report: { ...content, renewalHash: hash(content) } };
  }
  private evaluateCancellation(context: Context, input: ConfiguredCancellationInput, now: Date) {
    const record = this.current(context, input.recordId, input.expectedVersion, input.recordHash);
    const entry = this.policy(
      context,
      record.productId,
      record.productVersion,
      record.productPolicyHash,
      record.runtimeReleaseId,
    );
    const { insurance, release } = this.productDefinition(context, entry);
    if (
      record.sourceMode !== 'configured_product' ||
      insurance?.schemaVersion !== 'insurance-product-v2' ||
      !release
    )
      fail(
        'CANCELLATION_VERSION_UNSUPPORTED',
        'Retained v2 configuration is required for cancellation',
      );
    return {
      record,
      entry,
      preview: evaluateConfiguredCancellation(
        { record, definition: insurance, policy: entry.policy, releaseHash: release.hash, now },
        input,
      ),
    };
  }
  private evaluateService(context: Context, input: ConfiguredServiceInput, now: Date) {
    const record = this.current(context, input.recordId, input.expectedVersion, input.recordHash);
    const entry = this.policy(
      context,
      record.productId,
      record.productVersion,
      record.productPolicyHash,
      record.runtimeReleaseId,
    );
    const { insurance, release } = this.productDefinition(context, entry);
    if (
      record.sourceMode !== 'configured_product' ||
      insurance?.schemaVersion !== 'insurance-product-v2' ||
      !release
    )
      fail(
        'SERVICE_VERSION_UNSUPPORTED',
        'This record does not retain a v2 executable servicing definition',
      );
    const preview = evaluateConfiguredService(
      { record, definition: insurance, policy: entry.policy, releaseHash: release.hash, now },
      input,
    );
    const history = this.store.insuranceHistory(context, record.id).revisions;
    const reasons = [...preview.reasons];
    if (
      history.some(
        (revision) =>
          revision.quote.sourceQuote.version === input.submission.version ||
          revision.configuredService?.submission.version === input.submission.version,
      )
    )
      reasons.push('Proposal version was already used by a retained quote or service revision');
    const previous = configuredSubmissionV2Schema.safeParse(effectiveConfiguredSubmission(record));
    if (previous.success)
      for (const group of input.submission.riskGroups) {
        const currentIds = new Set(
          previous.data.riskGroups
            .find((g) => g.groupId === group.groupId)
            ?.rows.map((r) => r.rowId) ?? [],
        );
        const historicalIds = new Set(
          history.flatMap((revision) => {
            const effective = configuredSubmissionV2Schema.safeParse(
              effectiveConfiguredSubmission(revision),
            );
            return effective.success
              ? (effective.data.riskGroups
                  .find((g) => g.groupId === group.groupId)
                  ?.rows.map((r) => r.rowId) ?? [])
              : [];
          }),
        );
        if (group.rows.some((row) => historicalIds.has(row.rowId) && !currentIds.has(row.rowId)))
          reasons.push(
            'A removed stable risk-row identifier cannot be reassigned or restored through this service contract',
          );
      }
    const { evaluationHash: _, ...content } = preview;
    const revised = {
      ...content,
      status: reasons.length ? ('blocked' as const) : ('allowed' as const),
      reasons: [...new Set(reasons)],
    };
    return { record, entry, preview: { ...revised, evaluationHash: hash(revised) } };
  }
  private configuredQuote(
    submission: ConfiguredSubmission,
    evaluation: InsuranceEvaluation,
    participants: ExternalQuote['participants'],
  ): ExternalQuote {
    if (
      evaluation.validation.status !== 'valid' ||
      evaluation.rating.status !== 'calculated' ||
      !evaluation.rating.premiumMinor
    )
      fail(
        'DECISION_NOT_RATED',
        'Resolve the risk, coverage and rating blockers before capturing a configured quote',
      );
    return {
      sourceQuote: {
        reference: submission.reference,
        version: submission.version,
        evidenceRefs: submission.evidenceRefs,
      },
      risk: { summary: submission.summary, externalRiskReference: null },
      term: submission.term,
      expiresAt: submission.expiresAt,
      eligibility:
        evaluation.eligibility.status === 'declined'
          ? 'declined'
          : evaluation.bind.status === 'allowed'
            ? 'quote_ready'
            : 'referred',
      premiumMinor: evaluation.rating.premiumMinor,
      participants,
    };
  }

  private checkPrerequisites(policy: RuntimePolicy) {
    for (const [gate, value] of Object.entries(policy.requirements))
      if (value !== 'not_required')
        fail(
          'PREREQUISITE_UNSUPPORTED',
          `This product requires ${gate}; its trusted verification workflow is not implemented`,
        );
  }

  /** Read-only display definition resolved from this insurance record's exact retained policy. */
  approvalReviewDefinition(context: Context, record: InsuranceRecord) {
    const entry = this.policy(
      context,
      record.productId,
      record.productVersion,
      record.productPolicyHash,
      record.runtimeReleaseId,
    );
    return this.productDefinition(context, entry).insurance ?? null;
  }

  /** Re-evaluates supported review gates against the retained definition. No approval is applied here. */
  assessApproval(
    context: Context,
    record: InsuranceRecord,
    now: Date,
  ): {
    target: ApprovalTarget;
    gates: ApprovalGate[];
    blockers: string[];
    evaluation: InsuranceEvaluation | null;
  } {
    if (!['development', 'sandbox'].includes(context.environment))
      fail(
        'RUNTIME_ENVIRONMENT_UNSUPPORTED',
        'Independent review is limited to development and sandbox',
        403,
      );
    const entry = this.policy(
      context,
      record.productId,
      record.productVersion,
      record.productPolicyHash,
      record.runtimeReleaseId,
    );
    const { release } = this.productDefinition(context, entry);
    const target: ApprovalTarget = {
      recordId: record.id,
      recordVersion: record.version,
      recordHash: record.recordHash,
      quoteHash: record.quoteHash,
      productId: record.productId,
      productVersion: record.productVersion,
      policyHash: record.productPolicyHash,
      runtimeReleaseId: record.runtimeReleaseId ?? null,
      releaseHash: release?.hash ?? null,
      definitionHash: record.decision?.evaluation.definitionHash ?? null,
      inputHash: record.decision?.evaluation.inputHash ?? null,
      decisionHash: record.decision?.evaluation.evaluationHash ?? null,
    };
    const blockers: string[] = [];
    const gates: ApprovalGate[] = [];
    if (record.status !== 'quoted')
      blockers.push('Independent review only applies to an unbound quoted revision');
    try {
      this.validateQuote(record.quote, entry.policy, now);
    } catch (error) {
      if (!(error instanceof KernelError) || error.code === 'INTEGRITY_ERROR') throw error;
      blockers.push(error.message);
    }
    if (entry.policy.requirements.payment !== 'not_required')
      blockers.push('Human approval cannot satisfy payment verification');
    if (entry.policy.requirements.providerVerification !== 'not_required')
      blockers.push('Human approval cannot satisfy provider verification');
    if (entry.policy.requirements.approval === 'required_unsupported')
      blockers.push(
        'This policy requires an unsupported approval workflow, not independent human review',
      );
    if (entry.policy.requirements.approval === 'independent_review') gates.push('routine_approval');
    if (record.quote.term.startDate < now.toISOString().slice(0, 10))
      blockers.push('Human approval cannot authorize backdated inception');
    let evaluation: InsuranceEvaluation | null = null;
    if (record.sourceMode === 'configured_product') {
      if (!record.decision)
        fail('INTEGRITY_ERROR', 'Configured quote has no pinned decision evidence', 500);
      const original = this.evaluate(
        context,
        record.productId,
        record.productVersion,
        record.decision.submission,
        new Date(record.decision.evaluatedAt),
        record,
      ).evaluation;
      if (
        hash(original) !== hash(record.decision.evaluation) ||
        hash(
          this.configuredQuote(record.decision.submission, original, record.quote.participants),
        ) !== record.quoteHash
      )
        fail(
          'INTEGRITY_ERROR',
          'Configured quote differs from its server-derived decision evidence',
          500,
        );
      evaluation = this.evaluate(
        context,
        record.productId,
        record.productVersion,
        record.decision.submission,
        now,
        record,
      ).evaluation;
      if (evaluation.validation.status !== 'valid')
        blockers.push('Human approval cannot resolve invalid or missing risk and coverage inputs');
      if (evaluation.applicability.status !== 'applicable')
        blockers.push(...evaluation.applicability.reasons);
      if (evaluation.eligibility.status !== 'eligible')
        blockers.push(
          'Human approval cannot override a decline or undetermined underwriting decision',
        );
      if (evaluation.referral.status === 'undetermined')
        blockers.push('Human approval cannot resolve an undetermined referral');
      if (
        evaluation.rating.status !== 'calculated' ||
        evaluation.rating.premiumMinor !== record.quote.premiumMinor
      )
        blockers.push('Human approval cannot supply or change the configured premium');
      if (evaluation.authority.status !== 'within_authority')
        blockers.push('Human approval cannot override configured authority limits');
      if (evaluation.referral.status === 'required') gates.push('referral');
    } else if (record.quote.eligibility !== 'quote_ready')
      blockers.push('Human approval cannot replace an external referral or decline decision');
    if (!gates.length) blockers.push('This quote has no supported independent review gate');
    return { target, gates: gates.sort(), blockers: [...new Set(blockers)], evaluation };
  }

  private current(
    context: Context,
    recordId: string,
    version: number,
    expectedHash: string,
    quoteHash = false,
  ) {
    // Verify the complete immutable chain before appending a new transition.
    const history = this.store.insuranceHistory(context, recordId);
    const record = history.revisions.at(-1)!;
    if (
      record.version !== version ||
      (quoteHash ? record.quoteHash : record.recordHash) !== expectedHash
    )
      fail(
        'VERSION_CONFLICT',
        'The selected insurance revision or quote hash is stale; reload the record',
        409,
      );
    return record;
  }

  private save(
    content: Omit<InsuranceRecord, 'recordHash'>,
    context: Context,
    previous: InsuranceRecord | null,
    type: InsuranceEvent['type'],
    reason: string,
    effectiveDate: string | null,
  ): InsuranceMutationResult {
    const record = insuranceRecordSchema.parse({ ...content, recordHash: hash(content) });
    const event = insuranceEventSchema.parse({
      id: randomUUID(),
      scope: scopeOf(context),
      recordId: record.id,
      version: record.version,
      type,
      actorId: context.actorId,
      correlationId: context.correlationId,
      createdAt: record.updatedAt,
      effectiveDate,
      reason,
      premiumDeltaMinor: (
        BigInt(record.premiumMinor) - BigInt(previous?.premiumMinor ?? '0')
      ).toString(),
      recordHash: record.recordHash,
      previousRecordHash: previous?.recordHash ?? null,
    });
    this.store.insuranceCommit(record, event, previous?.version ?? null);
    return { record, event };
  }

  execute(name: InsuranceOperationName, raw: unknown, context: Context): unknown {
    if (!['development', 'sandbox'].includes(context.environment))
      fail(
        'RUNTIME_ENVIRONMENT_UNSUPPORTED',
        'The insurance runtime is limited to local development and sandbox',
        403,
      );
    if (name === 'insurance_record_definition') {
      const input = insuranceOperations.insurance_record_definition.input.parse(raw);
      const record = this.store.insuranceRead(context, input.recordId);
      const entry = this.policy(
        context,
        record.productId,
        record.productVersion,
        record.productPolicyHash,
        record.runtimeReleaseId,
      );
      const { insurance } = this.productDefinition(context, entry);
      return {
        recordId: record.id,
        policy: entry.policy,
        policyHash: entry.policyHash,
        runtimeReleaseId: entry.runtimeReleaseId ?? null,
        insurance: insurance ?? null,
        definitionHash: insurance ? hash(insurance) : null,
      };
    }
    if (name === 'insurance_catalog')
      return {
        policies: this.store.control.isManaged(context)
          ? (() => {
              const release = this.store.control.release(context);
              return (
                release?.runtimeDraft.policies.map((policy) => {
                  const insurance = release.configuration.configuration.products.find(
                    (product) => product.id === policy.id && product.version === policy.version,
                  )?.insurance;
                  return {
                    policy,
                    policyHash: hash(policy),
                    runtimeReleaseId: release.id,
                    ...(insurance ? { insurance, definitionHash: hash(insurance) } : {}),
                  };
                }) ?? []
              );
            })()
          : [...this.policies.values()]
              .filter((entry) => scopeKey(entry.scope) === scopeKey(context))
              .map((entry) => ({
                policyHash: entry.policyHash,
                policy: structuredClone(entry.policy),
              })),
      };
    if (name === 'insurance_evaluate_renewal')
      return this.evaluateRenewal(
        context,
        insuranceOperations.insurance_evaluate_renewal.input.parse(raw),
        this.clock(),
      ).report;
    if (name === 'insurance_evaluate_cancellation')
      return this.evaluateCancellation(
        context,
        insuranceOperations.insurance_evaluate_cancellation.input.parse(raw),
        this.clock(),
      ).preview;
    if (name === 'insurance_evaluate_service') {
      const input = insuranceOperations.insurance_evaluate_service.input.parse(raw);
      return this.evaluateService(context, input, this.clock()).preview;
    }
    if (name === 'insurance_evaluate_product') {
      const command = insuranceOperations.insurance_evaluate_product.input.parse(raw);
      const record = command.recordId
        ? this.store.insuranceRead(context, command.recordId)
        : undefined;
      return this.evaluate(
        context,
        command.productId,
        command.productVersion,
        command.submission,
        this.clock(),
        record,
      ).evaluation;
    }
    if (name === 'insurance_list') return this.store.insuranceList(context);
    if (name === 'insurance_get')
      return {
        record: this.store.insuranceRead(
          context,
          insuranceOperations.insurance_get.input.parse(raw).recordId,
        ),
      };
    if (name === 'insurance_history')
      return this.store.insuranceHistory(
        context,
        insuranceOperations.insurance_history.input.parse(raw).recordId,
      );

    const input = insuranceOperations[name].input.parse(raw);
    const requestHash = hash(input);
    const replay = this.store.insuranceReplay(context, name, input.idempotencyKey, requestHash);
    if (replay) return replay;
    const now = this.clock();
    const nowIso = now.toISOString();
    let result: InsuranceMutationResult;
    if (name === 'insurance_create_renewal_quote') {
      const command = insuranceOperations.insurance_create_renewal_quote.input.parse(input);
      const { entry, report } = this.evaluateRenewal(context, command, now);
      if (command.expectedRenewalHash !== report.renewalHash)
        fail(
          'EVALUATION_CONFLICT',
          'Renewal source, product, proposal or day changed; compare and evaluate again',
          409,
        );
      const quote = this.configuredQuote(
          command.submission,
          report.evaluation,
          command.participants,
        ),
        financials = this.validateQuote(quote, entry.policy, now);
      result = this.save(
        {
          id: randomUUID(),
          scope: scopeOf(context),
          status: 'quoted',
          sourceMode: 'configured_product',
          version: 1,
          quoteHash: hash(quote),
          productId: entry.policy.id,
          productVersion: entry.policy.version,
          productPolicyHash: entry.policyHash,
          runtimeReleaseId: entry.runtimeReleaseId!,
          quote,
          currency: entry.policy.currency,
          premiumMinor: quote.premiumMinor,
          financials,
          createdAt: nowIso,
          updatedAt: nowIso,
          lastEffectiveDate: null,
          decision: {
            submission: command.submission,
            evaluation: report.evaluation,
            evaluatedAt: nowIso,
          },
          renewal: {
            source: report.source,
            comparison: report.comparison,
            requestedAt: nowIso,
            actorId: context.actorId,
          },
        },
        context,
        null,
        'quote_created',
        'Distinct renewal quote captured from current decisions and expiring-policy comparison',
        null,
      );
    } else if (name === 'insurance_cancel_configured') {
      const command = insuranceOperations.insurance_cancel_configured.input.parse(input);
      const { record, entry, preview } = this.evaluateCancellation(context, command, now);
      if (preview.evaluationHash !== command.expectedEvaluationHash)
        fail(
          'EVALUATION_CONFLICT',
          'Cancellation inputs, date or selected revision changed; preview again',
          409,
        );
      if (preview.status !== 'allowed' || !preview.calculation)
        fail('CONFIGURED_CANCELLATION_BLOCKED', preview.reasons.join('; '));
      const financials = allocateFinancials({
        currency: record.currency,
        premiumMinor: preview.calculation.resultingPremiumMinor,
        participants: record.quote.participants,
        commission: entry.policy.commission,
      });
      const { recordHash: _, ...retained } = record;
      result = this.save(
        {
          ...retained,
          status: 'cancelled',
          version: record.version + 1,
          premiumMinor: preview.calculation.resultingPremiumMinor,
          financials,
          updatedAt: nowIso,
          lastEffectiveDate: command.effectiveDate,
          configuredCancellation: { ...preview, evaluatedAt: nowIso },
        },
        context,
        record,
        'cancellation',
        command.reason,
        command.effectiveDate,
      );
    } else if (name === 'insurance_service_configured') {
      const command = insuranceOperations.insurance_service_configured.input.parse(input);
      const { record, entry, preview } = this.evaluateService(context, command, now);
      if (preview.evaluationHash !== command.expectedEvaluationHash)
        fail(
          'EVALUATION_CONFLICT',
          'The selected revision, service inputs or date changed; preview again',
          409,
        );
      if (preview.status !== 'allowed' || !preview.calculation)
        fail('CONFIGURED_SERVICE_BLOCKED', preview.reasons.join('; '));
      const financials = allocateFinancials({
        currency: record.currency,
        premiumMinor: preview.calculation.resultingPremiumMinor,
        participants: record.quote.participants,
        commission: entry.policy.commission,
      });
      const { recordHash: _, ...retained } = record;
      result = this.save(
        {
          ...retained,
          version: record.version + 1,
          premiumMinor: preview.calculation.resultingPremiumMinor,
          financials,
          updatedAt: nowIso,
          lastEffectiveDate: command.effectiveDate,
          configuredService: { ...preview, evaluatedAt: nowIso },
        },
        context,
        record,
        'endorsement',
        command.reason,
        command.effectiveDate,
      );
    } else if (
      name === 'insurance_create_configured_quote' ||
      name === 'insurance_revise_configured_quote'
    ) {
      const revise =
        name === 'insurance_revise_configured_quote'
          ? insuranceOperations.insurance_revise_configured_quote.input.parse(input)
          : null;
      const create =
        name === 'insurance_create_configured_quote'
          ? insuranceOperations.insurance_create_configured_quote.input.parse(input)
          : null;
      const current = revise
        ? this.current(context, revise.recordId, revise.expectedVersion, revise.recordHash)
        : null;
      if (current?.renewal && revise!.submission.term.startDate !== current.quote.term.startDate)
        fail(
          'RENEWAL_TERM_IDENTITY',
          'Retain the renewal start date when revising; a different term requires a separate proposal',
        );
      if (current && current.status !== 'quoted')
        fail('INVALID_TRANSITION', 'Only an unbound configured quote may be revised', 409);
      const command = revise ?? create!;
      if (
        current &&
        (command.submission.reference !== current.quote.sourceQuote.reference ||
          this.store
            .insuranceHistory(context, current.id)
            .revisions.some(
              (revision) => revision.quote.sourceQuote.version === command.submission.version,
            ))
      )
        fail(
          'SOURCE_VERSION_REQUIRED',
          'Retain the source reference and use a source version never used by this record',
        );
      const { entry, evaluation } = this.evaluate(
        context,
        current?.productId ?? create!.productId,
        current?.productVersion ?? create!.productVersion,
        command.submission,
        now,
        current ?? undefined,
      );
      if (evaluation.evaluationHash !== command.expectedEvaluationHash)
        fail(
          'EVALUATION_CONFLICT',
          'The product, inputs or decision changed; evaluate again before capturing a quote',
          409,
        );
      const quote = this.configuredQuote(command.submission, evaluation, command.participants);
      const financials = this.validateQuote(quote, entry.policy, now);
      result = this.save(
        {
          id: current?.id ?? randomUUID(),
          scope: scopeOf(context),
          status: 'quoted',
          sourceMode: 'configured_product',
          version: (current?.version ?? 0) + 1,
          quoteHash: hash(quote),
          productId: entry.policy.id,
          productVersion: entry.policy.version,
          productPolicyHash: entry.policyHash,
          runtimeReleaseId: entry.runtimeReleaseId!,
          quote,
          currency: entry.policy.currency,
          premiumMinor: quote.premiumMinor,
          financials,
          createdAt: current?.createdAt ?? nowIso,
          updatedAt: nowIso,
          lastEffectiveDate: null,
          decision: { submission: command.submission, evaluation, evaluatedAt: nowIso },
          ...(current?.renewal
            ? {
                renewal: {
                  ...current.renewal,
                  comparison: compareRenewalSubmissions(
                    this.renewalSource(
                      context,
                      {
                        sourceRecordId: current.renewal.source.recordId,
                        sourceVersion: current.renewal.source.version,
                        sourceRecordHash: current.renewal.source.recordHash,
                      },
                      command.submission,
                      current.productId,
                    ).effective,
                    command.submission,
                  ),
                },
              }
            : {}),
        },
        context,
        current,
        current ? 'quote_revised' : 'quote_created',
        'Configured insurance quote captured from server-derived pinned decisions',
        null,
      );
    } else if (name === 'insurance_create_quote') {
      const command = insuranceOperations.insurance_create_quote.input.parse(input);
      const entry = this.policy(context, command.productId, command.productVersion);
      if (this.productDefinition(context, entry).insurance)
        fail(
          'CONFIGURED_EVALUATION_REQUIRED',
          'This product requires server-derived insurance evaluation; use configured quote capture',
        );
      const financials = this.validateQuote(command.quote, entry.policy, now);
      result = this.save(
        {
          id: randomUUID(),
          scope: scopeOf(context),
          status: 'quoted',
          sourceMode: 'manual_external_quote',
          version: 1,
          quoteHash: hash(command.quote),
          productId: entry.policy.id,
          productVersion: entry.policy.version,
          productPolicyHash: entry.policyHash,
          ...(entry.runtimeReleaseId ? { runtimeReleaseId: entry.runtimeReleaseId } : {}),
          quote: command.quote,
          currency: entry.policy.currency,
          premiumMinor: command.quote.premiumMinor,
          financials,
          createdAt: nowIso,
          updatedAt: nowIso,
          lastEffectiveDate: null,
        },
        context,
        null,
        'quote_created',
        'External quote captured manually; provider verification is not implied',
        null,
      );
    } else if (name === 'insurance_revise_quote') {
      const command = insuranceOperations.insurance_revise_quote.input.parse(input);
      const current = this.current(
        context,
        command.recordId,
        command.expectedVersion,
        command.recordHash,
      );
      if (current.status !== 'quoted')
        fail('INVALID_TRANSITION', 'Only an unbound quote may be revised', 409);
      if (current.sourceMode === 'configured_product')
        fail(
          'CONFIGURED_EVALUATION_REQUIRED',
          'Re-evaluate this configured quote through its dedicated revision operation',
        );
      const entry = this.policy(
        context,
        current.productId,
        current.productVersion,
        current.productPolicyHash,
        current.runtimeReleaseId,
      );
      if (
        command.quote.sourceQuote.reference !== current.quote.sourceQuote.reference ||
        this.store
          .insuranceHistory(context, current.id)
          .revisions.some(
            (revision) => revision.quote.sourceQuote.version === command.quote.sourceQuote.version,
          )
      )
        fail(
          'SOURCE_VERSION_REQUIRED',
          'A revision must retain the external quote reference and record a source version never used by this record',
        );
      const financials = this.validateQuote(command.quote, entry.policy, now);
      const { recordHash: _, ...base } = current;
      result = this.save(
        {
          ...base,
          version: current.version + 1,
          quote: command.quote,
          quoteHash: hash(command.quote),
          premiumMinor: command.quote.premiumMinor,
          financials,
          updatedAt: nowIso,
        },
        context,
        current,
        'quote_revised',
        'A new external quote source version was captured manually',
        null,
      );
    } else if (name === 'insurance_bind') {
      const command = insuranceOperations.insurance_bind.input.parse(input);
      const current = this.current(
        context,
        command.recordId,
        command.expectedVersion,
        command.quoteHash,
        true,
      );
      if (current.status !== 'quoted')
        fail('INVALID_TRANSITION', 'This insurance record is already bound or cancelled', 409);
      if (current.renewal) {
        if (!current.decision)
          fail('INTEGRITY_ERROR', 'Renewal is missing current decision evidence', 500);
        this.renewalSource(
          context,
          {
            sourceRecordId: current.renewal.source.recordId,
            sourceVersion: current.renewal.source.version,
            sourceRecordHash: current.renewal.source.recordHash,
          },
          current.decision.submission,
          current.productId,
        );
      }
      const entry = this.policy(
        context,
        current.productId,
        current.productVersion,
        current.productPolicyHash,
        current.runtimeReleaseId,
      );
      this.validateQuote(current.quote, entry.policy, now);
      const approval = command.approvalId
        ? validateBindApproval(
            this.store,
            context,
            current,
            this.assessApproval(context, current, now),
            command.approvalId,
            now,
          )
        : undefined;
      if (current.quote.eligibility !== 'quote_ready' && !approval)
        fail('QUOTE_NOT_READY', 'A referred or declined quote cannot be bound');
      if (!approval) this.checkPrerequisites(entry.policy);
      let bindDecision: InsuranceRecord['decision'];
      if (current.sourceMode === 'configured_product') {
        if (!current.decision)
          fail('INTEGRITY_ERROR', 'Configured quote has no pinned decision evidence', 500);
        const original = this.evaluate(
          context,
          current.productId,
          current.productVersion,
          current.decision.submission,
          new Date(current.decision.evaluatedAt),
          current,
        ).evaluation;
        if (
          hash(original) !== hash(current.decision.evaluation) ||
          hash(
            this.configuredQuote(current.decision.submission, original, current.quote.participants),
          ) !== current.quoteHash
        )
          fail(
            'INTEGRITY_ERROR',
            'Configured quote differs from its server-derived decision evidence',
            500,
          );
        const refreshed = this.evaluate(
          context,
          current.productId,
          current.productVersion,
          current.decision.submission,
          now,
          current,
        ).evaluation;
        if (refreshed.bind.status !== 'allowed' && !approval)
          fail('BIND_DECISION_BLOCKED', refreshed.bind.reasons.join(' '));
        bindDecision = {
          ...current.decision,
          bindEvaluation: { evaluation: refreshed, evaluatedAt: nowIso },
        };
      }
      const { recordHash: _, ...base } = current;
      result = this.save(
        {
          ...base,
          status: 'bound',
          version: current.version + 1,
          updatedAt: nowIso,
          lastEffectiveDate: current.quote.term.startDate,
          ...(bindDecision ? { decision: bindDecision } : {}),
          ...(approval ? { approval } : {}),
        },
        context,
        current,
        'bound',
        approval
          ? 'Exact stored quote bound after independently authorized review of supported gates'
          : 'Exact stored quote bound in the local runtime',
        current.quote.term.startDate,
      );
    } else {
      const command = insuranceOperations.insurance_service.input.parse(input);
      const current = this.current(
        context,
        command.recordId,
        command.expectedVersion,
        command.recordHash,
      );
      if (current.sourceMode === 'configured_product')
        fail(
          'CONFIGURED_SERVICING_UNSUPPORTED',
          'Configured-product servicing requires risk and coverage re-evaluation; manual financial overrides are unavailable',
        );
      const entry = this.policy(
        context,
        current.productId,
        current.productVersion,
        current.productPolicyHash,
        current.runtimeReleaseId,
      );
      this.checkPrerequisites(entry.policy);
      const today = nowIso.slice(0, 10);
      if (
        command.effectiveDate < current.quote.term.startDate ||
        command.effectiveDate > current.quote.term.endDate ||
        command.effectiveDate > today ||
        (current.lastEffectiveDate && command.effectiveDate < current.lastEffectiveDate)
      )
        fail(
          'INVALID_EFFECTIVE_DATE',
          'Manual servicing must take effect within the term, no earlier than the previous event and no later than today; scheduled servicing is not implemented',
        );
      if (
        command.action === 'reinstatement'
          ? current.status !== 'cancelled'
          : current.status !== 'bound'
      )
        fail(
          'INVALID_TRANSITION',
          'This service action is not allowed in the current insurance state',
          409,
        );
      const delta = BigInt(command.premiumDeltaMinor);
      if (
        (command.action === 'cancellation' && delta > 0n) ||
        (command.action === 'reinstatement' && delta < 0n)
      )
        fail(
          'INVALID_FINANCIAL_DELTA',
          'Cancellation cannot add premium and reinstatement cannot refund premium',
        );
      const total = BigInt(current.premiumMinor) + delta;
      if (
        total < 0n ||
        total > BigInt(entry.policy.maximumPremiumMinor) ||
        (command.action === 'reinstatement' && total === 0n)
      )
        fail(
          'INVALID_FINANCIAL_DELTA',
          'The manual delta would produce an invalid or out-of-limit premium total',
        );
      const premiumMinor = minorUnitSchema.parse(total.toString());
      const financials = allocateFinancials({
        currency: current.currency,
        premiumMinor,
        participants: current.quote.participants,
        commission: entry.policy.commission,
      });
      const { recordHash: _, ...base } = current;
      result = this.save(
        {
          ...base,
          status: command.action === 'cancellation' ? 'cancelled' : 'bound',
          version: current.version + 1,
          premiumMinor,
          financials,
          updatedAt: nowIso,
          lastEffectiveDate: command.effectiveDate,
        },
        context,
        current,
        command.action,
        command.reason,
        command.effectiveDate,
      );
    }
    this.store.insuranceRemember(context, name, input.idempotencyKey, requestHash, result);
    return result;
  }
}

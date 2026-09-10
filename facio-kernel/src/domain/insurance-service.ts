import type { InsuranceRecord, RuntimePolicy } from '../contracts/insurance.js';
import type {
  InsuranceProductDefinitionV2,
  ConfiguredSubmissionV2,
} from '../contracts/insurance-definition.js';
import {
  configuredSubmissionV2Schema,
  insuranceEvaluationV2Schema,
} from '../contracts/insurance-definition.js';
import {
  configuredServiceEvaluationSchema,
  type ConfiguredServiceInput,
  type ConfiguredServiceEvaluation,
} from '../contracts/insurance-service.js';
import { minorUnitSchema } from '../contracts/money.js';
import { hash, KernelError } from './canonical.js';
import { evaluateInsuranceProductV2, termDays } from './insurance-decision-v2.js';
import { round } from './insurance-decision-v1.js';

export function effectiveConfiguredSubmission(record: InsuranceRecord) {
  return record.configuredService?.submission ?? record.decision?.submission;
}
const riskHash = (s: ConfiguredSubmissionV2) =>
  hash({
    answers: s.answers,
    riskGroups: s.riskGroups,
    coverages: s.coverages,
    territory: s.territory,
  });
export function evaluateConfiguredService(
  context: {
    record: InsuranceRecord;
    definition: InsuranceProductDefinitionV2;
    policy: RuntimePolicy;
    releaseHash: string;
    now: Date;
  },
  input: ConfiguredServiceInput,
): ConfiguredServiceEvaluation {
  const { record, definition, policy, now } = context;
  const previous = configuredSubmissionV2Schema.safeParse(effectiveConfiguredSubmission(record));
  const previousEvaluation = insuranceEvaluationV2Schema.safeParse(
    record.configuredService?.evaluation ?? record.decision?.evaluation,
  );
  if (!previous.success || !previousEvaluation.success || !record.runtimeReleaseId)
    throw new KernelError(
      'SERVICE_VERSION_UNSUPPORTED',
      'Configured servicing requires a retained v2 product, submission and decision',
      422,
    );
  const old = previous.data,
    s = input.submission,
    today = now.toISOString().slice(0, 10),
    reasons: string[] = [];
  const evaluation = evaluateInsuranceProductV2(
    {
      productId: record.productId,
      productVersion: record.productVersion,
      definition,
      policy,
      policyHash: record.productPolicyHash,
      runtimeReleaseId: record.runtimeReleaseId,
      releaseHash: context.releaseHash,
      now,
      purpose: 'service',
      serviceEffectiveDate: input.effectiveDate,
    },
    s,
  );
  if (record.status !== 'bound') reasons.push('Only a bound configured policy may be serviced');
  if (
    record.recordHash !== input.recordHash ||
    record.version !== input.expectedVersion ||
    record.id !== input.recordId
  )
    reasons.push('Selected policy revision changed');
  if (
    input.effectiveDate < today ||
    input.effectiveDate < old.term.startDate ||
    input.effectiveDate > old.term.endDate
  )
    reasons.push('Effective date must be current/future and within the existing unexpired term');
  if (record.lastEffectiveDate && input.effectiveDate < record.lastEffectiveDate)
    reasons.push('A service transaction cannot precede the latest retained effective date');
  if (s.term.startDate !== old.term.startDate || s.term.endDate < old.term.endDate)
    reasons.push(
      'Retain inception; term shortening and cancellation require separate configured return rules',
    );
  if (s.reference !== old.reference || s.version === old.version)
    reasons.push('Retain source reference and use a new proposal version');
  if (s.territory !== old.territory)
    reasons.push('Territory changes require a separately supported service contract');
  const riskChanged = riskHash(s) !== riskHash(old),
    termChanged = hash(s.term) !== hash(old.term);
  if (!riskChanged && !termChanged)
    reasons.push('Change risk, coverage or term before recording a service transaction');
  if (evaluation.bind.status !== 'allowed') reasons.push(...evaluation.bind.reasons);
  if (Object.values(policy.requirements).some((v) => v !== 'not_required'))
    reasons.push(
      'A new service transaction requires its own supported approval/payment/provider workflow; prior bind evidence does not authorize service',
    );
  let calculation: ConfiguredServiceEvaluation['calculation'] = null;
  if (definition.servicing.mode === 'disabled')
    reasons.push('This retained product has no configured servicing authority');
  else {
    const rules = definition.servicing;
    if (riskChanged && !rules.allowRiskChanges)
      reasons.push('Risk and coverage changes are disabled by this retained product');
    if (termChanged && !rules.allowTermExtension)
      reasons.push('Term extension is disabled by this retained product');
    if (rules.calculation === 'actual_days_pro_rata' && termChanged)
      reasons.push('Whole-term actual-days pricing supports an unchanged term only');
    if (evaluation.rating.minimumApplied || previousEvaluation.data.rating.minimumApplied)
      reasons.push(
        'A minimum premium was applied; supported return/minimum handling is required before servicing',
      );
    if (
      evaluation.rating.status === 'calculated' &&
      previousEvaluation.data.rating.status === 'calculated' &&
      s.term.startDate <= s.term.endDate
    ) {
      const oldTermDays = termDays(old.term.startDate, old.term.endDate),
        newTermDays = termDays(s.term.startDate, s.term.endDate);
      const oldRemainingDays = Math.max(0, termDays(input.effectiveDate, old.term.endDate)),
        newRemainingDays = Math.max(0, termDays(input.effectiveDate, s.term.endDate));
      const oldRate = previousEvaluation.data.rating,
        newRate = evaluation.rating;
      let removed: bigint | null = null,
        added: bigint | null = null;
      if (
        rules.calculation === 'per_day_remaining' &&
        oldRate.dailyPremiumMinor !== null &&
        newRate.dailyPremiumMinor !== null
      ) {
        removed = BigInt(oldRate.dailyPremiumMinor) * BigInt(oldRemainingDays);
        added = BigInt(newRate.dailyPremiumMinor) * BigInt(newRemainingDays);
      }
      if (
        rules.calculation === 'actual_days_pro_rata' &&
        oldRate.premiumMinor !== null &&
        newRate.premiumMinor !== null
      ) {
        removed = round(
          BigInt(oldRate.premiumMinor) * BigInt(oldRemainingDays),
          BigInt(oldTermDays),
        );
        added = round(BigInt(newRate.premiumMinor) * BigInt(newRemainingDays), BigInt(newTermDays));
      }
      if (removed !== null && added !== null) {
        const delta = added - removed,
          total = BigInt(record.premiumMinor) + delta;
        if (
          [removed, added, delta, total].some(
            (n) => !minorUnitSchema.safeParse(n.toString()).success,
          )
        )
          reasons.push('Service calculation exceeds exact money bounds');
        else {
          calculation = {
            method: rules.calculation,
            rounding: 'half-away-from-zero',
            oldTermDays,
            newTermDays,
            oldRemainingDays,
            newRemainingDays,
            removedPremiumMinor: removed.toString(),
            addedPremiumMinor: added.toString(),
            premiumDeltaMinor: delta.toString(),
            resultingPremiumMinor: total.toString(),
          };
          if (total < 0n || total < BigInt(definition.rating.minimumPremiumMinor))
            reasons.push('Resulting contract premium is negative or below its retained minimum');
          if (
            total > BigInt(policy.maximumPremiumMinor) ||
            total > BigInt(definition.authority.maximumPremiumMinor)
          )
            reasons.push('Resulting cumulative premium exceeds retained authority');
        }
      } else
        reasons.push(
          'The retained rating evidence cannot support this declared service calculation',
        );
    }
  }
  const content = {
    schemaVersion: 'insurance-service-v1' as const,
    recordId: record.id,
    priorVersion: record.version,
    priorRecordHash: record.recordHash,
    priorSubmissionHash: hash(old),
    submission: s,
    evaluation,
    effectiveDate: input.effectiveDate,
    reason: input.reason,
    evidenceRefs: input.evidenceRefs,
    status: reasons.length ? ('blocked' as const) : ('allowed' as const),
    reasons: [...new Set(reasons)],
    calculation,
  };
  return configuredServiceEvaluationSchema.parse({ ...content, evaluationHash: hash(content) });
}

import {
  configuredCancellationEvaluationSchema,
  type ConfiguredCancellationInput,
  type ConfiguredCancellationEvaluation,
} from '../contracts/insurance-service.js';
export function evaluateConfiguredCancellation(
  context: {
    record: InsuranceRecord;
    definition: InsuranceProductDefinitionV2;
    policy: RuntimePolicy;
    releaseHash: string;
    now: Date;
  },
  input: ConfiguredCancellationInput,
): ConfiguredCancellationEvaluation {
  const { record, definition, policy, now } = context,
    submission = configuredSubmissionV2Schema.safeParse(effectiveConfiguredSubmission(record)),
    prior = insuranceEvaluationV2Schema.safeParse(
      record.configuredService?.evaluation ?? record.decision?.evaluation,
    );
  if (!submission.success || !prior.success)
    throw new KernelError(
      'CANCELLATION_VERSION_UNSUPPORTED',
      'Configured return premium requires retained v2 exposure and pricing evidence',
      422,
    );
  const s = submission.data,
    today = now.toISOString().slice(0, 10),
    reasons: string[] = [],
    rules = definition.cancellation;
  if (record.status !== 'bound')
    reasons.push('Only a bound policy can enter the configured cancellation branch');
  if (
    record.recordHash !== input.recordHash ||
    record.version !== input.expectedVersion ||
    record.id !== input.recordId
  )
    reasons.push('Selected policy revision changed');
  if (
    input.effectiveDate < today ||
    Date.parse(input.effectiveDate) > Date.parse(s.term.endDate) + 86400000
  )
    reasons.push(
      'Cancellation must be current/future and no later than the day following the existing term',
    );
  if (record.lastEffectiveDate && input.effectiveDate < record.lastEffectiveDate)
    reasons.push('Cancellation cannot precede the latest retained service effective date');
  if (!rules) reasons.push('The retained product declares no supported cancellation return rule');
  if (prior.data.rating.minimumApplied)
    reasons.push('An applied minimum premium requires separately supported cancellation handling');
  if (Object.values(policy.requirements).some((value) => value !== 'not_required'))
    reasons.push(
      'This cancellation needs a separately supported approval/payment/provider workflow',
    );
  let calculation: ConfiguredCancellationEvaluation['calculation'] = null;
  if (rules && prior.data.rating.status === 'calculated') {
    const days = termDays(s.term.startDate, s.term.endDate),
      remainingDays = Math.max(0, Math.min(days, termDays(input.effectiveDate, s.term.endDate)));
    let returned: bigint | null = null;
    if (rules.calculation === 'per_day_remaining' && prior.data.rating.dailyPremiumMinor !== null)
      returned = BigInt(prior.data.rating.dailyPremiumMinor) * BigInt(remainingDays);
    if (
      rules.calculation === 'actual_days_pro_rata' &&
      prior.data.rating.termBasis === 'whole_term' &&
      prior.data.rating.premiumMinor !== null
    )
      returned = round(
        BigInt(prior.data.rating.premiumMinor) * BigInt(remainingDays),
        BigInt(days),
      );
    if (returned === null)
      reasons.push('Retained pricing cannot support the declared cancellation basis');
    else {
      const total = BigInt(record.premiumMinor) - returned;
      if (
        total < 0n ||
        [total, returned].some((value) => !minorUnitSchema.safeParse(value.toString()).success)
      )
        reasons.push(
          'Return premium exceeds the retained cumulative premium or exact money bounds',
        );
      else
        calculation = {
          method: rules.calculation,
          rounding: 'half-away-from-zero',
          termDays: days,
          remainingDays,
          returnPremiumMinor: returned.toString(),
          premiumDeltaMinor: (-returned).toString(),
          resultingPremiumMinor: total.toString(),
        };
    }
  }
  const content = {
    schemaVersion: 'insurance-cancellation-v1' as const,
    recordId: record.id,
    priorVersion: record.version,
    priorRecordHash: record.recordHash,
    priorSubmissionHash: hash(s),
    definitionHash: hash(definition),
    releaseHash: context.releaseHash,
    evaluatedOn: today,
    effectiveDate: input.effectiveDate,
    reason: input.reason,
    evidenceRefs: input.evidenceRefs,
    status: reasons.length ? ('blocked' as const) : ('allowed' as const),
    reasons: [...new Set(reasons)],
    calculation,
    refundStatus: 'not_requested' as const,
    noticeStatus: 'not_issued' as const,
  };
  return configuredCancellationEvaluationSchema.parse({
    ...content,
    evaluationHash: hash(content),
  });
}

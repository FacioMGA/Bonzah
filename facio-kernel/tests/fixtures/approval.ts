import { randomUUID } from 'node:crypto';
import { Kernel } from '../../src/application/kernel.js';
import { Store } from '../../src/storage/store.js';
import {
  tenantRecordSchema,
  tenantSetupSchema,
  type Principal,
} from '../../src/contracts/control-plane.js';
import { snapshotSchema } from '../../src/contracts/configuration.js';
import {
  insuranceEvaluationSchema,
  type InsuranceProductDefinition,
  type ConfiguredSubmission,
} from '../../src/contracts/insurance-definition.js';
import {
  insuranceMutationResultSchema,
  type RuntimePolicy,
  type InsuranceRecord,
} from '../../src/contracts/insurance.js';
import { approvalResultSchema, type ApprovalRecord } from '../../src/contracts/approval.js';
import {
  configuredProductConfiguration,
  configuredRuntimePolicy,
  syntheticConfiguredSubmission,
  syntheticInsuranceDefinition,
} from './insurance-definition.js';
import { syntheticRequirementsProfile } from './requirements.js';
import { externalQuote } from './insurance.js';

const principal = (actorId: string): Principal => ({
  actorId,
  issuer: 'https://review-fixture.test',
  subject: actorId,
  correlationId: randomUUID(),
});
export const approvalBuilder = principal('approval-builder');
export const approvalReviewer = principal('approval-reviewer');
export const approvalOtherReviewer = principal('second-reviewer');
export const approvalOutsider = principal('review-outsider');
export const reviewEvidence = ['fixture://synthetic-human-review'];
/** Fictional conformance only; this does not seed any hosted tenant. */
export function approvalFixture(
  path = ':memory:',
  definition: InsuranceProductDefinition = structuredClone(syntheticInsuranceDefinition),
  policy: RuntimePolicy = structuredClone(configuredRuntimePolicy),
) {
  let now = new Date('2026-09-10T12:00:00.000Z');
  const store = new Store(path);
  const kernel = new Kernel(store, [], [], () => new Date(now), {
    region: 'test',
    buildSha: 'a'.repeat(40),
  });
  kernel.control.bootstrapAccount({
    accountId: 'review-account',
    workspaceId: 'review-workspace',
    displayName: 'Synthetic independent review',
    members: [
      { ...approvalBuilder, role: 'builder' },
      { ...approvalReviewer, role: 'admin' },
      { ...approvalOtherReviewer, role: 'admin' },
    ],
  });
  const tenant = tenantRecordSchema.parse(
    (
      kernel.control.execute(
        'control_create_tenant',
        {
          accountId: 'review-account',
          displayName: 'Synthetic review tenant',
          environment: 'sandbox',
          region: 'test',
          idempotencyKey: randomUUID(),
        },
        approvalBuilder,
      ) as { tenant: unknown }
    ).tenant,
  );
  const context = kernel.control.resolveContext(approvalBuilder, tenant.id);
  const execute = (
    name: Parameters<Kernel['execute']>[0],
    input: unknown,
    actor = approvalBuilder,
  ) => kernel.executeForPrincipal(name, input, actor, tenant.id);
  const configure = (nextDefinition = definition) => {
    const draft = snapshotSchema.parse(execute('configuration_inspect', { view: 'draft' }));
    execute('configuration_update_draft', {
      expectedVersion: draft.version,
      configuration: configuredProductConfiguration(context, nextDefinition),
      idempotencyKey: randomUUID(),
    });
  };
  configure();
  kernel.control.execute(
    'control_attach_requirements',
    { expectedVersion: 0, profile: syntheticRequirementsProfile, idempotencyKey: randomUUID() },
    approvalBuilder,
    tenant.id,
  );
  kernel.control.execute(
    'control_update_runtime_draft',
    { expectedVersion: 1, policies: [policy], idempotencyKey: randomUUID() },
    approvalBuilder,
    tenant.id,
  );
  const activate = () => {
    const setup = tenantSetupSchema.parse(
      kernel.control.execute('control_setup', {}, approvalBuilder, tenant.id),
    );
    if (!setup.candidate.canActivate) throw new Error(setup.candidate.blockers.join(' '));
    const { canActivate: _, blockers: __, ...candidate } = setup.candidate;
    return tenantSetupSchema.parse(
      kernel.control.execute(
        'control_activate',
        { ...candidate, idempotencyKey: randomUUID() },
        approvalBuilder,
        tenant.id,
      ),
    ).activeRelease!;
  };
  const release = activate();
  const submission: ConfiguredSubmission = {
    ...structuredClone(syntheticConfiguredSubmission),
    term: { startDate: '2026-09-12', endDate: '2026-09-30' },
    answers: { ...syntheticConfiguredSubmission.answers, age: 18 },
  };
  const evaluate = (value = submission, recordId?: string) =>
    insuranceEvaluationSchema.parse(
      execute('insurance_evaluate_product', {
        productId: policy.id,
        productVersion: policy.version,
        submission: value,
        ...(recordId ? { recordId } : {}),
      }),
    );
  const create = (value = submission, actor = approvalBuilder) =>
    insuranceMutationResultSchema.parse(
      execute(
        'insurance_create_configured_quote',
        {
          productId: policy.id,
          productVersion: policy.version,
          submission: value,
          participants: externalQuote.participants,
          expectedEvaluationHash: evaluate(value).evaluationHash,
          idempotencyKey: randomUUID(),
        },
        actor,
      ),
    ).record;
  const requestInput = (record: InsuranceRecord) => ({
    idempotencyKey: randomUUID(),
    recordId: record.id,
    expectedVersion: record.version,
    recordHash: record.recordHash,
    reason: 'Review the synthetic referral against retained evidence',
    evidenceRefs: reviewEvidence,
    expiresAt: '2026-09-12T12:00:00.000Z',
  });
  const request = (record: InsuranceRecord, actor = approvalBuilder) =>
    approvalResultSchema.parse(execute('approval_request', requestInput(record), actor));
  const decisionInput = (
    approval: ApprovalRecord,
    decision: 'approve' | 'decline' = 'approve',
  ) => ({
    idempotencyKey: randomUUID(),
    approvalId: approval.id,
    expectedVersion: approval.version,
    approvalHash: approval.approvalHash,
    decision,
    reason: 'Independent synthetic review rationale',
    evidenceRefs: reviewEvidence,
  });
  const decide = (
    approval: ApprovalRecord,
    decision: 'approve' | 'decline' = 'approve',
    actor = approvalReviewer,
  ) =>
    approvalResultSchema.parse(
      execute('approval_decide', decisionInput(approval, decision), actor),
    );
  const bind = (record: InsuranceRecord, approvalId?: string) =>
    insuranceMutationResultSchema.parse(
      execute('insurance_bind', {
        idempotencyKey: randomUUID(),
        recordId: record.id,
        expectedVersion: record.version,
        quoteHash: record.quoteHash,
        ...(approvalId ? { approvalId } : {}),
      }),
    ).record;
  return {
    store,
    kernel,
    tenant,
    context,
    execute,
    configure,
    activate,
    release,
    submission,
    evaluate,
    create,
    request,
    requestInput,
    decisionInput,
    decide,
    bind,
    setNow: (value: string) => {
      now = new Date(value);
    },
  };
}

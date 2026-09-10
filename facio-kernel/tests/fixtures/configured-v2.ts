import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Kernel } from '../../src/application/kernel.js';
import { Store } from '../../src/storage/store.js';
import {
  tenantRecordSchema,
  tenantSetupSchema,
  type Principal,
} from '../../src/contracts/control-plane.js';
import {
  insuranceMutationResultSchema,
  type InsuranceRecord,
} from '../../src/contracts/insurance.js';
import {
  insuranceEvaluationSchema,
  type InsuranceProductDefinition,
} from '../../src/contracts/insurance-definition.js';
import { snapshotSchema } from '../../src/contracts/configuration.js';
import { configuredProductConfiguration, configuredRuntimePolicy } from './insurance-definition.js';
import { multiRiskDefinition, multiRiskSubmission } from './insurance-v2.js';
import { syntheticRequirementsProfile } from './requirements.js';
import { externalQuote, testNow } from './insurance.js';
export const configuredV2Principal: Principal = {
  actorId: 'builder',
  issuer: 'https://identity.test',
  subject: 'builder-subject',
  correlationId: randomUUID(),
};
const principal = configuredV2Principal;
export function setupConfiguredV2(path = ':memory:', now: () => Date = testNow) {
  const store = new Store(path);
  const kernel = new Kernel(store, [], [], now, { region: 'test', buildSha: 'a'.repeat(40) });
  kernel.control.bootstrapAccount({
    accountId: 'account',
    workspaceId: 'workspace',
    displayName: 'Synthetic account',
    members: [{ ...principal, role: 'owner' }],
  });
  const tenant = tenantRecordSchema.parse(
    (
      kernel.control.execute(
        'control_create_tenant',
        {
          accountId: 'account',
          displayName: 'Decision sandbox',
          environment: 'sandbox',
          region: 'test',
          idempotencyKey: randomUUID(),
        },
        principal,
      ) as { tenant: unknown }
    ).tenant,
  );
  const context = kernel.control.resolveContext(principal, tenant.id);
  const execute = (name: Parameters<Kernel['execute']>[0], input: unknown) =>
    kernel.executeForPrincipal(name, input, principal, tenant.id);
  const inspect = () =>
    tenantSetupSchema.parse(kernel.control.execute('control_setup', {}, principal, tenant.id));
  const activate = () => {
    const { canActivate, blockers, ...candidate } = inspect().candidate;
    assert.equal(canActivate, true, blockers.join('\n'));
    return tenantSetupSchema.parse(
      kernel.control.execute(
        'control_activate',
        { ...candidate, idempotencyKey: randomUUID() },
        principal,
        tenant.id,
      ),
    ).activeRelease!;
  };
  const update = (
    definition: InsuranceProductDefinition = structuredClone(multiRiskDefinition),
  ) => {
    const draft = snapshotSchema.parse(execute('configuration_inspect', { view: 'draft' }));
    execute('configuration_update_draft', {
      expectedVersion: draft.version,
      configuration: (() => {
        const configuration = configuredProductConfiguration(context, definition);
        return configuration;
      })(),
      idempotencyKey: randomUUID(),
    });
  };
  update();
  kernel.control.execute(
    'control_attach_requirements',
    { expectedVersion: 0, profile: syntheticRequirementsProfile, idempotencyKey: randomUUID() },
    principal,
    tenant.id,
  );
  kernel.control.execute(
    'control_update_runtime_draft',
    { expectedVersion: 1, policies: [configuredRuntimePolicy], idempotencyKey: randomUUID() },
    principal,
    tenant.id,
  );
  const release = activate();
  const evaluate = (submission = structuredClone(multiRiskSubmission), recordId?: string) =>
    insuranceEvaluationSchema.parse(
      execute('insurance_evaluate_product', {
        productId: configuredRuntimePolicy.id,
        productVersion: configuredRuntimePolicy.version,
        submission,
        ...(recordId ? { recordId } : {}),
      }),
    );
  const create = (submission = structuredClone(multiRiskSubmission)) =>
    insuranceMutationResultSchema.parse(
      execute('insurance_create_configured_quote', {
        productId: configuredRuntimePolicy.id,
        productVersion: configuredRuntimePolicy.version,
        submission,
        participants: externalQuote.participants,
        expectedEvaluationHash: evaluate(submission).evaluationHash,
        idempotencyKey: randomUUID(),
      }),
    ).record;
  const bind = (record: InsuranceRecord) =>
    insuranceMutationResultSchema.parse(
      execute('insurance_bind', {
        recordId: record.id,
        expectedVersion: record.version,
        quoteHash: record.quoteHash,
        idempotencyKey: randomUUID(),
      }),
    ).record;
  return {
    store,
    kernel,
    tenant,
    context,
    execute,
    inspect,
    activate,
    update,
    evaluate,
    create,
    bind,
    release,
  };
}

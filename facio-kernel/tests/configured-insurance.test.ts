import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Kernel } from '../src/application/kernel.js';
import { Store } from '../src/storage/store.js';
import { buildApp } from '../src/server/app.js';
import { hash, KernelError } from '../src/domain/canonical.js';
import {
  tenantRecordSchema,
  tenantSetupSchema,
  type Principal,
} from '../src/contracts/control-plane.js';
import {
  insuranceMutationResultSchema,
  insuranceOperations,
  type InsuranceRecord,
} from '../src/contracts/insurance.js';
import {
  insuranceEvaluationSchema,
  type ConfiguredSubmission,
} from '../src/contracts/insurance-definition.js';
import { referenceConfiguration } from '../src/fixtures/reference.js';
import { snapshotSchema } from '../src/contracts/configuration.js';
import {
  configuredProductConfiguration,
  configuredRuntimePolicy,
  syntheticConfiguredSubmission,
  syntheticInsuranceDefinition,
} from './fixtures/insurance-definition.js';
import { syntheticRequirementsProfile } from './fixtures/requirements.js';
import { externalQuote, testNow } from './fixtures/insurance.js';

const principal: Principal = {
  actorId: 'builder',
  issuer: 'https://identity.test',
  subject: 'builder-subject',
  correlationId: randomUUID(),
};
const fail = (code: string) => (error: unknown) =>
  error instanceof KernelError && error.code === code;
function setup(path = ':memory:', manual = false) {
  const store = new Store(path);
  const kernel = new Kernel(store, [], [], testNow, { region: 'test', buildSha: 'a'.repeat(40) });
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
  const update = (definition = structuredClone(syntheticInsuranceDefinition)) => {
    const draft = snapshotSchema.parse(execute('configuration_inspect', { view: 'draft' }));
    execute('configuration_update_draft', {
      expectedVersion: draft.version,
      configuration: (() => {
        const configuration = configuredProductConfiguration(context, definition);
        if (manual) {
          delete configuration.products[0]!.insurance;
          configuration.products[0]!.requiredCapabilities = [
            'manual_external_quote',
            'exact_money',
          ];
          configuration.products[0]!.fields = structuredClone(
            referenceConfiguration.products[0]!.fields,
          );
        }
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
  manual = false;
  const evaluate = (
    submission = structuredClone(syntheticConfiguredSubmission),
    recordId?: string,
  ) =>
    insuranceEvaluationSchema.parse(
      execute('insurance_evaluate_product', {
        productId: configuredRuntimePolicy.id,
        productVersion: configuredRuntimePolicy.version,
        submission,
        ...(recordId ? { recordId } : {}),
      }),
    );
  const create = (submission = structuredClone(syntheticConfiguredSubmission)) =>
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

test('configured quote derives price and bind evidence; preview is read only and legacy writes cannot bypass decisions', () => {
  const fixture = setup();
  const { store, context, execute, evaluate, create, bind } = fixture;
  try {
    const before = store.insuranceOutbox(context).length;
    const report = evaluate();
    assert.equal(store.insuranceOutbox(context).length, before);
    assert.equal(report.rating.premiumMinor, '10152');
    assert.throws(
      () =>
        execute('insurance_create_quote', {
          idempotencyKey: randomUUID(),
          productId: configuredRuntimePolicy.id,
          productVersion: configuredRuntimePolicy.version,
          quote: externalQuote,
        }),
      fail('CONFIGURED_EVALUATION_REQUIRED'),
    );
    const input = {
      idempotencyKey: randomUUID(),
      productId: configuredRuntimePolicy.id,
      productVersion: configuredRuntimePolicy.version,
      submission: syntheticConfiguredSubmission,
      participants: externalQuote.participants,
      expectedEvaluationHash: 'a'.repeat(64),
    };
    assert.throws(
      () => execute('insurance_create_configured_quote', input),
      fail('EVALUATION_CONFLICT'),
    );
    assert.throws(
      () => execute('insurance_create_configured_quote', { ...input, premiumMinor: '1' }),
      fail('VALIDATION_ERROR'),
    );
    assert.equal(store.insuranceOutbox(context).length, before);
    const quote = create();
    assert.equal(quote.sourceMode, 'configured_product');
    assert.equal(quote.decision!.evaluation.evaluationHash, report.evaluationHash);
    const bound = bind(quote);
    assert.equal(bound.status, 'bound');
    assert.equal(bound.premiumMinor, '10152');
    assert.equal(bound.decision!.bindEvaluation!.evaluation.bind.status, 'allowed');
    assert.equal(store.insuranceHistory(context, bound.id).revisions.length, 2);
    assert.throws(
      () =>
        execute('insurance_service', {
          idempotencyKey: randomUUID(),
          recordId: bound.id,
          expectedVersion: bound.version,
          recordHash: bound.recordHash,
          action: 'endorsement',
          premiumDeltaMinor: '1',
          effectiveDate: '2026-09-10',
          reason: 'No configured service bypass',
        }),
      fail('CONFIGURED_SERVICING_UNSUPPORTED'),
    );
    assert.equal(store.insuranceOutbox(context).length, 2);
    assert.throws(
      () =>
        fixture.kernel.execute(
          'insurance_evaluate_product',
          {
            productId: configuredRuntimePolicy.id,
            productVersion: configuredRuntimePolicy.version,
            submission: syntheticConfiguredSubmission,
          },
          { ...context, permissions: [] },
        ),
      fail('FORBIDDEN'),
    );
    assert.throws(
      () => store.insuranceRead({ ...context, operatingEntityId: 'other' }, bound.id),
      fail('NOT_FOUND'),
    );
  } finally {
    store.close();
  }
});

test('referrals, declines and missing optional rule inputs are retained and cannot bind', () => {
  const { store, create, bind } = setup();
  try {
    for (const mode of ['referral', 'decline', 'unknown']) {
      const submission = structuredClone(syntheticConfiguredSubmission);
      submission.reference = mode;
      if (mode === 'referral') submission.answers.age = 18;
      if (mode === 'decline') submission.answers.prohibited = true;
      if (mode === 'unknown') delete submission.answers['prior-losses'];
      const record = create(submission);
      assert.equal(record.quote.eligibility, mode === 'decline' ? 'declined' : 'referred');
      assert.throws(() => bind(record), fail('QUOTE_NOT_READY'));
    }
  } finally {
    store.close();
  }
});

test('historical configured revisions and bind pin immutable release despite later activation and reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'configured-history-'));
  const path = join(dir, 'kernel.sqlite');
  const fixture = setup(path);
  let bound: InsuranceRecord;
  try {
    const first = fixture.create();
    const definition = structuredClone(syntheticInsuranceDefinition);
    definition.coverages[0]!.rate = { method: 'flat', premiumMinor: '15000' };
    fixture.update(definition);
    const secondRelease = fixture.activate();
    assert.notEqual(secondRelease.hash, fixture.release.hash);
    assert.equal(fixture.evaluate().rating.premiumMinor, '15152');
    assert.equal(
      fixture.evaluate(syntheticConfiguredSubmission, first.id).rating.premiumMinor,
      '10152',
    );
    const submission = { ...structuredClone(syntheticConfiguredSubmission), version: '2' };
    const evaluation = fixture.evaluate(submission, first.id);
    const revised = insuranceMutationResultSchema.parse(
      fixture.execute('insurance_revise_configured_quote', {
        recordId: first.id,
        expectedVersion: first.version,
        recordHash: first.recordHash,
        submission,
        participants: externalQuote.participants,
        expectedEvaluationHash: evaluation.evaluationHash,
        idempotencyKey: randomUUID(),
      }),
    ).record;
    assert.equal(revised.runtimeReleaseId, fixture.release.id);
    const oldEvaluation = fixture.evaluate(syntheticConfiguredSubmission, first.id);
    assert.throws(
      () =>
        fixture.execute('insurance_revise_configured_quote', {
          recordId: revised.id,
          expectedVersion: revised.version,
          recordHash: revised.recordHash,
          submission: syntheticConfiguredSubmission,
          participants: externalQuote.participants,
          expectedEvaluationHash: oldEvaluation.evaluationHash,
          idempotencyKey: randomUUID(),
        }),
      fail('SOURCE_VERSION_REQUIRED'),
    );
    bound = fixture.bind(revised);
    assert.equal(bound.decision!.evaluation.releaseHash, fixture.release.hash);
    assert.equal(bound.premiumMinor, '10152');
    fixture.store.close();
    const reopened = new Store(path);
    try {
      assert.deepEqual(reopened.insuranceRead(fixture.context, bound.id), bound);
      assert.equal(reopened.insuranceHistory(fixture.context, bound.id).revisions.length, 3);
    } finally {
      reopened.close();
    }
    const db = new DatabaseSync(path);
    db.exec('DROP TRIGGER insurance_revisions_no_update');
    const damaged = structuredClone(bound);
    damaged.decision!.evaluation.inputHash = 'b'.repeat(64);
    const { recordHash: _, ...content } = damaged;
    damaged.recordHash = hash(content);
    db.prepare(
      'UPDATE insurance_revisions SET record_json=?,record_hash=? WHERE record_id=? AND version=?',
    ).run(JSON.stringify(damaged), damaged.recordHash, bound.id, bound.version);
    db.prepare('UPDATE insurance_records SET record_hash=? WHERE id=?').run(
      damaged.recordHash,
      bound.id,
    );
    db.close();
    const corrupted = new Store(path);
    try {
      assert.throws(
        () => corrupted.insuranceRead(fixture.context, bound.id),
        fail('INTEGRITY_ERROR'),
      );
    } finally {
      corrupted.close();
    }
  } finally {
    try {
      fixture.store.close();
    } catch {}
    await rm(dir, { recursive: true, force: true });
  }
});

test('legacy manual records remain byte-stable and serviceable after a rich release activates', () => {
  const fixture = setup(':memory:', true);
  try {
    const quote = insuranceMutationResultSchema.parse(
      fixture.execute('insurance_create_quote', {
        idempotencyKey: randomUUID(),
        productId: configuredRuntimePolicy.id,
        productVersion: configuredRuntimePolicy.version,
        quote: externalQuote,
      }),
    ).record;
    assert.equal(Object.hasOwn(quote, 'decision'), false);
    const before = JSON.stringify(fixture.store.insuranceRead(fixture.context, quote.id));
    fixture.update();
    fixture.activate();
    assert.equal(JSON.stringify(fixture.store.insuranceRead(fixture.context, quote.id)), before);
    const bound = fixture.bind(quote);
    const serviced = insuranceMutationResultSchema.parse(
      fixture.execute('insurance_service', {
        idempotencyKey: randomUUID(),
        recordId: bound.id,
        expectedVersion: bound.version,
        recordHash: bound.recordHash,
        action: 'endorsement',
        premiumDeltaMinor: '10',
        effectiveDate: '2026-09-10',
        reason: 'Retained manual record conformance',
      }),
    ).record;
    assert.equal(serviced.premiumMinor, '10011');
    assert.equal(serviced.runtimeReleaseId, fixture.release.id);
    assert.equal(serviced.sourceMode, 'manual_external_quote');
    assert.equal(Object.hasOwn(serviced, 'decision'), false);
  } finally {
    fixture.store.close();
  }
});

test('activation blocks a rich runtime policy currency inconsistent with authored insurance money', () => {
  const fixture = setup();
  try {
    fixture.kernel.control.execute(
      'control_update_runtime_draft',
      {
        expectedVersion: fixture.inspect().runtimeDraft.version,
        policies: [{ ...configuredRuntimePolicy, currency: 'USD' }],
        idempotencyKey: randomUUID(),
      },
      principal,
      fixture.tenant.id,
    );
    assert.equal(fixture.inspect().candidate.canActivate, false);
    assert.ok(fixture.inspect().candidate.blockers.some((reason) => reason.includes('currency')));
  } finally {
    fixture.store.close();
  }
});

test('HTTP and MCP evaluate the same activated definition with identical hash and no insurance side effects', async () => {
  const { store, kernel, context, evaluate } = setup();
  const { correlationId: _, ...credentialContext } = context;
  const token = randomUUID() + randomUUID();
  const app = buildApp({ kernel, credentials: [{ token, context: credentialContext }] });
  const client = new Client({ name: 'configured-parity', version: '1' });
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
    const input = {
      productId: configuredRuntimePolicy.id,
      productVersion: configuredRuntimePolicy.version,
      submission: syntheticConfiguredSubmission,
    };
    const before = store.insuranceOutbox(context);
    const response = await fetch(address + '/api/insurance/evaluate', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 200);
    const http = insuranceEvaluationSchema.parse(await response.json());
    await client.connect(
      new StreamableHTTPClientTransport(new URL(address + '/mcp'), { requestInit: { headers } }),
    );
    const tools = await client.listTools();
    assert.equal(
      tools.tools.find((tool) => tool.name === 'insurance_evaluate_product')!.annotations!
        .readOnlyHint,
      true,
    );
    const result = await client.callTool({ name: 'insurance_evaluate_product', arguments: input });
    assert.deepEqual(result.structuredContent, http);
    assert.deepEqual(http, evaluate());
    assert.deepEqual(store.insuranceOutbox(context), before);
    const catalog = insuranceOperations.insurance_catalog.output.parse(
      kernel.execute('insurance_catalog', {}, context),
    );
    assert.equal(catalog.policies[0]!.definitionHash, http.definitionHash);
  } finally {
    await client.close();
    await app.close();
    store.close();
  }
});

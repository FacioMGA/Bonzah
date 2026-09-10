import assert from 'node:assert/strict';
import test from 'node:test';
import {
  categoryIds,
  categorySchema,
  configurationSchema,
  contextSchema,
  reportSchema,
  type Configuration,
} from '../src/contracts/configuration.js';
import { catalog } from '../src/domain/catalog.js';
import { validateConfiguration } from '../src/domain/validate.js';

const context = contextSchema.parse({
  workspaceId: 'workspace',
  tenantId: 'tenant',
  environment: 'sandbox',
  operatingEntityId: 'entity',
  actorId: 'tester',
  permissions: ['configuration:read'],
  correlationId: '11111111-1111-4111-8111-111111111111',
});
const snapshot = { view: 'draft' as const, version: 1, hash: 'fixture-hash' };
function complete(): Configuration {
  return configurationSchema.parse({
    tenant: {
      displayName: 'Synthetic metadata fixture',
      locale: 'en-GB',
      currency: 'GBP',
      timeZone: 'Europe/London',
      residency: 'uk',
    },
    operatingEntities: [{ id: 'entity', name: 'Synthetic entity', territories: ['GB'] }],
    products: [
      {
        id: 'product',
        version: '1.0.0',
        name: 'Metadata product',
        operatingEntityId: 'entity',
        processId: 'process',
        fields: [{ id: 'risk', label: 'Risk reference', type: 'text', required: true }],
        requiredCapabilities: ['definition_validation'],
      },
    ],
    processes: [
      {
        id: 'process',
        version: '1.0.0',
        name: 'Metadata process',
        initialStage: 'draft',
        stages: [
          { id: 'draft', label: 'Draft', terminal: false },
          { id: 'done', label: 'Done', terminal: true },
        ],
        transitions: [{ from: 'draft', to: 'done', command: 'complete' }],
      },
    ],
    integrations: [
      {
        id: 'provider',
        adapterId: 'adapter',
        connectionRef: 'connection://synthetic/provider',
        connectionStatus: 'connected',
      },
    ],
  });
}

test('catalog exposes all 13 categories with only active product evaluation simulated', () => {
  assert.deepEqual(
    catalog.map((category) => category.id),
    [...categoryIds],
  );
  for (const category of catalog) {
    categorySchema.parse(category);
    assert.notEqual(category.support, 'complete');
    assert.equal(category.simulation, category.id === 'products');
    if (category.simulation) {
      assert.match(category.description, /evaluated against retained releases/);
      assert.match(category.description, /Draft simulation.*remain unavailable/);
    }
  }
  assert.equal(catalog.filter((category) => category.support === 'missing').length, 7);
});

test('complete metadata remains production blocked and declared connections remain unverified', () => {
  const report = validateConfiguration(complete(), context, snapshot);
  reportSchema.parse(report);
  assert.equal(report.definitionValid, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.gaps.filter((gap) => gap.code === 'REQUIRES_ENGINEERING').length, 13);
  assert.equal(
    report.gaps.find((gap) => gap.field === 'integrations.provider.connectionStatus')?.kind,
    'unknown',
  );
  assert.equal(report.configurationHash, snapshot.hash);
  for (const gap of report.gaps) {
    assert.equal(gap.tenantId, context.tenantId);
    for (const value of [
      gap.currentState,
      gap.expectedState,
      gap.requirementId,
      gap.affectedJourney,
      gap.remediation,
      gap.owner,
    ])
      assert.ok(value.length);
  }
  assert.deepEqual(report, validateConfiguration(complete(), context, snapshot));
});

test('missing foundational metadata fails definition validity without inventing defaults', () => {
  const configuration = configurationSchema.parse({
    tenant: null,
    operatingEntities: [],
    products: [],
    processes: [],
    integrations: [],
  });
  const report = validateConfiguration(configuration, context, snapshot);
  assert.equal(report.definitionValid, false);
  assert.deepEqual(
    report.gaps
      .filter((gap) => gap.kind === 'missing')
      .map((gap) => gap.field)
      .sort(),
    ['operatingEntities', 'processes', 'products', 'tenant'],
  );
  assert.equal(configuration.tenant, null);
});

test('invalid time zone, duplicate identifiers, missing fields and bad references are actionable', () => {
  const configuration = complete();
  configuration.tenant!.timeZone = 'invalid/place';
  configuration.operatingEntities.push(structuredClone(configuration.operatingEntities[0]!));
  configuration.products[0]!.operatingEntityId = 'absent';
  configuration.products[0]!.processId = 'absent';
  configuration.products[0]!.fields = [];
  const report = validateConfiguration(configuration, context, snapshot);
  assert.equal(report.definitionValid, false);
  for (const field of [
    'tenant.timeZone',
    'operatingEntities.entity',
    'products.product.operatingEntityId',
    'products.product.processId',
    'products.product.fields',
  ])
    assert.ok(
      report.gaps.some((gap) => gap.field === field),
      field,
    );
});

test('closed loops, unreachable stages and undefined transition endpoints fail graph validation', () => {
  const configuration = complete();
  configuration.processes[0]!.transitions = [
    { from: 'draft', to: 'draft', command: 'retry' },
    { from: 'draft', to: 'absent', command: 'invalid' },
  ];
  const report = validateConfiguration(configuration, context, snapshot);
  assert.equal(report.definitionValid, false);
  for (const field of [
    'processes.process.terminal',
    'processes.process.stages.draft.terminalPath',
    'processes.process.stages.done',
    'processes.process.transitions.1',
  ])
    assert.ok(
      report.gaps.some((gap) => gap.field === field),
      field,
    );
});

test('a retry loop with a terminal exit is valid metadata', () => {
  const configuration = complete();
  configuration.processes[0]!.transitions.push({ from: 'draft', to: 'draft', command: 'retry' });
  assert.equal(validateConfiguration(configuration, context, snapshot).definitionValid, true);
});

test('ambiguous commands, terminal transitions and duplicate fields/stages fail validation', () => {
  const configuration = complete();
  configuration.products[0]!.fields.push(structuredClone(configuration.products[0]!.fields[0]!));
  configuration.processes[0]!.stages.push(structuredClone(configuration.processes[0]!.stages[0]!));
  configuration.processes[0]!.transitions.push(
    { from: 'draft', to: 'draft', command: 'complete' },
    { from: 'done', to: 'draft', command: 'reopen' },
  );
  const report = validateConfiguration(configuration, context, snapshot);
  assert.equal(report.definitionValid, false);
  for (const field of [
    'products.product.fields.risk',
    'processes.process.stages.draft',
    'processes.process.transitions.1',
    'processes.process.transitions.2',
  ])
    assert.ok(
      report.gaps.some((gap) => gap.field === field),
      field,
    );
});

test('unsupported required capability explicitly requires engineering and invalidates definition', () => {
  const configuration = complete();
  configuration.products[0]!.requiredCapabilities.push('rating');
  const report = validateConfiguration(configuration, context, snapshot);
  assert.equal(report.definitionValid, false);
  const gap = report.gaps.find(
    (item) => item.field === 'products.product.requiredCapabilities.rating',
  );
  assert.equal(gap?.code, 'REQUIRES_ENGINEERING');
  assert.equal(gap?.productId, 'product');
  assert.equal(gap?.processId, 'process');
});

test('gap identities are stable across snapshot views and correlate to the scoped tenant', () => {
  const draft = validateConfiguration(complete(), context, snapshot);
  const published = validateConfiguration(complete(), context, {
    view: 'published',
    version: 2,
    hash: 'other-hash',
  });
  assert.deepEqual(
    draft.gaps.map((gap) => gap.id),
    published.gaps.map((gap) => gap.id),
  );
  const other = validateConfiguration(complete(), { ...context, tenantId: 'other' }, snapshot);
  assert.ok(
    other.gaps.every(
      (gap) => gap.tenantId === 'other' && !draft.gaps.some((original) => original.id === gap.id),
    ),
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Kernel } from '../src/application/kernel.js';
import { Store } from '../src/storage/store.js';
import { hash } from '../src/domain/canonical.js';
import {
  requirementsProfileSchema,
  requirementsReportSchema,
} from '../src/contracts/requirements.js';
import { referenceScope, referenceConfiguration } from '../src/fixtures/reference.js';
import type { Context } from '../src/contracts/configuration.js';
import {
  syntheticRequirementsProfile,
  syntheticScopedRequirements,
} from './fixtures/requirements.js';

const context: Context = {
  ...referenceScope,
  actorId: 'reviewer',
  permissions: ['configuration:read', 'configuration:write'],
  correlationId: randomUUID(),
};
const report = (kernel: Kernel, scope: Context = context) =>
  requirementsReportSchema.parse(kernel.execute('configuration_requirements', {}, scope));

test('requirements packages validate provenance, references, uniqueness and integrity before serving', () => {
  const store = new Store(':memory:');
  try {
    const invalidProfiles = [
      { ...syntheticRequirementsProfile, sources: [] },
      { ...syntheticRequirementsProfile, requirements: [] },
      { ...syntheticRequirementsProfile, runtimeStatus: 'verified' },
      {
        ...syntheticRequirementsProfile,
        sources: [{ ...syntheticRequirementsProfile.sources[0], sha256: 'not-a-hash' }],
      },
    ];
    for (const profile of invalidProfiles)
      assert.equal(requirementsProfileSchema.safeParse(profile).success, false);
    assert.throws(
      () =>
        new Kernel(store, [{ ...syntheticScopedRequirements, sourceProfileHash: '0'.repeat(64) }]),
      /hash does not match/,
    );
    assert.throws(
      () => new Kernel(store, [syntheticScopedRequirements, syntheticScopedRequirements]),
      /one source profile/,
    );
    const invalidMappings = [
      {
        ...syntheticRequirementsProfile,
        sources: [
          syntheticRequirementsProfile.sources[0]!,
          syntheticRequirementsProfile.sources[0]!,
        ],
      },
      {
        ...syntheticRequirementsProfile,
        requirements: [
          syntheticRequirementsProfile.requirements[0]!,
          syntheticRequirementsProfile.requirements[0]!,
        ],
      },
      {
        ...syntheticRequirementsProfile,
        requirements: [
          {
            ...syntheticRequirementsProfile.requirements[0]!,
            sourceRefs: [{ sourceId: 'unknown-source', locator: 'Section 1' }],
          },
        ],
      },
      {
        ...syntheticRequirementsProfile,
        requirements: [
          {
            ...syntheticRequirementsProfile.requirements[0]!,
            categories: ['products', 'products'] as const,
          },
        ],
      },
    ];
    for (const profile of invalidMappings)
      assert.throws(
        () =>
          new Kernel(store, [
            {
              ...syntheticScopedRequirements,
              profile: profile as typeof syntheticRequirementsProfile,
              sourceProfileHash: hash(profile),
            },
          ]),
        /unique identifiers and valid source references/,
      );
  } finally {
    store.close();
  }
});

test('source scope uses all four trusted dimensions and missing scope never falls back', () => {
  const store = new Store(':memory:');
  const kernel = new Kernel(store, [syntheticScopedRequirements]);
  try {
    const result = report(kernel);
    assert.equal(result.sourceStatus, 'source_attached');
    assert.equal(result.sourceProfileHash, hash(syntheticRequirementsProfile));
    for (const changed of [
      { workspaceId: 'another-workspace' },
      { tenantId: 'another-tenant' },
      { environment: 'sandbox' as const },
      { operatingEntityId: 'another-entity' },
    ]) {
      const requested = { ...context, ...changed };
      const unavailable = report(kernel, requested);
      assert.equal(unavailable.sourceStatus, 'source_not_attached');
      assert.equal(unavailable.profile, null);
      assert.equal(unavailable.sourceProfileHash, null);
      assert.equal(JSON.stringify(unavailable).includes(syntheticRequirementsProfile.title), false);
    }
  } finally {
    store.close();
  }
});

test('source package stays independent of draft/published metadata and cannot gain evidence status', () => {
  const store = new Store(':memory:');
  store.seed(referenceScope, referenceConfiguration, referenceConfiguration);
  const input = structuredClone(syntheticScopedRequirements);
  const kernel = new Kernel(store, [input]);
  try {
    input.profile.title = 'Mutation after registration';
    const original = report(kernel);
    assert.equal(original.profile?.title, syntheticRequirementsProfile.title);
    const mutated = report(kernel);
    if (mutated.profile) mutated.profile.title = 'Mutation after reading';
    assert.deepEqual(report(kernel), original);
    const configuration = structuredClone(referenceConfiguration);
    configuration.tenant!.displayName = 'Changed draft';
    kernel.execute(
      'configuration_update_draft',
      { expectedVersion: 1, idempotencyKey: randomUUID(), configuration },
      context,
    );
    assert.deepEqual(report(kernel), original);
    assert.equal(original.runtimeStatus, 'pending_evidence');
    assert.equal(original.acceptanceStatus, 'not_recorded');
    assert.equal(
      requirementsReportSchema.safeParse({ ...original, runtimeStatus: 'verified' }).success,
      false,
    );
    assert.equal(
      requirementsReportSchema.safeParse({ ...original, sourceStatus: 'source_not_attached' })
        .success,
      false,
    );
    assert.throws(
      () => kernel.execute('configuration_requirements', { view: 'published' }, context),
      /strict operation contract/,
    );
    assert.throws(
      () => kernel.execute('configuration_requirements', { tenantId: 'another-tenant' }, context),
      /strict operation contract/,
    );
    assert.throws(
      () =>
        kernel.execute(
          'configuration_requirements',
          {},
          { ...context, permissions: ['configuration:write'] },
        ),
      /does not grant/,
    );
    assert.ok(
      store
        .audits(context)
        .some(
          (record) =>
            record.operation === 'configuration_requirements' && record.outcome === 'FORBIDDEN',
        ),
    );
  } finally {
    store.close();
  }
});

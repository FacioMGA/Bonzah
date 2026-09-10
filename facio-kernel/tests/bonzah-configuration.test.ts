import test from 'node:test';
import assert from 'node:assert/strict';
import { configurationSchema, contextSchema } from '../src/contracts/configuration.js';
import { insuranceProductDefinitionV2Schema } from '../src/contracts/insurance-definition.js';
import { validateConfiguration } from '../src/domain/validate.js';
import {
  bonzahDevelopmentConfiguration,
  bonzahDevelopmentDefinition,
  bonzahDevelopmentPolicies,
  bonzahDevelopmentScope,
} from '../src/fixtures/bonzah.js';

const context = contextSchema.parse({
  workspaceId: bonzahDevelopmentScope.workspaceId,
  tenantId: bonzahDevelopmentScope.tenantId,
  environment: bonzahDevelopmentScope.environment,
  operatingEntityId: bonzahDevelopmentScope.operatingEntityId,
  actorId: 'bonzah-intake-test',
  permissions: ['configuration:read'],
  correlationId: '11111111-1111-4111-8111-111111111111',
});
const snapshot = { view: 'draft' as const, version: 1, hash: 'bonzah-intake-fixture' };

test('Bonzah development configuration is a valid registered v2 per-day product', () => {
  configurationSchema.parse(bonzahDevelopmentConfiguration);
  insuranceProductDefinitionV2Schema.parse(bonzahDevelopmentDefinition);
  assert.equal(bonzahDevelopmentDefinition.rating.termBasis, 'per_day');
  assert.deepEqual(
    bonzahDevelopmentDefinition.coverages.map((coverage) => coverage.id),
    ['cdw', 'rcli', 'sli', 'pai-pei'],
  );
  assert.deepEqual(
    bonzahDevelopmentDefinition.coverages.find((coverage) => coverage.id === 'sli')?.dependsOn,
    ['rcli'],
  );
  assert.equal(bonzahDevelopmentDefinition.termRules.maximumDays, 30);
});

test('Bonzah configuration carries no invalid, incomplete or inconsistent metadata gaps', () => {
  const report = validateConfiguration(bonzahDevelopmentConfiguration, context, snapshot);
  const blocking = report.gaps.filter((gap) =>
    ['invalid', 'incomplete', 'inconsistent'].includes(gap.kind),
  );
  assert.deepEqual(
    blocking.map((gap) => `${gap.kind}:${gap.field}`),
    [],
    'Configuration metadata must not carry structural defects',
  );
  // Remaining gaps are `unsupported` capability markers: the intake deliberately
  // records what the kernel cannot yet run, so production readiness stays false.
  assert.ok(report.gaps.every((gap) => gap.kind === 'unsupported'));
  assert.equal(report.productionReady, false);
});

test('Bonzah intake fails closed on unapproved money and provider boundaries', () => {
  const policy = bonzahDevelopmentPolicies[0]!.policy;
  assert.equal(policy.requirements.payment, 'required_unsupported');
  assert.equal(policy.requirements.providerVerification, 'required_unsupported');
  assert.equal(policy.requirements.approval, 'independent_review');
  assert.equal(policy.commission.rateBps, 0);
  assert.equal(bonzahDevelopmentConfiguration.integrations.length, 0);
  assert.ok(
    bonzahDevelopmentDefinition.rating.factors
      .filter((factor) => factor.id.includes('state') || factor.id.includes('winter'))
      .every((factor) => factor.reason.startsWith('Unapproved')),
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { customerRequirementsProfiles } from '../src/fixtures/customer-requirements.js';
import { RequirementsRegistry } from '../src/application/requirements.js';
import captureIndex from '../tenant-packages/source-requirements/capture-index.json' with { type: 'json' };

test('customer source packages retain verified capture hashes and original scope obligations', () => {
  const registry = new RequirementsRegistry(customerRequirementsProfiles);
  for (const entry of customerRequirementsProfiles) {
    const report = registry.read(entry.scope);
    assert.equal(report.sourceStatus, 'source_attached');
    assert.equal(report.runtimeStatus, 'pending_evidence');
    assert.equal(report.acceptanceStatus, 'not_recorded');
    for (const source of entry.profile.sources) {
      const path = (captureIndex as Record<string, string>)[source.id];
      assert.ok(path, `Capture must be traceable: ${source.id}`);
      assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), source.sha256);
    }
  }
  const ue = customerRequirementsProfiles.find((p) => p.scope.tenantId === 'ue-intake')!.profile;
  const manifest = JSON.parse(readFileSync('docs/source/ue-manifest.json', 'utf8'));
  assert.equal(ue.requirements.length, 15);
  assert.deepEqual(
    ue.requirements.map((r) => r.id),
    manifest.requirements.map((r: { id: string }) => r.id),
  );
  for (const requirement of ue.requirements) {
    const original = manifest.requirements.find((r: { id: string }) => r.id === requirement.id);
    assert.equal(requirement.expectedOutcome, original.expected_behavior);
    assert.deepEqual(requirement.categories, original.configuration_categories);
    assert.match(requirement.sourceBoundary, /proposed/);
  }
});

test('Bonzah intake retains all mandatory P0 rows and explicit capability boundaries', () => {
  const profile = customerRequirementsProfiles.find(
    (entry) => entry.scope.tenantId === 'bonzah-intake',
  )!.profile;
  const ids = new Set(profile.requirements.map((requirement) => requirement.id));
  for (let index = 1; index <= 14; index += 1)
    assert.ok(ids.has(`P0-${String(index).padStart(2, '0')}`));
  for (const boundary of [
    'BZ-FEE-01',
    'BZ-RATING-ENV',
    'BZ-API-11',
    'BZ-DTC-01',
    'BZ-DOC-APPROVAL',
    'BZ-PAYMENT-01',
    'BZ-RECEIVABLE-01',
    'BZ-TPA-01',
  ])
    assert.ok(ids.has(boundary), `Missing Bonzah boundary ${boundary}`);
  assert.equal(profile.requirements.length, 22);
});

test('full POC retains every UAT, SOW-only criterion and open input under the reaffirmed deadline', () => {
  const profile = customerRequirementsProfiles.find(
    (p) => p.scope.tenantId === 'vuw-intake',
  )!.profile;
  const baseline = JSON.parse(
    readFileSync('docs/source/VUW_Acceptance_Baseline.drive.json', 'utf8'),
  );
  assert.equal(profile.requirements.length, 53);
  const sourceItems = [...baseline.scenarios, ...baseline.sowCriteria, ...baseline.openInputs];
  assert.deepEqual(
    profile.requirements.map((r) => r.id),
    sourceItems.map((r: { id: string }) => r.id),
  );
  for (const original of [...baseline.scenarios, ...baseline.sowCriteria]) {
    const requirement = profile.requirements.find((r) => r.id === original.id)!;
    assert.equal(requirement.expectedOutcome, original.expectedOutput);
    assert.deepEqual(requirement.categories, original.categoryIds);
    assert.equal(
      requirement.priority,
      original.scopeClassification === 'proposed-poc-addition' ? 'unresolved' : 'mandatory',
    );
  }
  assert.match(
    profile.requirements.find((r) => r.id === 'VUW-GAP-12')!.expectedOutcome,
    /September 11 for the full POC is reaffirmed/,
  );
  assert.match(
    profile.requirements.find((r) => r.id === 'VUW-SOW-05')!.expectedOutcome,
    /Caribbean/,
  );
  assert.match(profile.requirements.find((r) => r.id === 'VUW-SOW-08')!.expectedOutcome, /cargo/i);
});

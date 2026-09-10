import { createHash } from 'node:crypto';
import type {
  RequirementsProfile,
  ScopedRequirementsProfile,
} from '../../src/contracts/requirements.js';
import { hash } from '../../src/domain/canonical.js';
import { referenceScope } from '../../src/fixtures/reference.js';

// Synthetic source evidence for conformance only; never a customer acceptance package.
export const syntheticRequirementsProfile: RequirementsProfile = {
  id: 'synthetic-journey',
  version: '1.0.0',
  title: 'Synthetic journey scope',
  sources: [
    {
      id: 'synthetic-outline',
      title: 'Synthetic acceptance outline',
      version: 'test-1',
      capturedAt: '2026-09-06T10:00:00.000Z',
      sha256: createHash('sha256').update('Synthetic source: quote and review.').digest('hex'),
      location: 'fixture://synthetic-outline',
      sourceBoundary: 'A synthetic requirement for testing the source inspection contract.',
    },
  ],
  requirements: [
    {
      id: 'TEST-001',
      title: 'Review quote evidence',
      categories: ['products', 'processes'],
      expectedOutcome: 'A reviewer can inspect the versioned quote and its recorded decision.',
      priority: 'mandatory',
      sourceRefs: [{ sourceId: 'synthetic-outline', locator: 'Scenario 1' }],
      dependencies: ['A customer-approved golden quote and decision are still required.'],
      sourceBoundary:
        'Expected behavior only; no executable quote or customer acceptance is provided.',
    },
  ],
};
export const syntheticScopedRequirements: ScopedRequirementsProfile = {
  scope: referenceScope,
  profile: syntheticRequirementsProfile,
  sourceProfileHash: hash(syntheticRequirementsProfile),
};

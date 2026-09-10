import { describe, expect, it } from 'vitest';
import { extractMissingIssuedFields } from './quoteWizard.domain';

describe('quoteWizard domain helpers', () => {
  it('extracts document missing fields from issue-readiness blockers', () => {
    const missing = extractMissingIssuedFields({
      blockers: [
        {
          code: 'DOCUMENT_FIELDS_MISSING',
          details: {
            missingFields: [
              { slug: 'insured.nif', label: 'NIF / Tax ID' },
              { slug: 'vehicle.registration', label: 'Registration number' },
            ],
          },
        },
      ],
    });

    expect(missing).toEqual([
      { slug: 'insured.nif', label: 'NIF / Tax ID' },
      { slug: 'vehicle.registration', label: 'Registration number' },
    ]);
  });

  it('extracts quote-data invalid schema issues from readiness blockers', () => {
    const missing = extractMissingIssuedFields({
      blockers: [
        {
          code: 'QUOTE_DATA_INVALID',
          details: {
            schemaIssues: [
              { slug: 'proposer.occupation', message: 'proposer.occupation is required' },
              { slug: 'proposer.whereDidYouHear', message: 'proposer.whereDidYouHear is required' },
            ],
          },
        },
      ],
    });

    expect(missing).toEqual([
      { slug: 'proposer.occupation', label: 'proposer.occupation is required' },
      { slug: 'proposer.whereDidYouHear', label: 'proposer.whereDidYouHear is required' },
    ]);
  });
});

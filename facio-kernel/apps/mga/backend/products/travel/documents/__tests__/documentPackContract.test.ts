import { describe, expect, it } from 'vitest';
import { TRAVEL_DOCUMENT_PACK_CONTRACT } from '../documentPackContract.js';

describe('Travel document-pack contract', () => {
  it('includes the approved policy wording in every customer Travel quote pack', () => {
    const wording = TRAVEL_DOCUMENT_PACK_CONTRACT.entries.find(
      (entry) => entry.docType === 'TRAVEL_POLICY_WORDING_PDF',
    );

    expect(wording).toEqual(expect.objectContaining({ filename: 'Travel_Policy_Wording.pdf' }));
    expect(wording?.scope.docPacks).toContain('QUOTE_PACK');
  });
});

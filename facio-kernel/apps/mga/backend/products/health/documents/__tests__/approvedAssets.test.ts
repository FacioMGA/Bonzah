import crypto from 'node:crypto';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HEALTH_DOCUMENT_PACK_CONTRACT } from '../documentPackContract.js';

describe('approved Immigration Medical document masters', () => {
  it.each([
    ['HEALTH_IPID_PDF', 'a379e7faa1e761aa2845d4efc0cc83ee78390524417a90438b096cee5d7e0dbf'],
    ['HEALTH_POLICY_WORDING_PDF', 'c741cea9bcbfe975b45d559a7bb4174f1c19500768b1e38355e77581d4da174b'],
  ])('attaches the exact owner-approved %s original supplied on 6 September 2026', (docType, hash) => {
    const entry = HEALTH_DOCUMENT_PACK_CONTRACT.entries.find((candidate) => candidate.docType === docType);
    expect(entry?.mode).toBe('staticPdf');
    if (!entry || entry.mode !== 'staticPdf') throw new Error(`Missing ${docType}`);
    expect(crypto.createHash('sha256').update(fs.readFileSync(entry.staticPdfPath)).digest('hex')).toBe(hash);
    expect(entry.scope.docPacks).toContain('ISSUED_POLICY_PACK');
    expect(entry.assetVersion).toContain(hash.slice(0, 16));
  });
});

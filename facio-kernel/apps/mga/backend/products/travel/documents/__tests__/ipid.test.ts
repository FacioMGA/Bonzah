import crypto from 'node:crypto';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveTravelIpid } from '../ipid.js';
import { TRAVEL_DOC_PACK_CONFIG } from '../generateTravelDocPack.js';
import type { DocPackContext } from '../../../shared/documents/genericDocPackGenerator.js';

function context(planType: unknown): DocPackContext {
  return {
    policy: { id: 'travel-proof', policyNumber: 'TRAVEL-PROOF', certificateNumber: null, productType: 'TRAVEL', inceptionDate: null, expiryDate: null, umr: null, binderId: null, policyHolder: null },
    riskTransactionId: 'bound-risk',
    snapshot: {},
    quoteData: { trip: { planType } },
  };
}

const variants = [
  ['single_trip', 'Travel_Single_Trip_IPID.pdf', 'cb88aa4349a0d7a59e26c10eda6246da8cb82445542fbdd88f7a3d5a68708a53'],
  ['annual_multi_trip', 'Travel_Annual_Multi_Trip_IPID.pdf', '2378c1cc71b86cce2ea291f3292fce81a5bbdabad10eb0d82ca2f53908c23688'],
] as const;

describe('Travel IPID variant selection (ADR-0099)', () => {
  it.each(variants)('uses the exact approved %s source for public, quote and issued disclosures', (variant, filename, hash) => {
    const publicAsset = resolveTravelIpid({ variant });
    expect(publicAsset.filename).toBe(filename);
    expect(crypto.createHash('sha256').update(fs.readFileSync(publicAsset.staticPdfPath)).digest('hex')).toBe(hash);
    expect(resolveTravelIpid({ quoteData: context(variant).quoteData })).toEqual(publicAsset);
    for (const docPack of ['QUOTE_PACK', 'ISSUED_POLICY_PACK']) {
      const documents = TRAVEL_DOC_PACK_CONFIG.selectDocs(context(variant), { docPack, nextVersion: 1 });
      const ipids = documents.filter((doc) => doc.docType === 'TRAVEL_IPID_PDF');
      expect(ipids).toHaveLength(1);
      expect(ipids[0]).toMatchObject({ mode: 'staticPdf', ...publicAsset });
    }
  });

  it.each([undefined, '', 'Annual', 'annual', 'single_trip ', 'invalid', null])('fails closed for unsupported or missing variant %s', (variant) => {
    expect(() => resolveTravelIpid({ quoteData: context(variant).quoteData })).toThrow('TRAVEL_IPID_SELECTION_REQUIRED');
    expect(() => TRAVEL_DOC_PACK_CONFIG.selectDocs(context(variant), { docPack: 'ISSUED_POLICY_PACK', nextVersion: 1 })).toThrow('TRAVEL_IPID_SELECTION_REQUIRED');
  });

  it('requires an explicit selector at the public disclosure boundary', () => {
    expect(() => resolveTravelIpid()).toThrow('TRAVEL_IPID_SELECTION_REQUIRED');
    expect(() => resolveTravelIpid({ variant: 'unknown' })).toThrow('TRAVEL_IPID_SELECTION_REQUIRED');
  });

  it('rejects a variant that conflicts with canonical quote data', () => {
    expect(() => resolveTravelIpid({ variant: 'single_trip', quoteData: context('annual_multi_trip').quoteData })).toThrow('TRAVEL_IPID_SELECTION_CONFLICT');
  });
});

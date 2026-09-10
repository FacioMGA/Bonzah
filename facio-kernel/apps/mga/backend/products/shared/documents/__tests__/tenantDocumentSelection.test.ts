import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import Handlebars from 'handlebars';
import { selectProductDocsFromContract, type DocPackContext } from '../genericDocPackGenerator.js';
import { HOME_DOCUMENT_PACK_CONTRACT } from '../../../home/documents/documentPackContract.js';
import { TRAVEL_DOCUMENT_PACK_CONTRACT } from '../../../travel/documents/documentPackContract.js';

const policy = { id: 'policy-tenant-a', policyNumber: 'TENANT-A-HOME-P123' } as DocPackContext['policy'];
const selected = [{ documentType: 'HOME_SCHEDULE_PDF', sourceId: 'home-schedule', sourceVersion: 'v4-footer-clearance' }];
const context = { policy, riskTransactionId: 'inception-a', snapshot: {}, quoteData: {}, documentSources: selected };

describe('tenant selected document sources', () => {
  it('issues a configured Home schedule without selecting legacy insurer IPID, wording, or assistance assets', () => {
    const docs = selectProductDocsFromContract(HOME_DOCUMENT_PACK_CONTRACT, context, { docPack: 'ISSUED_POLICY_PACK', nextVersion: 1 });
    expect(docs.map((doc) => doc.docType)).toEqual(['HOME_SCHEDULE_PDF']);
    expect(docs[0].filename).toBe('Home_Schedule_TENANT-A-HOME-P123.pdf');
    expect(docs[0].mode).toBe('template');
  });
  it('does not attach legacy Travel assets when no source was selected', () => {
    expect(selectProductDocsFromContract(TRAVEL_DOCUMENT_PACK_CONTRACT, { ...context, documentSources: [] }, { docPack: 'ISSUED_POLICY_PACK', nextVersion: 1 })).toEqual([]);
  });
  it.each(['home', 'travel', 'health', 'motor'])('renders %s schedule identity without embedded customer or carrier claims', (product) => {
    const template = fs.readFileSync(new URL(`../../../${product}/documents/templates/schedule.html`, import.meta.url), 'utf8');
    const html = Handlebars.compile(template)({ tenantBrand: { displayName: 'Harbour MGA', legalName: 'Harbour Limited', legalLines: ['Training authority only'], address: 'Configured office' } });
    const visible = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
    expect(visible).toContain('Harbour');
    expect(visible).not.toMatch(/Abbeygate|Lloyd's Insurance Company|Citibank|B176026|BZ\/ABG|ps-signature/);
  });
});

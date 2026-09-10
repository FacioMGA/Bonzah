import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../../..');

const ISSUANCE_ENTRYPOINTS = [
  {
    name: 'public wizard payment issuance',
    file: 'backend/modules/payments/app/cardcorpPolicyIssuanceService.ts',
    helper: 'enqueueIssuedPolicyPack',
  },
  {
    name: 'BO bind coverage issuance',
    file: 'backend/modules/policy/app/BindPolicy.ts',
    helper: 'enqueueIssuedPolicyPack',
  },
  {
    name: 'BO issue policy',
    file: 'backend/modules/policy/app/IssuePolicy.ts',
    helper: 'enqueueIssuedPolicyPack',
  },
  {
    name: 'BO/API v1 issue policy',
    file: 'backend/modules/policy/http/v1PoliciesRouter.ts',
    helper: 'enqueueIssuedPolicyPack',
  },
  {
    name: 'BO endorsement issue',
    file: 'backend/modules/policy/app/IssueEndorsement.ts',
    helper: 'enqueueIssuedPolicyPack',
  },
] as const;

function source(file: string): string {
  return readFileSync(path.join(ROOT, file), 'utf8');
}

describe('issued document pack spine wiring', () => {
  it.each(ISSUANCE_ENTRYPOINTS)('$name routes issued-pack generation through the canonical outbox helper', ({ file, helper }) => {
    const text = source(file);
    expect(text).toContain(helper);
    expect(text).toMatch(new RegExp(`\\b${helper}\\s*\\(`));
  });

  it.each(ISSUANCE_ENTRYPOINTS)('$name does not generate ISSUED_POLICY_PACK inline through DocumentService', ({ file }) => {
    const text = source(file);
    const inlineIssuedPack = /DocumentService\.generate\s*\([\s\S]*?docPack\s*:\s*['"]ISSUED_POLICY_PACK['"]/m;
    expect(text).not.toMatch(inlineIssuedPack);
  });

  it('DocumentService itself refuses inline ISSUED_POLICY_PACK generation', () => {
    const text = source('backend/modules/documents/app/documentService.ts');
    expect(text).toMatch(/docPack\s*\|\|\s*''\)\.trim\(\)\.toUpperCase\(\)\s*===\s*'ISSUED_POLICY_PACK'/);
    expect(text).toMatch(/refuses docPack='ISSUED_POLICY_PACK'/);
  });

  it('endorsement issue is the only entrypoint allowed to generate ENDORSEMENT_PACK inline before the issued-pack spine', () => {
    const endorsementSource = source('backend/modules/policy/app/IssueEndorsement.ts');
    expect(endorsementSource).toMatch(/DocumentService\.generate\s*\([\s\S]*?docPack\s*:\s*'ENDORSEMENT_PACK'/m);
    expect(endorsementSource).toMatch(/\benqueueIssuedPolicyPack\s*\(/);
  });
});

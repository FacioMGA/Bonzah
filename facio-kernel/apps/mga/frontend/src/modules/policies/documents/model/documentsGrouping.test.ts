import { describe, expect, it } from 'vitest';
import { documentForRole, generatedDocuments, historyDocumentsForRiskTransaction } from './documentsGrouping';

describe('documents grouping helpers', () => {
  it('keeps only GENERATED docs as active candidates', () => {
    const docs = generatedDocuments([
      { id: 'a', status: 'GENERATED' },
      { id: 'b', status: 'SUPERSEDED' },
      { id: 'c' },
    ]);
    expect(docs.map((d) => String(d.id))).toEqual(['a', 'c']);
  });

  it('returns endorsement delta and superseded docs for history', () => {
    const docs = [
      { id: 'cert-new', type: 'MOTOR_CERTIFICATE_PDF', status: 'GENERATED', riskTransactionId: 'rt-2' },
      { id: 'cert-old', type: 'MOTOR_CERTIFICATE_PDF', status: 'GENERATED', riskTransactionId: 'rt-2' },
      { id: 'endorse-1', type: 'MOTOR_ENDORSEMENT_SCHEDULE_PDF', status: 'GENERATED', riskTransactionId: 'rt-2' },
      { id: 'other', type: 'MOTOR_SCHEDULE_PDF', status: 'GENERATED', riskTransactionId: 'rt-1' },
    ];
    const history = historyDocumentsForRiskTransaction({
      docs,
      riskTransactionId: 'rt-2',
      activeDocIds: new Set(['cert-new']),
    });
    const ids = history.map((d) => String(d.id));
    expect(ids).toContain('cert-old');
    expect(ids).toContain('endorse-1');
    expect(ids).not.toContain('cert-new');
    expect(ids).not.toContain('other');
  });
});

it('selects only the exact issued pack even when a quote or older issued version is newer',()=>{
  const docs=[{id:'current',type:'HOME_SCHEDULE_PDF',pack:'ISSUED_POLICY_PACK',riskTransactionId:'rt2',status:'GENERATED',createdAt:'2026-01-01'}, {id:'old',type:'HOME_SCHEDULE_PDF',pack:'ISSUED_POLICY_PACK',riskTransactionId:'rt1',status:'GENERATED',createdAt:'2026-01-02'}, {id:'quote',type:'HOME_SCHEDULE_PDF',pack:'QUOTE_PACK',status:'GENERATED',createdAt:'2026-01-03'}];
  expect(documentForRole(docs,'SCHEDULE_PDF','rt2')?.id).toBe('current');
  expect(documentForRole(docs,'SCHEDULE_PDF','missing')).toBeNull();
  expect(documentForRole(docs,'SCHEDULE_PDF',null)?.id).toBe('quote');
});

import { describe, expect, it } from 'vitest';
import { generatedDocuments, historyDocumentsForRiskTransaction } from './documentsGrouping';

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

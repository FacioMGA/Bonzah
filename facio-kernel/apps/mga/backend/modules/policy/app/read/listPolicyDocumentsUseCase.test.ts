import { describe, expect, it } from 'vitest';
import { listPolicyDocumentsUseCase } from './listPolicyDocumentsUseCase.js';

describe('listPolicyDocumentsUseCase', () => {
  it('maps publicUrl based on visibility policy', async () => {
    const result = await listPolicyDocumentsUseCase(
      { policyId: 'pol_1', tenantId: 'tenant_1' },
      {
        repo: {
          async listDocumentsByPolicy() {
            return [
              { id: 'doc_public', type: 'MOTOR_QUOTE_PDF', docPack: 'QUOTE_PACK', filename: 'Quote.pdf' },
              { id: 'doc_private', type: 'INTERNAL_NOTE', docPack: 'INTERNAL', filename: 'Internal.pdf' },
            ];
          },
        },
        visibility: {
          isClientPublicDocument(doc: { docPack?: string | null; type?: string | null }) {
            return String(doc.docPack || '') === 'QUOTE_PACK' && String(doc.type || '') === 'MOTOR_QUOTE_PDF';
          },
        },
      }
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      data: [
        {
          id: 'doc_public',
          type: 'MOTOR_QUOTE_PDF',
          docPack: 'QUOTE_PACK',
          filename: 'Quote.pdf',
          publicUrl: '/api/public/documents/doc_public',
        },
        {
          id: 'doc_private',
          type: 'INTERNAL_NOTE',
          docPack: 'INTERNAL',
          filename: 'Internal.pdf',
          publicUrl: null,
        },
      ],
    });
  });

  it('orders issued policy documents so the personalized schedule is shown before static attachments', async () => {
    const result = await listPolicyDocumentsUseCase(
      { policyId: 'pol_1', tenantId: 'tenant_1' },
      {
        repo: {
          async listDocumentsByPolicy() {
            return [
              {
                id: 'doc_assistance',
                type: 'HOME_EUROP_ASSISTANCE_PDF',
                docPack: 'ISSUED_POLICY_PACK',
                filename: 'Home_Europ_Assistance_Information.pdf',
                createdAt: '2026-05-13T10:04:00.000Z',
              },
              {
                id: 'doc_wording',
                type: 'HOME_POLICY_WORDING_PDF',
                docPack: 'ISSUED_POLICY_PACK',
                filename: 'Home_Policy_Wording_Cyprus_Domiciled.pdf',
                createdAt: '2026-05-13T10:03:00.000Z',
              },
              {
                id: 'doc_statement',
                type: 'HOME_STATEMENT_OF_FACT_PDF',
                docPack: 'ISSUED_POLICY_PACK',
                filename: 'Home_Statement_of_Fact_ABOLV1000001.pdf',
                createdAt: '2026-05-13T10:01:00.000Z',
              },
              {
                id: 'doc_schedule',
                type: 'HOME_SCHEDULE_PDF',
                docPack: 'ISSUED_POLICY_PACK',
                filename: 'Home_Schedule_ABOLV1000001.pdf',
                createdAt: '2026-05-13T10:00:00.000Z',
              },
            ];
          },
        },
        visibility: {
          isClientPublicDocument() {
            return true;
          },
        },
      }
    );

    expect((result.body.data as Array<{ id: string }>).map((doc) => doc.id)).toEqual([
      'doc_schedule',
      'doc_statement',
      'doc_wording',
      'doc_assistance',
    ]);
  });
});

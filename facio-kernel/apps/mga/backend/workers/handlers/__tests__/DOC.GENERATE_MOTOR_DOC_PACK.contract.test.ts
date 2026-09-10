import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeMotorDocPackGenerationMock = vi.fn(async () => ({ generated: ['MOTOR_CERTIFICATE_PDF'] }));
vi.mock('../../../modules/documents/infra/motorDocsService.js', () => ({
  executeMotorDocPackGeneration: (...args: unknown[]) => executeMotorDocPackGenerationMock(...args),
}));

vi.mock('../../../platform/tenant/tenantJobContext.js', () => ({
  runWithPolicyOperatingTenant: (_policyId: string, fn: () => Promise<unknown>) => fn(),
}));

const resolveImmutablePolicyDocumentConfigurationMock = vi.fn(async () => ({
  requiredIssuedDocTypes: ['MOTOR_CERTIFICATE_PDF'],
  documentSources: [{ documentType: 'MOTOR_CERTIFICATE_PDF', sourceId: 'motor-certificate', sourceVersion: 'v2' }],
}));
vi.mock('../../../modules/policy/app/productRegistryService.js', () => ({
  resolveImmutablePolicyDocumentConfiguration: (...args: unknown[]) =>
    resolveImmutablePolicyDocumentConfigurationMock(...args),
}));

const { runMotorDocPackJob, handleGenerateMotorDocPack, MotorDocPackPayloadSchema } = await import(
  '../DOC.GENERATE_MOTOR_DOC_PACK.js'
);

describe('DOC.GENERATE_MOTOR_DOC_PACK handler — typed payload contract (ADR-0029)', () => {
  beforeEach(() => {
    executeMotorDocPackGenerationMock.mockClear();
    resolveImmutablePolicyDocumentConfigurationMock.mockClear();
    resolveImmutablePolicyDocumentConfigurationMock.mockResolvedValue({
      requiredIssuedDocTypes: ['MOTOR_CERTIFICATE_PDF'],
      documentSources: [{ documentType: 'MOTOR_CERTIFICATE_PDF', sourceId: 'motor-certificate', sourceVersion: 'v2' }],
    });
  });

  it('exposes the canonical JobHandler shim + pure body', () => {
    expect(typeof handleGenerateMotorDocPack).toBe('function');
    expect(typeof runMotorDocPackJob).toBe('function');
  });

  it('accepts a typed payload and dispatches to executeMotorDocPackGeneration with the canonical shape', async () => {
    await runMotorDocPackJob({
      policyId: 'pol_1',
      docPack: 'ISSUED_POLICY_PACK',
      riskTransactionId: 'rt_9',
      source: 'CUSTOMER',
      generatedByUserId: 'user_1',
      templateVersion: 'v2',
      requiredIssuedDocTypes: ['MOTOR_CERTIFICATE_PDF'],
      documentSources: [{ documentType: 'MOTOR_CERTIFICATE_PDF', sourceId: 'motor-certificate', sourceVersion: 'v2' }],
    });
    expect(executeMotorDocPackGenerationMock).toHaveBeenCalledTimes(1);
    expect(executeMotorDocPackGenerationMock).toHaveBeenCalledWith({
      policyId: 'pol_1',
      riskTransactionId: 'rt_9',
      docPack: 'ISSUED_POLICY_PACK',
      source: 'CUSTOMER',
      generatedByUserId: 'user_1',
      templateVersion: 'v2',
      requiredIssuedDocTypes: ['MOTOR_CERTIFICATE_PDF'],
      documentSources: [{ documentType: 'MOTOR_CERTIFICATE_PDF', sourceId: 'motor-certificate', sourceVersion: 'v2' }],
    });
  });

  it("accepts templateVersion null from DocumentService.generate queue payload (ABY-444)", async () => {
    await runMotorDocPackJob({
      policyId: 'pol_quote_email',
      docPack: 'QUOTE_PACK',
      source: 'CUSTOMER',
      generatedByUserId: null,
      templateVersion: null,
    });
    expect(executeMotorDocPackGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        policyId: 'pol_quote_email',
        docPack: 'QUOTE_PACK',
        templateVersion: undefined,
      }),
    );
  });

  it("defaults source to 'SYSTEM' when omitted (canonical adapter convention)", async () => {
    await runMotorDocPackJob({ policyId: 'pol_2', docPack: 'QUOTE_PACK' });
    expect(executeMotorDocPackGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({ policyId: 'pol_2', docPack: 'QUOTE_PACK', source: 'SYSTEM' }),
    );
  });

  it('rejects an invalid docPack value at the parse boundary', async () => {
    await expect(
      runMotorDocPackJob({ policyId: 'pol_3', docPack: 'NOT_A_PACK' }),
    ).rejects.toThrow();
    expect(executeMotorDocPackGenerationMock).not.toHaveBeenCalled();
  });

  it('rejects an empty policyId at the parse boundary', async () => {
    await expect(
      runMotorDocPackJob({ policyId: '', docPack: 'ISSUED_POLICY_PACK' }),
    ).rejects.toThrow(/missing policyId/i);
  });

  it('payload schema pins the canonical docPack literal union', () => {
    expect(() =>
      MotorDocPackPayloadSchema.parse({ policyId: 'pol_4', docPack: 'WRONG' }),
    ).toThrow();
    for (const docPack of ['QUOTE_PACK', 'DRAFT_POLICY_PACK', 'ISSUED_POLICY_PACK', 'ENDORSEMENT_PACK'] as const) {
      expect(MotorDocPackPayloadSchema.parse({ policyId: 'pol_4', docPack }).docPack).toBe(docPack);
    }
  });
});

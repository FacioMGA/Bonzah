import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpContext } from '../../../mcp/domain/mcpContext.js';

const mocks = vi.hoisted(() => ({
  findPolicy: vi.fn(),
  findDocuments: vi.fn(),
  readiness: vi.fn(),
  bind: vi.fn(),
  issueToken: vi.fn(),
  consumeToken: vi.fn(),
}));

vi.mock('../../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    policy: { findUnique: mocks.findPolicy },
    document: { findMany: mocks.findDocuments },
  },
}));
vi.mock('../../../../platform/tenant/tenantConfig.js', () => ({
  getTenantConfig: () => ({ tenantSlug: 'bonzah', publicBaseUrl: 'https://platform.facio.io' }),
}));
vi.mock('../../../policy/domain/issueReadiness.js', () => ({ evaluateIssueReadiness: mocks.readiness }));
vi.mock('../../../policy/app/BindPolicy.js', () => ({ executeBindPolicy: mocks.bind }));
vi.mock('../../../mcp/infra/confirmationTokenStore.js', () => ({
  hashPreviewInput: (value: unknown) => JSON.stringify(value),
  issueConfirmationToken: mocks.issueToken,
  consumeConfirmationToken: mocks.consumeToken,
}));

import { bindPolicyFromMcp, previewPolicyBind } from '../policyIssuanceMcp.js';

const ctx: McpContext = {
  tenantId: 'tenant-bonzah',
  userId: 'operator-1',
  role: 'USER',
  permissions: ['operator.mutate', 'policies.bind'],
  channel: 'cursor',
  sessionId: 'session-1',
  requestId: 'request-1',
  correlationId: 'correlation-1',
};

const policy = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'PAID',
  paymentStatus: 'PAID',
  programId: 'program-rental',
  binderId: 'binder-rental',
  updatedAt: new Date('2026-09-09T12:00:00.000Z'),
  quoteData: { risk: 'rental' },
  quoteResponse: { total: 196 },
  stateCurrent: { snapshot: { configurationVersion: 'bonzah-2' }, updatedAt: new Date('2026-09-09T11:59:00.000Z') },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findPolicy.mockResolvedValue(policy);
  mocks.readiness.mockResolvedValue({ canIssue: true, blockers: [] });
  mocks.issueToken.mockResolvedValue({
    token: 'tok_0123456789abcdef0123456789abcdef',
    expiresAt: '2026-09-09T12:10:00.000Z',
  });
});

describe('governed operator policy issuance', () => {
  it('fails closed before readiness when payment is not server verified', async () => {
    mocks.findPolicy.mockResolvedValue({ ...policy, paymentStatus: 'PENDING' });

    const result = await previewPolicyBind({ policyId: policy.id }, ctx);

    expect(result).toMatchObject({ ok: false, error: { code: 'PAYMENT_NOT_VERIFIED' } });
    expect(mocks.readiness).not.toHaveBeenCalled();
    expect(mocks.issueToken).not.toHaveBeenCalled();
  });

  it('returns readiness blockers without issuing a confirmation token', async () => {
    mocks.readiness.mockResolvedValue({
      canIssue: false,
      blockers: [{ code: 'PAYMENT_NOT_VERIFIED', message: 'Payment is not verified.', severity: 'BLOCK' }],
    });

    const result = await previewPolicyBind({ policyId: policy.id }, ctx);

    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_READY_TO_BIND' } });
    expect(mocks.issueToken).not.toHaveBeenCalled();
  });

  it('previews a bind with an actor-bound retained-state token', async () => {
    const result = await previewPolicyBind({ policyId: policy.id }, ctx);

    expect(result).toMatchObject({
      ok: true,
      status: 'preview',
      requires_confirmation: true,
      entities: { policyId: policy.id },
      preview_extra: { payment_status: 'PAID', program_id: 'program-rental', binder_id: 'binder-rental' },
    });
    expect(mocks.issueToken).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'operator-1',
      toolName: 'operator.bind_policy',
      entityId: policy.id,
    }));
  });

  it('rejects a consumed preview when pricing or configuration state changed', async () => {
    const previewResult = await previewPolicyBind({ policyId: policy.id }, ctx);
    const issuedPayload = mocks.issueToken.mock.calls[0]![0];
    mocks.consumeToken.mockResolvedValue(issuedPayload);
    mocks.findPolicy.mockResolvedValue({ ...policy, quoteResponse: { total: 197 } });

    const result = await bindPolicyFromMcp({
      policyId: policy.id,
      confirmation_token: String((previewResult as { confirmation_token: string }).confirmation_token),
    }, ctx);

    expect(result).toMatchObject({ ok: false, error: { code: 'PREVIEW_STALE' } });
    expect(mocks.bind).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const prismaMocks = vi.hoisted(() => ({ findFirst: vi.fn() }));
const resolveCustomerPolicyAccessMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../platform/db/connection.js', () => ({
  tenantScopedPrisma: {
    document: { findFirst: prismaMocks.findFirst },
    policy: { findUnique: vi.fn(async () => ({ programId: 'program-1', binderId: 'binder-1', productType: 'HOME' })) },
  },
}));

vi.mock('../../../insuranceConfiguration/app/journeyCapabilities.js', () => ({
  assertPolicyJourneyAction: vi.fn(async () => ({ workflow: {} })),
}));

vi.mock('../../../policy/app/customerPolicyAccess.js', () => ({
  resolveCustomerPolicyAccess: resolveCustomerPolicyAccessMock,
}));

type RequestFixture = Pick<Request, 'user' | 'tenantId' | 'params'>;
type ResponseFixture = Pick<Response, 'status' | 'json'>;

function mockResponse(): ResponseFixture {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response as ResponseFixture;
}

describe('requireCustomerOwnedDocument', () => {
  beforeEach(() => {
    prismaMocks.findFirst.mockReset();
    resolveCustomerPolicyAccessMock.mockReset();
  });

  it('allows staff roles without a customer ownership lookup', async () => {
    const { requireCustomerOwnedDocument } = await import('../requireCustomerOwnedDocument.js');
    const next = vi.fn();
    const req: RequestFixture = { user: { id: 'staff-1', role: 'UNDERWRITER' }, params: { filename: 'schedule.pdf' } };

    await requireCustomerOwnedDocument(req as Request, mockResponse() as Response, next as NextFunction);

    expect(prismaMocks.findFirst).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('allows a customer only when the canonical policy access check authorises the document policy', async () => {
    const { requireCustomerOwnedDocument } = await import('../requireCustomerOwnedDocument.js');
    prismaMocks.findFirst.mockResolvedValue({
      policyId: 'policy-1',
      docPack: 'ISSUED_POLICY_PACK',
      type: 'HOME_SCHEDULE_PDF',
    });
    resolveCustomerPolicyAccessMock.mockResolvedValue('ok');
    const next = vi.fn();
    const req: RequestFixture = {
      user: { id: 'customer-1', role: 'CUSTOMER', email: 'holder@example.test' },
      tenantId: 'account-1',
      params: { filename: 'schedule.pdf' },
    };

    await requireCustomerOwnedDocument(req as Request, mockResponse() as Response, next as NextFunction);

    expect(prismaMocks.findFirst).toHaveBeenCalledWith({
      where: {
        storageUri: '/api/documents/schedule.pdf',
        status: 'GENERATED',
      },
      select: { policyId: true, docPack: true, type: true },
    });
    expect(resolveCustomerPolicyAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ primaryAccountId: 'account-1' }),
      'policy-1',
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not disclose a customer document when policy ownership is denied', async () => {
    const { requireCustomerOwnedDocument } = await import('../requireCustomerOwnedDocument.js');
    prismaMocks.findFirst.mockResolvedValue({
      policyId: 'policy-1',
      docPack: 'ISSUED_POLICY_PACK',
      type: 'HOME_SCHEDULE_PDF',
    });
    resolveCustomerPolicyAccessMock.mockResolvedValue('denied');
    const next = vi.fn();
    const res = mockResponse();
    const req: RequestFixture = {
      user: { id: 'customer-1', role: 'CUSTOMER' },
      tenantId: 'account-1',
      params: { filename: 'schedule.pdf' },
    };

    await requireCustomerOwnedDocument(req as Request, res as Response, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not expose a customer-owned Creditsafe sanctions report', async () => {
    const { requireCustomerOwnedDocument } = await import('../requireCustomerOwnedDocument.js');
    prismaMocks.findFirst.mockResolvedValue({
      policyId: 'policy-1',
      docPack: 'ISSUED_POLICY_PACK',
      type: 'CREDITSAFE_SANCTIONS_REPORT_PDF',
    });
    const next = vi.fn();
    const res = mockResponse();
    const req: RequestFixture = {
      user: { id: 'customer-1', role: 'CUSTOMER' },
      tenantId: 'account-1',
      params: { filename: 'sanctions-report.pdf' },
    };

    await requireCustomerOwnedDocument(req as Request, res as Response, next as NextFunction);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(resolveCustomerPolicyAccessMock).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('does not expose a superseded document retained from an earlier pack', async () => {
    const { requireCustomerOwnedDocument } = await import('../requireCustomerOwnedDocument.js');
    prismaMocks.findFirst.mockResolvedValue(null);
    const next = vi.fn();
    const res = mockResponse();
    const req: RequestFixture = {
      user: { id: 'customer-1', role: 'CUSTOMER' },
      tenantId: 'account-1',
      params: { filename: 'superseded-schedule.pdf' },
    };

    await requireCustomerOwnedDocument(req as Request, res as Response, next as NextFunction);

    expect(prismaMocks.findFirst).toHaveBeenCalledWith({
      where: {
        storageUri: '/api/documents/superseded-schedule.pdf',
        status: 'GENERATED',
      },
      select: { policyId: true, docPack: true, type: true },
    });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['TRAVEL_MEDICAL_CARD_PDF', 'ISSUED_POLICY_PACK'],
    ['MOTOR_ENDORSEMENT_SCHEDULE_PDF', 'ENDORSEMENT_PACK'],
    ['TRAVEL_CERTIFICATE_PDF', 'QUOTE_PACK'],
    ['TRAVEL_IPID_PDF', 'QUOTE_PACK'],
    ['TRAVEL_POLICY_WORDING_PDF', 'QUOTE_PACK'],
    ['HOME_SCHEDULE_PDF', 'QUOTE_PACK'],
    ['HEALTH_CERTIFICATE_PDF', 'QUOTE_PACK'],
  ])('allows a customer to retrieve the required %s document', async (type, docPack) => {
    const { requireCustomerOwnedDocument } = await import('../requireCustomerOwnedDocument.js');
    prismaMocks.findFirst.mockResolvedValue({
      policyId: 'policy-1',
      docPack,
      type,
    });
    resolveCustomerPolicyAccessMock.mockResolvedValue('ok');
    const next = vi.fn();
    const req: RequestFixture = {
      user: { id: 'customer-1', role: 'CUSTOMER' },
      tenantId: 'account-1',
      params: { filename: 'customer-document.pdf' },
    };

    await requireCustomerOwnedDocument(req as Request, mockResponse() as Response, next as NextFunction);

    expect(resolveCustomerPolicyAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ primaryAccountId: 'account-1' }),
      'policy-1',
    );
    expect(next).toHaveBeenCalledOnce();
  });
});

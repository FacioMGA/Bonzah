import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runWithOperatingTenant,
  withoutOperatingTenantForTest,
} from '../../../../platform/tenant/tenantAls.js';
import type { TenantConfig } from '../../../../platform/tenant/tenantConfig.js';

// ADR-0019: vitest setup installs a default CY tenant ALS for the test
// worker. Tests that assert the localhost-default URL fallback (i.e. no
// ALS bound) wrap their bodies via this helper.
const itNoTenant = (name: string, fn: () => void | Promise<void>) =>
  it(name, () => withoutOperatingTenantForTest(fn));

const { prisma, tenantScopedPrisma, tx } = vi.hoisted(() => {
  const tx = {
    claimInfoRequest: {
      create: vi.fn(),
    },
  };
  const prisma = {
    claim: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  return {
    tx,
    prisma,
    tenantScopedPrisma: prisma,
  };
});

const { dispatchCustomerEmailTrigger } = vi.hoisted(() => ({
  dispatchCustomerEmailTrigger: vi.fn(),
}));

const { appendClaimEvent } = vi.hoisted(() => ({
  appendClaimEvent: vi.fn(),
}));

vi.mock('../../../../platform/db/connection.js', () => ({
  prisma,
  tenantScopedPrisma,
}));

vi.mock('../../../communications/app/customerEmailTriggerService.js', () => ({
  dispatchCustomerEmailTrigger,
}));

vi.mock('../../domain/commands/shared.js', () => ({
  appendClaimEvent,
}));

import { createClaimInfoRequest } from '../claimInfoRequestService.js';

describe('createClaimInfoRequest', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns a contact-email error when no recipient can be resolved', async () => {
    tenantScopedPrisma.claim.findUnique.mockResolvedValueOnce({
      id: 'claim-1',
      claimNumber: 'CLM-1',
      data: { caseIntakeDraft: {} },
      policy: null,
    });

    const result = await createClaimInfoRequest({
      claimId: 'claim-1',
      message: 'Please confirm the incident details.',
      requestedByUserId: 'user-1',
      requestedByName: 'Ops User',
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      code: 'CONTACT_EMAIL_REQUIRED',
      message: 'A contact email is required before requesting more information.',
    });
    expect(dispatchCustomerEmailTrigger).not.toHaveBeenCalled();
  });

  it('queues reply-by-email content for unlinked claims, persists the request, and appends a timeline event', async () => {
    tenantScopedPrisma.claim.findUnique.mockResolvedValueOnce({
      id: 'claim-1',
      claimNumber: 'CLM-1',
      policyId: null,
      data: {
        caseIntakeDraft: {
          contactName: 'Maria Nicolaou',
          contactEmail: 'maria@example.com',
        },
      },
      policy: null,
    });
    dispatchCustomerEmailTrigger.mockResolvedValueOnce({ messageId: 'msg-1' });
    tx.claimInfoRequest.create.mockResolvedValueOnce({
      id: 'req-1',
      claimId: 'claim-1',
      status: 'OPEN',
      message: 'Please confirm the incident address.',
    });

    const result = await createClaimInfoRequest({
      claimId: 'claim-1',
      message: 'Please confirm the incident address.',
      requestedByUserId: 'user-1',
      requestedByName: 'Ops User',
    });

    expect(dispatchCustomerEmailTrigger).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'CLAIMS_INFO_REQUEST_UNLINKED',
      entityType: 'CLAIM',
      entityId: 'claim-1',
      toEmail: 'maria@example.com',
      variables: expect.objectContaining({
        claim: expect.objectContaining({
          message: 'Please confirm the incident address.',
          referenceLine: 'Claim reference: CLM-1',
        }),
      }),
    }));
    expect(tx.claimInfoRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        claimId: 'claim-1',
        message: 'Please confirm the incident address.',
        requestedByUserId: 'user-1',
      }),
    }));
    expect(appendClaimEvent).toHaveBeenCalledWith(expect.objectContaining({
      claimId: 'claim-1',
      claimNumber: 'CLM-1',
      command: 'REQUEST_CLAIM_INFO',
      eventType: 'CLAIM_INFO_REQUESTED',
      payload: expect.objectContaining({
        requestId: 'req-1',
        recipient: 'maria@example.com',
        deliveryStatus: 'QUEUED',
      }),
    }));
    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        id: 'req-1',
        recipientEmail: 'maria@example.com',
        deliveryStatus: 'QUEUED',
        messageId: 'msg-1',
      }),
    });
  });

  it('emits the linked-claim url with the operating tenant publicBaseUrl, NOT with PUBLIC_APP_BASE_URL (multi-tenant link safety)', async () => {
    const PT: TenantConfig = {
      id: '00000000-0000-4000-8000-000000000002',
      tenantSlug: 'abbeygate-pt',
      countryCode: 'PT',
      country: 'Portugal',
      currency: 'EUR',
      ipt: { rate: 0.09 },
      adminFee: 18,
      legalPack: 'pt',
      publicBaseUrl: 'https://abbeygate-pt.facio.io',
      fromEmail: 'no-reply@abbeygate.pt',
      brandLogo: { white: '', blue: '' },
    };
    // Hostile env: simulate a deploy where the global env points at the
    // wrong tenant. The ALS-bound operating tenant must still win.
    const PUBLIC_ENV_KEYS = ['PUBLIC_APP_BASE_URL', 'FRONTEND_URL', 'APP_URL', 'APP_BASE_URL'] as const;
    const envBackup: Record<string, string | undefined> = {};
    for (const k of PUBLIC_ENV_KEYS) {
      envBackup[k] = process.env[k];
      process.env[k] = 'https://abbeygate-cy.facio.io';
    }

    try {
      tenantScopedPrisma.claim.findUnique.mockResolvedValueOnce({
        id: 'claim-pt-1',
        claimNumber: 'CLM-PT-1',
        policyId: 'policy-1',
        data: {
          caseIntakeDraft: {
            contactName: 'Maria',
            contactEmail: 'maria@example.pt',
          },
        },
        policy: {
          policyHolder: { name: 'Maria', contact: 'maria@example.pt' },
        },
      });
      dispatchCustomerEmailTrigger.mockResolvedValueOnce({ messageId: 'msg-pt-1' });
      tx.claimInfoRequest.create.mockResolvedValueOnce({
        id: 'req-pt-1',
        claimId: 'claim-pt-1',
        status: 'OPEN',
        message: 'Please confirm.',
      });

      await runWithOperatingTenant(PT, async () => {
        await createClaimInfoRequest({
          claimId: 'claim-pt-1',
          message: 'Please confirm.',
          requestedByUserId: 'user-1',
          requestedByName: 'Ops User',
        });
      });

      expect(dispatchCustomerEmailTrigger).toHaveBeenCalledWith(expect.objectContaining({
        trigger: 'CLAIMS_INFO_REQUEST',
        variables: expect.objectContaining({
          claim: expect.objectContaining({
            url: 'https://abbeygate-pt.facio.io/claims/claim-pt-1#overview',
          }),
        }),
      }));
      expect(dispatchCustomerEmailTrigger).not.toHaveBeenCalledWith(expect.objectContaining({
        variables: expect.objectContaining({
          claim: expect.objectContaining({
            url: expect.stringContaining('abbeygate-cy'),
          }),
        }),
      }));
    } finally {
      for (const k of PUBLIC_ENV_KEYS) {
        const prev = envBackup[k];
        if (prev === undefined) delete process.env[k];
        else process.env[k] = prev;
      }
    }
  });

  itNoTenant('keeps the linked-claim info request email contract with the claim url', async () => {
    tenantScopedPrisma.claim.findUnique.mockResolvedValueOnce({
      id: 'claim-3',
      claimNumber: 'CLM-3',
      policyId: 'policy-1',
      data: {
        caseIntakeDraft: {
          contactName: 'Maria Nicolaou',
          contactEmail: 'maria@example.com',
        },
      },
      policy: {
        policyHolder: {
          name: 'Maria Nicolaou',
          contact: 'maria@example.com',
        },
      },
    });
    dispatchCustomerEmailTrigger.mockResolvedValueOnce({ messageId: 'msg-3' });
    tx.claimInfoRequest.create.mockResolvedValueOnce({
      id: 'req-3',
      claimId: 'claim-3',
      status: 'OPEN',
      message: 'Please confirm the policy details.',
    });

    await createClaimInfoRequest({
      claimId: 'claim-3',
      message: 'Please confirm the policy details.',
      requestedByUserId: 'user-1',
      requestedByName: 'Ops User',
    });

    expect(dispatchCustomerEmailTrigger).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'CLAIMS_INFO_REQUEST',
      variables: expect.objectContaining({
        claim: expect.objectContaining({
          url: 'http://localhost:5173/claims/claim-3#overview',
        }),
      }),
    }));
  });

  it('still persists the request when email delivery cannot be queued', async () => {
    tenantScopedPrisma.claim.findUnique.mockResolvedValueOnce({
      id: 'claim-1',
      claimNumber: 'CLM-1',
      policyId: null,
      data: {
        caseIntakeDraft: {
          contactName: 'Maria Nicolaou',
          contactEmail: 'maria@example.com',
        },
      },
      policy: null,
    });
    dispatchCustomerEmailTrigger.mockResolvedValueOnce({ skipped: true, reason: 'Missing template' });
    tx.claimInfoRequest.create.mockResolvedValueOnce({
      id: 'req-2',
      claimId: 'claim-1',
      status: 'OPEN',
      message: 'Please share the policy schedule.',
    });

    const result = await createClaimInfoRequest({
      claimId: 'claim-1',
      message: 'Please share the policy schedule.',
      requestedByUserId: 'user-1',
      requestedByName: 'Ops User',
    });

    expect(tx.claimInfoRequest.create).toHaveBeenCalled();
    expect(appendClaimEvent).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        requestId: 'req-2',
        recipient: 'maria@example.com',
        deliveryStatus: 'FAILED',
        failureReason: 'Missing template',
      }),
    }));
    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        id: 'req-2',
        recipientEmail: 'maria@example.com',
        deliveryStatus: 'FAILED',
        warning: 'Missing template',
      }),
    });
  });
});

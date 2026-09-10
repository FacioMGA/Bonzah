import { describe, expect, it } from 'vitest';
import { evaluateAuthorityWindowBlockers } from '../authorityWindow.js';
import type { IssueReadinessRepository } from '../../issueReadinessRepositoryPort.js';

type AuthorityWindowContext = NonNullable<Awaited<ReturnType<IssueReadinessRepository['findAuthorityWindowContext']>>>;

const EXPIRED_BINDER_CONTEXT: AuthorityWindowContext = {
  policy: {
    id: 'policy-1',
    inceptionDate: new Date('2025-07-01T00:00:00.000Z'),
    stateCurrent: null,
  },
  program: {
    id: 'program-travel',
    status: 'ACTIVE',
    effectiveFrom: null,
    effectiveTo: null,
    name: 'Travel',
  },
  binder: {
    id: 'TRAVEL-24EEA6153',
    status: 'EXPIRED',
    startDate: new Date('2024-11-15T00:00:00.000Z'),
    endDate: new Date('2025-11-14T23:59:59.999Z'),
    agreementNumber: '24EEA6153',
  },
  binderAuthority: {
    id: 'authority-travel-2024',
    status: 'ACTIVE',
    effectiveFrom: new Date('2024-11-15T00:00:00.000Z'),
    effectiveTo: new Date('2025-11-14T23:59:59.999Z'),
  },
};

function repositoryFor(context: AuthorityWindowContext): IssueReadinessRepository {
  return {
    findAuthorityWindowContext: async () => context,
    findPolicyForIssueReadiness: async () => null,
    findBoundInceptionTransaction: async () => null,
    findGeneratedIssuedDocuments: async () => [],
    findLatestGeneratedIssuedDocumentTimestamp: async () => null,
    findLatestIssuedPackFailureEvent: async () => null,
    findLatestPaidPayment: async () => null,
    findPaymentEvent: async () => null,
    findLatestPaymentFailureEvent: async () => null,
    findRiskTransactionContext: async () => null,
  };
}

describe('evaluateAuthorityWindowBlockers historical BDX import', () => {
  it('allows a committed BDX import to issue on a date-valid expired binder', async () => {
    const blockers = await evaluateAuthorityWindowBlockers(
      repositoryFor({
        ...EXPIRED_BINDER_CONTEXT,
        policy: {
          ...EXPIRED_BINDER_CONTEXT.policy,
          stateCurrent: {
            snapshot: {
              bdxImport: {
                dryRun: false,
                sourceHash: 'source-hash',
              },
            },
          },
        },
      }),
      'policy-1',
      'TRAVEL',
    );

    expect(blockers.find((blocker) => blocker.code === 'BINDER_NOT_ACTIVE')).toBeUndefined();
    expect(blockers.find((blocker) => blocker.code === 'BINDER_OUT_OF_WINDOW')).toBeUndefined();
  });

  it('still blocks ordinary policies on an expired binder', async () => {
    const blockers = await evaluateAuthorityWindowBlockers(
      repositoryFor(EXPIRED_BINDER_CONTEXT),
      'policy-1',
      'TRAVEL',
    );

    expect(blockers.find((blocker) => blocker.code === 'BINDER_NOT_ACTIVE')).toBeDefined();
  });

  it('still blocks committed BDX imports when the binder window does not cover inception', async () => {
    const blockers = await evaluateAuthorityWindowBlockers(
      repositoryFor({
        ...EXPIRED_BINDER_CONTEXT,
        policy: {
          ...EXPIRED_BINDER_CONTEXT.policy,
          inceptionDate: new Date('2026-01-01T00:00:00.000Z'),
          stateCurrent: { snapshot: { bdxImport: { dryRun: false } } },
        },
      }),
      'policy-1',
      'TRAVEL',
    );

    expect(blockers.find((blocker) => blocker.code === 'BINDER_NOT_ACTIVE')).toBeUndefined();
    expect(blockers.find((blocker) => blocker.code === 'BINDER_OUT_OF_WINDOW')).toBeDefined();
  });
});

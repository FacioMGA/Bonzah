import type { UnknownRecord } from './issueReadinessGuards.js';

type DateLike = Date | string | null;

export type IssueReadinessPolicy = UnknownRecord & {
  id: string;
  policyNumber?: string | null;
  productType?: string | null;
  status?: string | null;
  isLocked?: boolean | null;
  inceptionDate?: DateLike;
  expiryDate?: DateLike;
  quoteData?: unknown;
  quoteResponse?: unknown;
  stateCurrent?: { snapshot?: unknown } | null;
  payments?: UnknownRecord[];
  paymentStatus?: string | null;
};

export type IssueReadinessRepository = {
  findPolicyForIssueReadiness(policyId: string): Promise<IssueReadinessPolicy | null>;
  findAuthorityWindowContext(policyId: string, productCode: string | null): Promise<{
    policy: { id: string; inceptionDate?: Date | null; stateCurrent?: { snapshot?: unknown } | null };
    program?: { id: string; status?: unknown; effectiveFrom?: Date | null; effectiveTo?: Date | null; name?: unknown } | null;
    binder?: { id: string; status?: unknown; startDate?: Date | null; endDate?: Date | null; agreementNumber?: unknown } | null;
    binderAuthority?: { id: string; status?: unknown; effectiveFrom?: Date | null; effectiveTo?: Date | null } | null;
  } | null>;
  findBoundInceptionTransaction(policyId: string): Promise<{ id: string } | null>;
  findGeneratedIssuedDocuments(policyId: string, requiredIssuedDocTypes: string[]): Promise<Array<{ type?: unknown }>>;
  findLatestGeneratedIssuedDocumentTimestamp(policyId: string): Promise<Date | null>;
  findLatestIssuedPackFailureEvent(policyId: string): Promise<{ eventType: string; receivedAt: Date; payload?: unknown } | null>;
  findLatestPaidPayment(policyId: string): Promise<{ id: string; createdAt: Date } | null>;
  findPaymentEvent(paymentId: string, eventType: string): Promise<{ paymentId: string } | null>;
  findLatestPaymentFailureEvent(paymentId: string, eventType: string): Promise<{ receivedAt: Date; payload?: unknown } | null>;
  findRiskTransactionContext(riskTransactionId: string, policyId: string): Promise<{
    id: string;
    status?: unknown;
    transactionType?: unknown;
    snapshotDraft?: unknown;
    snapshotFinal?: unknown;
  } | null>;
};

let configuredRepository: IssueReadinessRepository | null = null;

export function configureIssueReadinessRepository(repository: IssueReadinessRepository): void {
  configuredRepository = repository;
}

export function getIssueReadinessRepository(): IssueReadinessRepository {
  if (!configuredRepository) {
    throw new Error('Issue-readiness repository has not been configured by the app layer.');
  }
  return configuredRepository;
}

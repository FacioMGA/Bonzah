import { Feed as PolicyFeed } from '../../feed/views/FeedTab';

/**
 * The workflow-history modal is a second view of the canonical policy audit
 * feed. It must not synthesize lifecycle rows or actor identities locally.
 */
export function PolicyWorkflowHistory({ policyId }: { policyId?: string }) {
  return <PolicyFeed policyId={policyId} />;
}

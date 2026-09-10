import { prisma } from '../../../platform/db/connection.js';
import {
  mergeIssueReadinessProjection,
  type IssueReadinessProjection,
} from '../domain/issueReadinessUpdater.js';

export async function setIssueReadiness(
  policyId: string,
  patch: Partial<Omit<IssueReadinessProjection, 'version' | 'updatedAt' | 'customerOutcome'>> & { failureCode?: string },
  tx: Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'> = prisma
) {
  const policy = await tx.policy.findUnique({
    where: { id: policyId },
    select: { issueReadiness: true }
  });
  if (!policy) return null;

  const merged = mergeIssueReadinessProjection(policy.issueReadiness, patch);
  if (!merged.changed) return merged.current;
  const next = merged.next;
  await tx.policy.update({
    where: { id: policyId },
    data: { issueReadiness: next }
  });
  return next;
}

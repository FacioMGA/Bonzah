type UseCaseResult = {
  status: number;
  body: Record<string, unknown>;
};

type PolicyLinkage = {
  policyHolderId: string | null;
  binderId: string | null;
};

export type GetPolicyFeedInput = {
  policyId: string;
  tenantId: string;
};

export type GetPolicyFeedRepoPort = {
  findPolicyLinkage(args: { policyId: string; tenantId: string }): Promise<PolicyLinkage | null>;
  listAuditFeedByEntityIds(entityIds: string[]): Promise<Array<Record<string, unknown>>>;
};

export type GetPolicyFeedRulesPort = {
  dedupePolicyFeedRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>>;
};

export async function getPolicyFeedUseCase(
  input: GetPolicyFeedInput,
  deps: {
    repo: GetPolicyFeedRepoPort;
    rules: GetPolicyFeedRulesPort;
  }
): Promise<UseCaseResult> {
  const policy = await deps.repo.findPolicyLinkage({ policyId: input.policyId, tenantId: input.tenantId });
  const relatedIds = [input.policyId];
  if (policy?.policyHolderId) relatedIds.push(policy.policyHolderId);
  if (policy?.binderId) relatedIds.push(policy.binderId);

  const feed = await deps.repo.listAuditFeedByEntityIds(relatedIds);
  const dedupedFeed = deps.rules.dedupePolicyFeedRows(feed);
  return { status: 200, body: { success: true, data: dedupedFeed } };
}

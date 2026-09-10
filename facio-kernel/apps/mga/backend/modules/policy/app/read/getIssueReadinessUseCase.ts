type UseCaseResult = {
  status: number;
  body: Record<string, unknown>;
};

export type GetIssueReadinessInput = {
  policyId: string;
  channel: 'bo' | 'customer';
  riskTransactionId: string | null;
};

export type GetIssueReadinessPort = {
  evaluateIssueReadiness(
    policyId: string,
    channel: 'bo' | 'customer',
    opts: { riskTransactionId: string | null }
  ): Promise<unknown>;
};

export async function getIssueReadinessUseCase(
  input: GetIssueReadinessInput,
  deps: {
    service: GetIssueReadinessPort;
  }
): Promise<UseCaseResult> {
  const readiness = await deps.service.evaluateIssueReadiness(
    input.policyId,
    input.channel,
    { riskTransactionId: input.riskTransactionId }
  );
  return { status: 200, body: { success: true, data: readiness } };
}

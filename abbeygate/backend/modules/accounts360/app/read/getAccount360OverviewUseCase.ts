type UseCaseResult = {
  status: number;
  body: Record<string, unknown>;
};

export async function getAccount360OverviewUseCase(
  accountId: string,
  deps: {
    repo: {
      getSummary(accountId: string): Promise<Record<string, unknown> | null>;
      getPortfolio(accountId: string): Promise<Record<string, unknown> | null>;
      listOpenAlerts(accountId: string): Promise<Array<Record<string, unknown>>>;
      listRecentFeed(accountId: string, limit: number): Promise<Array<Record<string, unknown>>>;
    };
  }
): Promise<UseCaseResult> {
  const id = String(accountId || '').trim();
  if (!id) {
    return {
      status: 400,
      body: { success: false, error: { code: 'VALIDATION_ERROR', message: 'Account id is required' } },
    };
  }

  const [summary, portfolio, alerts, feed] = await Promise.all([
    deps.repo.getSummary(id),
    deps.repo.getPortfolio(id),
    deps.repo.listOpenAlerts(id),
    deps.repo.listRecentFeed(id, 20),
  ]);

  if (!summary) {
    return {
      status: 404,
      body: { success: false, error: { code: 'NOT_FOUND', message: 'Account projection not found' } },
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      data: {
        summary,
        portfolio,
        alerts,
        feed,
      },
    },
  };
}

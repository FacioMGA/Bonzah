type UseCaseResult = {
  status: number;
  body: Record<string, unknown>;
};

export type ListBindersDeps = {
  repo: {
    listBinders(): Promise<Array<Record<string, unknown>>>;
  };
};

export async function listBindersUseCase(deps: ListBindersDeps): Promise<UseCaseResult> {
  const binders = await deps.repo.listBinders();
  return {
    status: 200,
    body: { success: true, data: binders },
  };
}

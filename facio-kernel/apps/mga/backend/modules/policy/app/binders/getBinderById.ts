type UseCaseResult = {
  status: number;
  body: Record<string, unknown>;
};

export type GetBinderByIdInput = {
  binderId: string;
};

export type GetBinderByIdDeps = {
  repo: {
    findBinderById(id: string): Promise<Record<string, unknown> | null>;
  };
};

export async function getBinderByIdUseCase(
  input: GetBinderByIdInput,
  deps: GetBinderByIdDeps
): Promise<UseCaseResult> {
  const binder = await deps.repo.findBinderById(input.binderId);
  if (!binder) {
    return {
      status: 404,
      body: {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Binder not found' },
      },
    };
  }

  return {
    status: 200,
    body: { success: true, data: binder },
  };
}

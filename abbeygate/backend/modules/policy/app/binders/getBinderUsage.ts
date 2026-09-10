type UseCaseResult = {
  status: number;
  body: Record<string, unknown>;
};

export type GetBinderUsageInput = {
  binderId: string;
};

export type GetBinderUsageDeps = {
  repo: {
    findBinderById(id: string): Promise<{ id: string } | null>;
    listProgramLinksByBinderId(
      binderId: string
    ): Promise<
      Array<{
        id: string;
        status: string;
        programId: string;
        programName: string | null;
        programStatus: string | null;
        mapping: unknown;
        updatedAt: Date;
      }>
    >;
  };
};

export async function getBinderUsageUseCase(
  input: GetBinderUsageInput,
  deps: GetBinderUsageDeps
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

  const links = await deps.repo.listProgramLinksByBinderId(input.binderId);
  return {
    status: 200,
    body: {
      success: true,
      data: links.map((link) => ({
        id: link.id,
        status: link.status,
        programId: link.programId,
        programName: link.programName || null,
        programStatus: link.programStatus || null,
        mapping: link.mapping || null,
        updatedAt: link.updatedAt,
      })),
    },
  };
}

import { buildReportingPeriods } from '../../domain/binders/reportingPeriodsPolicy.js';

type UseCaseResult = {
  status: number;
  body: Record<string, unknown>;
};

export type PublishBinderInput = {
  binderId: string;
};

export type PublishBinderDeps = {
  repo: {
    findBinderById(id: string): Promise<{
      id: string;
      agreementNumber: string | null;
      startDate: Date | null;
      endDate: Date | null;
    } | null>;
    publishBinderWithPeriods(args: {
      binderId: string;
      periods: Array<{
        binderId: string;
        year: number;
        month: number;
        startDate: Date;
        endDate: Date;
        status: 'OPEN';
      }>;
    }): Promise<void>;
  };
  logger: {
    info(message: string): void;
  };
};

export async function publishBinderUseCase(
  input: PublishBinderInput,
  deps: PublishBinderDeps
): Promise<UseCaseResult> {
  const binder = await deps.repo.findBinderById(input.binderId);
  if (!binder) {
    return { status: 404, body: { success: false, error: 'Binder not found' } };
  }

  if (!binder.startDate || !binder.endDate) {
    return {
      status: 400,
      body: {
        success: false,
        error: 'Binder must have valid Start and End dates to be published.',
      },
    };
  }

  const periods = buildReportingPeriods(input.binderId, binder.startDate, binder.endDate);
  await deps.repo.publishBinderWithPeriods({
    binderId: input.binderId,
    periods,
  });

  deps.logger.info(
    `✅ [Binder Publish] Binder ${binder.agreementNumber} published. Generated ${periods.length} reporting periods.`
  );

  return {
    status: 200,
    body: {
      success: true,
      data: {
        id: input.binderId,
        status: 'ACTIVE',
        reportingPeriodsCreated: periods.length,
        message: `Published binder ${binder.agreementNumber || input.binderId}.`,
      },
    },
  };
}

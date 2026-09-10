type UseCaseResult = {
  status: number;
  body: Record<string, unknown>;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value !== null && typeof value === 'object' ? (value as UnknownRecord) : {};

const asStringOrDefault = (value: unknown, fallback: string): string => {
  const next = String(value ?? '').trim();
  return next || fallback;
};

const asDateOrNull = (value: unknown): Date | null => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export type CreateBinderInput = {
  payload: Record<string, unknown>;
  actor: { actorId: string; actorType: 'USER' | 'SYSTEM' };
};

export type CreateBinderDeps = {
  repo: {
    createBinder(data: {
      coverholderName: string;
      coverholderPin: null;
      umr: string;
      agreementNumber: string;
      lloydsReportingVer: string;
      defaultCurrency: string;
      settlementCurrency: string;
      startDate: Date | null;
      endDate: Date | null;
      status: string;
      config: unknown;
    }): Promise<Record<string, unknown>>;
  };
  audit: {
    logBinderCreated(args: {
      binderId: string;
      actorId: string;
      actorType: 'USER' | 'SYSTEM';
      agreementNumber: string;
      umr: string;
      status: string;
    }): Promise<void>;
  };
};

export async function createBinderUseCase(
  input: CreateBinderInput,
  deps: CreateBinderDeps
): Promise<UseCaseResult> {
  const body = asRecord(input.payload);
  const config = asRecord(body.config);
  const agreement = asRecord(config.agreement);
  const financials = asRecord(config.financials);
  const period = asRecord(agreement.period);
  const coverholders = Array.isArray(agreement.coverholders)
    ? (agreement.coverholders as unknown[])
    : [];
  const primaryCoverholder = asRecord(coverholders[0]);

  const binder = await deps.repo.createBinder({
    coverholderName: asStringOrDefault(
      primaryCoverholder.name || body.coverholderName,
      'New Coverholder'
    ),
    coverholderPin: null,
    umr: asStringOrDefault(agreement.umr, 'TBD'),
    agreementNumber: asStringOrDefault(
      agreement.agreementNumber || body.agreementNumber,
      'TBD'
    ),
    lloydsReportingVer: 'V5.2',
    defaultCurrency: asStringOrDefault(financials.currency, 'USD'),
    settlementCurrency: asStringOrDefault(financials.currency, 'USD'),
    startDate: asDateOrNull(period.inceptionDate ?? body.startDate),
    endDate: asDateOrNull(period.expiryDate ?? body.endDate),
    status: asStringOrDefault(agreement.status || body.status, 'DRAFT'),
    config: body.config ?? {},
  });

  const binderRow = asRecord(binder);
  const binderId = String(binderRow.id || '');
  const agreementNumber = asStringOrDefault(binderRow.agreementNumber, 'TBD');
  const umr = asStringOrDefault(binderRow.umr, 'TBD');
  const status = asStringOrDefault(binderRow.status, 'DRAFT');

  await deps.audit.logBinderCreated({
    binderId,
    actorId: input.actor.actorId,
    actorType: input.actor.actorType,
    agreementNumber,
    umr,
    status,
  });

  return {
    status: 200,
    body: { success: true, data: binder },
  };
}

type UseCaseResult = {
  status: number;
  body: Record<string, unknown>;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value !== null && typeof value === 'object' ? (value as UnknownRecord) : {};

const asNullableString = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const next = String(value).trim();
  return next === '' ? null : next;
};

const asNumberOrUndefined = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const asNumberOrNull = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

type SyncPartyRow = {
  id?: string | null;
  role: string;
  partySubtype?: string | null;
  name: string;
  registrationNumber?: string | null;
  address?: unknown;
  contact?: unknown;
  rolesMeta?: unknown;
};

export type UpdateBinderInput = {
  binderId: string;
  payload: Record<string, unknown>;
  actor: { actorId: string; actorType: 'USER' | 'SYSTEM' };
};

export type UpdateBinderDeps = {
  repo: {
    findBinderForUpdate(id: string): Promise<{
      id: string;
      coverholderName: string | null;
      coverholderPin: string | null;
      agreementNumber: string | null;
      umr: string | null;
      lloydsReportingVer: string | null;
      defaultCurrency: string | null;
      settlementCurrency: string | null;
      startDate: Date | null;
      endDate: Date | null;
      status: string | null;
    } | null>;
    updateBinder(args: {
      binderId: string;
      data: {
        coverholderName: string;
        coverholderPin: string | null;
        agreementNumber: string;
        umr: string;
        lloydsReportingVer: string;
        defaultCurrency: string;
        settlementCurrency: string;
        startDate: Date | null;
        endDate: Date | null;
        status: string;
        config: unknown;
      };
    }): Promise<Record<string, unknown>>;
    syncBinderNormalized(args: {
      binderId: string;
      parties: SyncPartyRow[];
      financials:
        | {
            update: {
              maxLine?: number;
              grossPremiumLimit?: number;
              notifiablePercent?: number;
              commissionRate?: number;
            };
            create: {
              maxLine: number;
              grossPremiumLimit: number;
              notifiablePercent: number | null;
              commissionRate: number;
            };
          }
        | null;
      reporting:
        | {
            update: {
              writtenRiskSchedule?: string;
              paidClaimsSchedule?: string;
              bordereauFormat?: string;
              destination?: unknown;
            };
            create: {
              writtenRiskSchedule: string | null;
              paidClaimsSchedule: string | null;
              bordereauFormat: string | null;
              destination?: unknown;
              reportingContacts?: unknown;
            };
          }
        | null;
    }): Promise<void>;
  };
  audit: {
    logBinderSaved(args: {
      binderId: string;
      actorId: string;
      actorType: 'USER' | 'SYSTEM';
      agreementNumber: string;
      umr: string;
      status: string;
    }): Promise<void>;
  };
};

export async function updateBinderUseCase(
  input: UpdateBinderInput,
  deps: UpdateBinderDeps
): Promise<UseCaseResult> {
  const existing = await deps.repo.findBinderForUpdate(input.binderId);
  if (!existing) {
    return {
      status: 404,
      body: {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Binder not found' },
      },
    };
  }

  const body = asRecord(input.payload);
  const config = asRecord(body.config);
  const agreement = asRecord(config.agreement);
  const agreementPeriod = asRecord(agreement.period);
  const financials = asRecord(config.financials);
  const operations = asRecord(config.operations);
  const claims = asRecord(operations.claims);
  const authorizedTPA = asRecord(claims.authorizedTPA);
  const lloydsBroker = asRecord(agreement.lloydsBroker);
  const coverholders = Array.isArray(agreement.coverholders)
    ? (agreement.coverholders as unknown[])
    : [];
  const firstCoverholder = asRecord(coverholders[0]);

  const nextAgreement = String(
    body.agreementNumber || agreement.agreementNumber || existing.agreementNumber || 'TBD'
  );
  const nextUmr = String(agreement.umr || existing.umr || 'TBD');
  const nextName = String(
    body.coverholderName ||
      firstCoverholder.name ||
      existing.coverholderName ||
      'Coverholder'
  );

  const updated = await deps.repo.updateBinder({
    binderId: input.binderId,
    data: {
      coverholderName: nextName,
      coverholderPin: existing.coverholderPin,
      agreementNumber: nextAgreement,
      umr: nextUmr,
      lloydsReportingVer: String(existing.lloydsReportingVer || 'V5.2'),
      defaultCurrency: String(financials.currency ?? existing.defaultCurrency ?? 'USD'),
      settlementCurrency: String(financials.currency ?? existing.settlementCurrency ?? 'USD'),
      startDate: body.startDate
        ? new Date(String(body.startDate))
        : agreementPeriod.inceptionDate
          ? new Date(String(agreementPeriod.inceptionDate))
          : existing.startDate,
      endDate: body.endDate
        ? new Date(String(body.endDate))
        : agreementPeriod.expiryDate
          ? new Date(String(agreementPeriod.expiryDate))
          : existing.endDate,
      status: String(body.status ?? agreement.status ?? existing.status ?? 'DRAFT'),
      config: body.config ?? {},
    },
  });

  const parties: SyncPartyRow[] = [];
  coverholders.forEach((entry) => {
    const ch = asRecord(entry);
    parties.push({
      id: asNullableString(ch.id),
      role: 'coverholder',
      name: String(ch.name || ''),
      partySubtype: String(ch.role || '').toLowerCase() || null,
    });
  });
  if (Object.keys(lloydsBroker).length > 0) {
    parties.push({
      id: asNullableString(lloydsBroker.id),
      role: 'lloyds_broker',
      name: String(lloydsBroker.name || ''),
    });
  }
  if (Object.keys(authorizedTPA).length > 0) {
    parties.push({
      id: asNullableString(authorizedTPA.id),
      role: 'tpa',
      name: String(authorizedTPA.name || ''),
    });
  }

  const maxLine = undefined;
  const gpiLimit = financials.grossPremiumIncomeLimit;
  const financialsSync =
    Object.keys(financials).length > 0
      ? {
          update: {
            ...(asNumberOrUndefined(maxLine) !== undefined
              ? { maxLine: asNumberOrUndefined(maxLine) }
              : {}),
            ...(asNumberOrUndefined(gpiLimit) !== undefined
              ? { grossPremiumLimit: asNumberOrUndefined(gpiLimit) }
              : {}),
            ...(asNumberOrUndefined(financials.warningThresholdPercentage) !== undefined
              ? {
                  notifiablePercent: asNumberOrUndefined(
                    financials.warningThresholdPercentage
                  ),
                }
              : {}),
            ...(asNumberOrUndefined(financials.coverholderCommissionRate) !== undefined
              ? {
                  commissionRate: asNumberOrUndefined(
                    financials.coverholderCommissionRate
                  ),
                }
              : {}),
          },
          create: {
            maxLine: asNumberOrUndefined(maxLine) ?? 0,
            grossPremiumLimit: asNumberOrUndefined(gpiLimit) ?? 0,
            notifiablePercent: asNumberOrNull(financials.warningThresholdPercentage),
            commissionRate:
              asNumberOrUndefined(financials.coverholderCommissionRate) ?? 0,
          },
        }
      : null;

  const reportingRaw = asRecord(operations.reporting);
  const reportingSync =
    Object.keys(reportingRaw).length > 0
      ? {
          update: {
            ...(reportingRaw.writtenRiskSchedule
              ? { writtenRiskSchedule: String(reportingRaw.writtenRiskSchedule) }
              : {}),
            ...(reportingRaw.paidClaimsSchedule
              ? { paidClaimsSchedule: String(reportingRaw.paidClaimsSchedule) }
              : {}),
            ...(reportingRaw.bordereauFormat
              ? { bordereauFormat: String(reportingRaw.bordereauFormat) }
              : {}),
            ...(reportingRaw.destination
              ? { destination: reportingRaw.destination }
              : {}),
          },
          create: {
            writtenRiskSchedule: asNullableString(reportingRaw.writtenRiskSchedule),
            paidClaimsSchedule: asNullableString(reportingRaw.paidClaimsSchedule),
            bordereauFormat: asNullableString(reportingRaw.bordereauFormat),
            destination: reportingRaw.destination,
            reportingContacts: reportingRaw.reportingContacts,
          },
        }
      : null;

  await deps.repo.syncBinderNormalized({
    binderId: input.binderId,
    parties,
    financials: financialsSync,
    reporting: reportingSync,
  });

  const updatedRow = asRecord(updated);
  await deps.audit.logBinderSaved({
    binderId: input.binderId,
    actorId: input.actor.actorId,
    actorType: input.actor.actorType,
    agreementNumber: String(updatedRow.agreementNumber || ''),
    umr: String(updatedRow.umr || ''),
    status: String(updatedRow.status || ''),
  });

  return {
    status: 200,
    body: { success: true, data: updated },
  };
}

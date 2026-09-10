import { Prisma } from '@prisma/client';
import { createRequire } from 'module';
import Tesseract from 'tesseract.js';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { storageService } from '../../../platform/storage/service.js';
import { logger } from '../../../platform/utils/logger.js';
import type { CreateBinderDeps } from '../app/binders/createBinder.js';
import type { GetBinderByIdDeps } from '../app/binders/getBinderById.js';
import type { GetBinderUsageDeps } from '../app/binders/getBinderUsage.js';
import type { ListBindersDeps } from '../app/binders/listBinders.js';
import type { PublishBinderDeps } from '../app/binders/publishBinder.js';
import type { SimulateBinderCheckDeps } from '../app/binders/simulateBinderCheck.js';
import type { UploadBinderAgreementDeps } from '../app/binders/uploadBinderAgreement.js';
import type { UpdateBinderDeps } from '../app/binders/updateBinder.js';

const require = createRequire(import.meta.url);

type PdfParseResult = { text: string };

function loadPdfParser(): (buffer: Buffer) => Promise<PdfParseResult> {
  const pdf = require('pdf-parse');
  return pdf as (buffer: Buffer) => Promise<PdfParseResult>;
}

const toNullableJsonInput = (
  value: unknown
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
};

export function buildUploadBinderAgreementDeps(): UploadBinderAgreementDeps {
  return {
    parser: {
      async parsePdf(buffer: Buffer) {
        const parsePdf = loadPdfParser();
        return parsePdf(buffer);
      },
      async recognizeImage(buffer: Buffer, onProgress?: (progress: unknown) => void) {
        const result = await Tesseract.recognize(buffer, 'eng', {
          logger: (message) => {
            if (onProgress) onProgress(message);
          },
        });
        return { text: result.data.text };
      },
    },
    storage: {
      uploadFile(buffer: Buffer, filename: string, mimeType: string) {
        return storageService.uploadFile(buffer, filename, mimeType);
      },
    },
    repo: {
      async createBinder(data) {
        const binder = await tenantScopedPrisma.binder.create({
          data: {
            umr: data.umr,
            agreementNumber: data.agreementNumber,
            coverholderName: data.coverholderName,
            lloydsReportingVer: data.lloydsReportingVer,
            defaultCurrency: data.defaultCurrency,
            settlementCurrency: data.settlementCurrency,
            startDate: data.startDate,
            endDate: data.endDate,
            status: data.status,
            config: (data.config ?? {}) as Prisma.InputJsonValue,
          } as unknown as Prisma.BinderUncheckedCreateInput,
        });
        return {
          ...(binder as Record<string, unknown>),
          id: binder.id,
          agreementNumber: String(binder.agreementNumber || ''),
          umr: String(binder.umr || ''),
        };
      },
      async createBinderDocument(data) {
        await prisma.binderDocument.create({
          data: {
            binderId: data.binderId,
            type: data.type,
            name: data.name,
            filename: data.filename,
            storageUri: data.storageUri,
            mimeType: data.mimeType,
            sizeBytes: data.sizeBytes,
            meta: (data.meta ?? {}) as Prisma.InputJsonValue,
          },
        });
      },
      async createBinderClause(data) {
        await prisma.binderClause.create({
          data: {
            binderId: data.binderId,
            clauseType: data.clauseType,
            textFragment: data.textFragment,
            pointer: (data.pointer ?? {}) as Prisma.InputJsonValue,
            codes: data.codes,
            meta: (data.meta ?? {}) as Prisma.InputJsonValue,
          },
        });
      },
    },
    audit: {
      async logUploadedAndParsed(args) {
        await AuditLogger.log(
          args.binderId,
          'BINDER',
          'BINDER.UPLOADED_AND_PARSED',
          args.actorId,
          args.actorType,
          {
            agreementNumber: args.agreementNumber,
            umr: args.umr,
            document: args.document,
            codesFound: args.codesFound,
          }
        );
      },
    },
    logger: {
      info(message: string | Record<string, unknown>) {
        if (typeof message === 'string') {
          logger.info(message);
          return;
        }
        logger.info({ data: message }, 'Binder upload progress');
      },
      error(payload: Record<string, unknown>, message?: string) {
        logger.error(payload, message);
      },
    },
  };
}

export function buildPublishBinderDeps(): PublishBinderDeps {
  return {
    repo: {
      async findBinderById(id: string) {
        const binder = await tenantScopedPrisma.binder.findUnique({
          where: { id },
          select: {
            id: true,
            agreementNumber: true,
            startDate: true,
            endDate: true,
          },
        });
        if (!binder) return null;
        return binder;
      },
      async publishBinderWithPeriods(args) {
        await tenantScopedPrisma.$transaction(async (_tx) => {
          const tx = _tx as unknown as Prisma.TransactionClient;
          await tx.binder.update({
            where: { id: args.binderId },
            data: { status: 'ACTIVE' },
          });
          for (const period of args.periods) {
            await tx.reportingPeriod.upsert({
              where: {
                binderId_year_month: {
                  binderId: period.binderId,
                  year: period.year,
                  month: period.month,
                },
              },
              update: {},
              create: period,
            });
          }
        });
      },
    },
    logger: {
      info(message: string) {
        logger.info(message);
      },
    },
  };
}

export function buildCreateBinderDeps(): CreateBinderDeps {
  return {
    repo: {
      async createBinder(data) {
        const binder = await tenantScopedPrisma.binder.create({
          data: {
            coverholderName: data.coverholderName,
            coverholderPin: data.coverholderPin,
            umr: data.umr,
            agreementNumber: data.agreementNumber,
            lloydsReportingVer: data.lloydsReportingVer,
            defaultCurrency: data.defaultCurrency,
            settlementCurrency: data.settlementCurrency,
            startDate: data.startDate,
            endDate: data.endDate,
            status: data.status,
            config: (data.config ?? {}) as Prisma.InputJsonValue,
          } as unknown as Prisma.BinderUncheckedCreateInput,
        });
        return binder as Record<string, unknown>;
      },
    },
    audit: {
      async logBinderCreated(args) {
        await AuditLogger.log(
          args.binderId,
          'BINDER',
          'BINDER.CREATED',
          args.actorId,
          args.actorType,
          {
            agreementNumber: args.agreementNumber,
            umr: args.umr,
            status: args.status,
          }
        );
      },
    },
  };
}

export function buildUpdateBinderDeps(): UpdateBinderDeps {
  return {
    repo: {
      async findBinderForUpdate(id: string) {
        const binder = await tenantScopedPrisma.binder.findUnique({
          where: { id },
          select: {
            id: true,
            coverholderName: true,
            coverholderPin: true,
            agreementNumber: true,
            umr: true,
            lloydsReportingVer: true,
            defaultCurrency: true,
            settlementCurrency: true,
            startDate: true,
            endDate: true,
            status: true,
          },
        });
        if (!binder) return null;
        return binder;
      },
      async updateBinder(args) {
        const updated = await tenantScopedPrisma.binder.update({
          where: { id: args.binderId },
          data: {
            coverholderName: args.data.coverholderName,
            coverholderPin: args.data.coverholderPin,
            agreementNumber: args.data.agreementNumber,
            umr: args.data.umr,
            lloydsReportingVer: args.data.lloydsReportingVer,
            defaultCurrency: args.data.defaultCurrency,
            settlementCurrency: args.data.settlementCurrency,
            startDate: args.data.startDate,
            endDate: args.data.endDate,
            status: args.data.status,
            config: args.data.config as Prisma.InputJsonValue,
          },
        });
        return updated as Record<string, unknown>;
      },
      async syncBinderNormalized(args) {
        await tenantScopedPrisma.$transaction(async (_tx) => {
          const tx = _tx as unknown as Prisma.TransactionClient;
          await tx.binderParty.deleteMany({ where: { binderId: args.binderId } });
          if (args.parties.length) {
            await tx.binderParty.createMany({
              data: args.parties.map((party) => ({
                id: party.id || undefined,
                binderId: args.binderId,
                role: party.role,
                partySubtype: party.partySubtype || null,
                name: party.name,
                registrationNumber: party.registrationNumber || null,
                address: toNullableJsonInput(party.address),
                contact: toNullableJsonInput(party.contact),
                rolesMeta: toNullableJsonInput(party.rolesMeta),
              })),
              skipDuplicates: true,
            });
          }

          if (args.financials) {
            await tx.binderFinancials.upsert({
              where: { binderId: args.binderId },
              update: args.financials.update,
              create: {
                binderId: args.binderId,
                maxLine: args.financials.create.maxLine,
                grossPremiumLimit: args.financials.create.grossPremiumLimit,
                notifiablePercent: args.financials.create.notifiablePercent,
                commissionRate: args.financials.create.commissionRate,
                profitCommission: Prisma.JsonNull,
                premiumAccount: Prisma.JsonNull,
              },
            });
          }

          if (args.reporting) {
            const updateData: Prisma.BinderReportingUpdateInput = {
              ...(args.reporting.update.writtenRiskSchedule
                ? {
                    writtenRiskSchedule: args.reporting.update.writtenRiskSchedule,
                  }
                : {}),
              ...(args.reporting.update.paidClaimsSchedule
                ? {
                    paidClaimsSchedule: args.reporting.update.paidClaimsSchedule,
                  }
                : {}),
              ...(args.reporting.update.bordereauFormat
                ? { bordereauFormat: args.reporting.update.bordereauFormat }
                : {}),
              ...(args.reporting.update.destination
                ? { destination: args.reporting.update.destination as Prisma.InputJsonValue }
                : {}),
            };
            await tx.binderReporting.upsert({
              where: { binderId: args.binderId },
              update: updateData,
              create: {
                binderId: args.binderId,
                writtenRiskSchedule: args.reporting.create.writtenRiskSchedule || null,
                paidClaimsSchedule: args.reporting.create.paidClaimsSchedule || null,
                bordereauFormat: args.reporting.create.bordereauFormat || null,
                destination: args.reporting.create.destination
                  ? (args.reporting.create.destination as Prisma.InputJsonValue)
                  : Prisma.JsonNull,
                reportingContacts: args.reporting.create.reportingContacts
                  ? (args.reporting.create.reportingContacts as Prisma.InputJsonValue)
                  : Prisma.JsonNull,
              },
            });
          }
        });
      },
    },
    audit: {
      async logBinderSaved(args) {
        await AuditLogger.log(
          args.binderId,
          'BINDER',
          'BINDER.SAVED',
          args.actorId,
          args.actorType,
          {
            agreementNumber: args.agreementNumber,
            umr: args.umr,
            status: args.status,
          }
        );
      },
    },
  };
}

export function buildListBindersDeps(): ListBindersDeps {
  return {
    repo: {
      async listBinders() {
        const binders = await tenantScopedPrisma.binder.findMany({
          orderBy: { createdAt: 'desc' },
          include: {
            parties: {
              select: {
                role: true,
                name: true,
              },
            },
            financials: {
              select: {
                grossPremiumLimit: true,
                notifiablePercent: true,
              },
            },
            reportingConfig: {
              select: {
                writtenRiskSchedule: true,
                paidClaimsSchedule: true,
                bordereauFormat: true,
              },
            },
            productAuthorities: {
              select: {
                productCode: true,
                status: true,
                effectiveFrom: true,
                effectiveTo: true,
              },
            },
            _count: {
              select: {
                programLinks: true,
                policies: true,
                reportingPeriods: true,
              },
            },
          },
        });

        const binderIds = binders.map((binder) => binder.id);
        const premiumRows = binderIds.length
          ? await prisma.premiumTransaction.findMany({
              where: {
                riskTransaction: {
                  binderId: { in: binderIds },
                },
              },
              select: {
                grossPremium: true,
                riskTransaction: {
                  select: {
                    binderId: true,
                  },
                },
              },
            })
          : [];

        const writtenGrossByBinder = premiumRows.reduce<Record<string, number>>((acc, row) => {
          const binderId = String(row.riskTransaction?.binderId || '').trim();
          if (!binderId) return acc;
          const gross = Number(row.grossPremium || 0);
          if (!Number.isFinite(gross)) return acc;
          acc[binderId] = (acc[binderId] || 0) + gross;
          return acc;
        }, {});

        return binders.map((binder) => {
          const config = (binder.config || {}) as Record<string, unknown>;
          const scope = ((config.scope || {}) as Record<string, unknown>);
          const authority = ((config.authority || {}) as Record<string, unknown>);
          const financials = ((config.financials || {}) as Record<string, unknown>);
          const parties = Array.isArray(binder.parties) ? binder.parties : [];
          const capacityProvider = parties.find((party) => String(party.role || '').toUpperCase().includes('CAPACITY'));
          const coverholderSecondary = parties.find((party) => String(party.role || '').toUpperCase().includes('SECONDARY'));
          const leadCapacityProviderName =
            String(capacityProvider?.name || coverholderSecondary?.name || 'Lloyd’s Insurance Company S.A.');
          const authorizedClass = String(scope.authorizedClass || config.productType || 'Private Motor Insurance');
          const riskLocations = Array.isArray(scope.riskLocationCountries)
            ? scope.riskLocationCountries.map((x) => String(x).trim()).filter(Boolean)
            : [];
          const regionLabel = riskLocations[0] || String(authority.territorialLimits && Array.isArray(authority.territorialLimits) ? authority.territorialLimits[0] : 'Cyprus');
          const grossPremiumLimit =
            Number(binder.financials?.grossPremiumLimit || financials.grossPremiumIncomeLimit || 0);
          const gpiWarnThresholdPct =
            Number(binder.financials?.notifiablePercent || financials.warningThresholdPercentage || 85);
          const grossPremiumWritten = Number(writtenGrossByBinder[binder.id] || 0);
          const gpiUsagePct = grossPremiumLimit > 0 ? Math.round((grossPremiumWritten / grossPremiumLimit) * 10000) / 100 : null;
          const hasReportingConfig = Boolean(
            binder.reportingConfig
            && (
              binder.reportingConfig.writtenRiskSchedule
              || binder.reportingConfig.paidClaimsSchedule
              || binder.reportingConfig.bordereauFormat
            ),
          );
          const hasMissingConfig = !binder.startDate || !binder.endDate || !binder.umr || !binder.agreementNumber;

          return {
            ...binder,
            leadCapacityProviderName,
            authorizedClass,
            regionLabel,
            scopeLabel: regionLabel,
            grossPremiumWritten,
            grossPremiumLimit,
            gpiWarnThresholdPct,
            gpiUsagePct,
            hasReportingConfig,
            hasMissingConfig,
            policyCount: Number(binder._count?.policies || 0),
            programLinkCount: Number(binder._count?.programLinks || 0),
            reportingPeriodsCount: Number(binder._count?.reportingPeriods || 0),
          };
        }) as Array<Record<string, unknown>>;
      },
    },
  };
}

export function buildGetBinderByIdDeps(): GetBinderByIdDeps {
  return {
    repo: {
      async findBinderById(id: string) {
        const binder = await tenantScopedPrisma.binder.findUnique({
          where: { id },
          include: {
            documents: true,
            parties: true,
            coverages: true,
            clauses: true,
            financials: true,
            reportingConfig: true,
          },
        });
        return (binder as Record<string, unknown>) || null;
      },
    },
  };
}

export function buildGetBinderUsageDeps(): GetBinderUsageDeps {
  return {
    repo: {
      async findBinderById(id: string) {
        const binder = await tenantScopedPrisma.binder.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!binder) return null;
        return { id: binder.id };
      },
      async listProgramLinksByBinderId(binderId: string) {
        const links = await prisma.programBinderLink.findMany({
          where: { binderId },
          include: { program: true },
          orderBy: { updatedAt: 'desc' },
        });
        return links.map((link) => ({
          id: link.id,
          status: link.status,
          programId: link.programId,
          programName: link.program?.name || null,
          programStatus: link.program?.status || null,
          mapping: link.mapping,
          updatedAt: link.updatedAt,
        }));
      },
    },
  };
}

export function buildSimulateBinderCheckDeps(): SimulateBinderCheckDeps {
  return {
    repo: {
      async findBinderById(id: string) {
        const binder = await tenantScopedPrisma.binder.findUnique({
          where: { id },
          select: { id: true, config: true },
        });
        if (!binder) return null;
        return { id: binder.id, config: binder.config };
      },
      async listActiveProgramLinksByBinderId(binderId: string) {
        const links = await prisma.programBinderLink.findMany({
          where: { binderId, status: 'ACTIVE' },
          include: { program: true },
          orderBy: { updatedAt: 'desc' },
        });
        return links.map((link) => ({
          programStatus: link.program?.status || null,
        }));
      },
    },
  };
}

import { z } from 'zod';
import { id, scopeSchema } from './configuration.js';
import { dateOnlySchema } from './insurance.js';
import { currencySchema, minorUnitSchema } from './money.js';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid();
const capacity = z
  .array(
    z.strictObject({
      participantId: id,
      insurancePremiumMinor: minorUnitSchema,
      postedPremiumMinor: minorUnitSchema,
    }),
  )
  .max(10000);
const amounts = {
  externalPremiumMinor: minorUnitSchema,
  commissionAccruedMinor: minorUnitSchema,
  commissionReceivedMinor: minorUnitSchema,
  commissionOutstandingMinor: minorUnitSchema,
};
export const financialReportInputSchema = z.strictObject({
  effectiveAsOf: dateOnlySchema,
  recordedAsOf: z.string().datetime(),
  recordId: uuid.optional(),
});
export type FinancialReportInput = z.infer<typeof financialReportInputSchema>;
export const financialReportSchema = z.strictObject({
  reportVersion: z.literal('financial-as-of-v1'),
  reportHash: sha,
  scope: scopeSchema,
  selectedRecordId: uuid.nullable(),
  effectiveAsOf: dateOnlySchema,
  recordedAsOf: z.string().datetime(),
  accountingBasis: z.literal('synthetic_external_custody_commission_v1'),
  sourceClaims: z.literal('unverified'),
  records: z
    .array(
      z.strictObject({
        recordId: uuid,
        recordVersion: z.number().int().positive(),
        recordHash: sha,
        productId: id,
        externalQuoteReference: z.string().min(1).max(1000),
        sourceMode: z.enum(['manual_external_quote', 'configured_product']),
        status: z.enum(['bound', 'cancelled']),
        currency: currencySchema,
        effectiveDate: dateOnlySchema,
        recordedAt: z.string().datetime(),
        insurancePremiumMinor: minorUnitSchema,
        insuranceCommissionMinor: minorUnitSchema,
        posted: z.strictObject(amounts),
        capacity,
        unpostedVersions: z.array(z.number().int().positive()).max(1000),
      }),
    )
    .max(100),
  currencies: z
    .array(
      z.strictObject({
        currency: currencySchema,
        recordCount: z.number().int().nonnegative(),
        insurancePremiumMinor: minorUnitSchema,
        insuranceCommissionMinor: minorUnitSchema,
        ...amounts,
        capacity,
      }),
    )
    .max(5),
  journals: z
    .array(
      z.strictObject({
        journalId: uuid,
        journalHash: sha,
        recordId: uuid,
        insuranceVersion: z.number().int().positive(),
        insuranceHash: sha,
        effectiveDate: dateOnlySchema,
        recordedAt: z.string().datetime(),
        currency: currencySchema,
        kind: z.enum(['insurance_transaction', 'receipt_application', 'application_reversal']),
        ...amounts,
        capacity: z
          .array(z.strictObject({ participantId: id, premiumMinor: minorUnitSchema }))
          .max(100),
      }),
    )
    .max(1000),
  limitations: z.array(z.string().min(1).max(1000)),
});
export type FinancialReport = z.infer<typeof financialReportSchema>;
export const financeReportOperations = {
  finance_report: {
    method: 'GET',
    path: '/api/insurance/finance/report',
    permission: 'finance:read',
    summary:
      'Project immutable insurance and posted journals at explicit effective and recording cutoffs, with separate currency totals',
    input: financialReportInputSchema,
    output: financialReportSchema,
  },
  finance_report_export: {
    method: 'GET',
    path: '/api/insurance/finance/report/export',
    permission: 'finance:read',
    summary:
      'Export the matching scoped as-of projection and capacity/journal lineage; no customer BDX mapping or approval is claimed',
    input: financialReportInputSchema,
    output: z.strictObject({
      reportHash: sha,
      contentHash: sha,
      fileName: z.string().min(1).max(200),
      mediaType: z.literal('text/csv;charset=utf-8'),
      content: z.string().max(10_000_000),
      effectiveAsOf: dateOnlySchema,
      recordedAsOf: z.string().datetime(),
      totals: financialReportSchema.shape.currencies,
    }),
  },
} as const;

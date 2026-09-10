import { financeReportOperations } from './finance-report.js';
import { z } from 'zod';
import { id, scopeSchema } from './configuration.js';
import { currencySchema, minorUnitSchema } from './money.js';
import { dateOnlySchema } from './insurance.js';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(1000);
const refs = z.array(text).min(1).max(20);
const positive = minorUnitSchema.refine(
  (v) => minorUnitSchema.safeParse(v).success && BigInt(v) > 0n,
  'Amount must be positive',
);
const nonnegative = minorUnitSchema.refine(
  (v) => minorUnitSchema.safeParse(v).success && BigInt(v) >= 0n,
);
export const financeLineSchema = z
  .strictObject({
    book: z.enum(['financial', 'external_premium_control']),
    account: z.enum([
      'commission_receivable',
      'commission_income',
      'recorded_commission_cash',
      'external_premium',
      'external_capacity',
    ]),
    partyId: id,
    debitMinor: nonnegative,
    creditMinor: nonnegative,
  })
  .refine(
    (line) =>
      !minorUnitSchema.safeParse(line.debitMinor).success ||
      !minorUnitSchema.safeParse(line.creditMinor).success ||
      BigInt(line.debitMinor) > 0n !== BigInt(line.creditMinor) > 0n,
    'Each line has exactly one positive debit or credit',
  );
export const financeJournalSchema = z
  .strictObject({
    id: z.string().uuid(),
    scope: scopeSchema,
    recordId: z.string().uuid(),
    sequence: z.number().int().positive(),
    journalHash: sha,
    previousJournalHash: sha.nullable(),
    originKey: text,
    kind: z.enum(['insurance_transaction', 'receipt_application', 'application_reversal']),
    insuranceVersion: z.number().int().positive(),
    insuranceHash: sha,
    currency: currencySchema,
    effectiveDate: dateOnlySchema,
    occurredAt: z.string().datetime(),
    actorId: id,
    correlationId: z.string().uuid(),
    reason: text,
    evidenceRefs: refs,
    accountingBasis: z.literal('synthetic_external_custody_commission_v1'),
    lines: z.array(financeLineSchema).max(204),
  })
  .superRefine((journal, context) => {
    if (
      journal.lines.some(
        (line) =>
          !minorUnitSchema.safeParse(line.debitMinor).success ||
          !minorUnitSchema.safeParse(line.creditMinor).success,
      )
    )
      return;
    for (const book of ['financial', 'external_premium_control']) {
      const lines = journal.lines.filter((line) => line.book === book);
      if (
        lines.reduce(
          (sum, line) => sum + BigInt(line.debitMinor) - BigInt(line.creditMinor),
          0n,
        ) !== 0n
      )
        context.addIssue({
          code: 'custom',
          path: ['lines'],
          message: 'Each book must balance independently',
        });
    }
    if (
      journal.lines.some((line) =>
        line.book === 'financial'
          ? line.account.startsWith('external_')
          : !line.account.startsWith('external_'),
      )
    )
      context.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'External premium is never a financial cash or receivable entry',
      });
  });
export type FinanceJournal = z.infer<typeof financeJournalSchema>;
export const financeReceiptSchema = z.strictObject({
  id: z.string().uuid(),
  scope: scopeSchema,
  receiptHash: sha,
  intentHash: sha,
  sourceReference: text,
  payerId: id,
  currency: currencySchema,
  amountMinor: positive,
  receivedAt: z.string().datetime(),
  occurredAt: z.string().datetime(),
  actorId: id,
  correlationId: z.string().uuid(),
  reason: text,
  evidenceRefs: refs,
  provenance: z.literal('synthetic_training'),
});
export type FinanceReceipt = z.infer<typeof financeReceiptSchema>;
export const financeApplicationSchema = z.strictObject({
  id: z.string().uuid(),
  scope: scopeSchema,
  applicationHash: sha,
  recordId: z.string().uuid(),
  receiptId: z.string().uuid(),
  receiptHash: sha,
  journalId: z.string().uuid(),
  journalHash: sha,
  kind: z.enum(['apply', 'reverse']),
  reversesId: z.string().uuid().nullable(),
  amountMinor: positive,
  currency: currencySchema,
  occurredAt: z.string().datetime(),
  actorId: id,
  correlationId: z.string().uuid(),
  reason: text,
  evidenceRefs: refs,
});
export type FinanceApplication = z.infer<typeof financeApplicationSchema>;
export const financeLedgerSchema = z.strictObject({
  recordId: z.string().uuid(),
  recordVersion: z.number().int().positive(),
  recordHash: sha,
  ledgerHash: sha,
  currency: currencySchema,
  accountingBasis: z.literal('synthetic_external_custody_commission_v1'),
  sourceClaims: z.literal('unverified'),
  journals: z.array(financeJournalSchema).max(1000),
  applications: z.array(financeApplicationSchema).max(1000),
  receipts: z
    .array(
      z.strictObject({
        receipt: financeReceiptSchema,
        appliedMinor: nonnegative,
        unappliedMinor: nonnegative,
      }),
    )
    .max(1000),
  unpostedVersions: z.array(z.number().int().positive()).max(1000),
  totals: z.strictObject({
    externalPremiumMinor: minorUnitSchema,
    commissionAccruedMinor: minorUnitSchema,
    commissionReceivedMinor: minorUnitSchema,
    commissionOutstandingMinor: minorUnitSchema,
    recordedUnappliedReceiptMinor: nonnegative,
  }),
  capacity: z.array(z.strictObject({ participantId: id, premiumMinor: minorUnitSchema })).max(100),
  limitations: z.array(text),
});
export type FinanceLedger = z.infer<typeof financeLedgerSchema>;
const command = { idempotencyKey: z.string().uuid(), reason: text, evidenceRefs: refs };
const target = {
  recordId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  recordHash: sha,
};
export const financeOperations = {
  ...financeReportOperations,
  finance_ledger: {
    method: 'GET',
    path: '/api/insurance/finance/ledger',
    permission: 'finance:read',
    summary:
      'Inspect scoped balanced training journals, external premium control and commission reconciliation',
    input: z.strictObject({ recordId: z.string().uuid() }),
    output: financeLedgerSchema,
  },
  finance_post: {
    method: 'POST',
    path: '/api/insurance/finance/post',
    permission: 'finance:post',
    mcp: false,
    summary:
      'Recognize retained insurance transactions under the explicit synthetic external-custody accounting basis',
    input: z.strictObject({
      ...command,
      ...target,
      accountingBasis: z.literal('synthetic_external_custody_commission_v1'),
    }),
    output: financeLedgerSchema,
  },
  finance_record_receipt: {
    method: 'POST',
    path: '/api/insurance/finance/receipts',
    permission: 'finance:reconcile',
    mcp: false,
    summary:
      'Retain an unapplied synthetic commission receipt; no bank verification or insurance gate is granted',
    input: z.strictObject({
      ...command,
      sourceReference: text,
      payerId: id,
      currency: currencySchema,
      amountMinor: positive,
      receivedAt: z.string().datetime(),
      provenance: z.literal('synthetic_training'),
    }),
    output: financeReceiptSchema,
  },
  finance_apply_receipt: {
    method: 'POST',
    path: '/api/insurance/finance/applications',
    permission: 'finance:reconcile',
    mcp: false,
    summary:
      'Apply a retained synthetic receipt to the exact outstanding commission receivable without over-allocation',
    input: z.strictObject({
      ...command,
      ...target,
      expectedLedgerHash: sha,
      receiptId: z.string().uuid(),
      amountMinor: positive,
    }),
    output: financeLedgerSchema,
  },
  finance_reverse_application: {
    method: 'POST',
    path: '/api/insurance/finance/application/reverse',
    permission: 'finance:reconcile',
    mcp: false,
    summary:
      'Reverse an exact commission receipt application with retained correction and audit evidence',
    input: z.strictObject({
      ...command,
      ...target,
      expectedLedgerHash: sha,
      applicationId: z.string().uuid(),
    }),
    output: financeLedgerSchema,
  },
  finance_export: {
    method: 'GET',
    path: '/api/insurance/finance/export',
    permission: 'finance:read',
    summary:
      'Export exact scoped journal lineage with the same ledger hash and totals; this is not a BDX or regulatory report',
    input: z.strictObject({ recordId: z.string().uuid() }),
    output: z.strictObject({
      ledgerHash: sha,
      contentHash: sha,
      fileName: text,
      mediaType: z.literal('text/csv;charset=utf-8'),
      content: z.string().max(5_000_000),
      totals: financeLedgerSchema.shape.totals,
    }),
  },
} as const;
export type FinanceOperationName = keyof typeof financeOperations;

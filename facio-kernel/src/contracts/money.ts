import { z } from 'zod';
import { id } from './primitives.js';

/** Amounts cross every boundary as integer minor-unit strings, never JSON numbers. */
export const minorUnitSchema = z
  .string()
  .max(19)
  .regex(/^(?:0|-?[1-9][0-9]{0,17})$/, 'Use a canonical integer of at most 18 magnitude digits')
  .refine((value) => value === value.trim(), 'Money must not contain whitespace');

export const currencySchema = z.enum(['GBP', 'USD', 'EUR', 'JPY', 'KWD']);
export type Currency = z.infer<typeof currencySchema>;
/** This version supports these currency exponents explicitly; no implicit two-decimal default. */
export const currencyExponents = Object.freeze({ GBP: 2, USD: 2, EUR: 2, JPY: 0, KWD: 3 } as const);

const financialId = id.refine((value) => value === value.trim(), 'IDs must not contain whitespace');
const basisPoints = z.number().int().min(0).max(10_000);
const participationSchema = z.strictObject({
  id: financialId,
  role: z.enum(['lead', 'follow']),
  shareBps: basisPoints.min(1),
});
const commissionSchema = z.strictObject({
  rateBps: basisPoints,
  base: z.literal('gross_premium'),
  recipientId: financialId,
  settlementPartyId: financialId,
  cashCustody: z.literal('external'),
});

export const financialAllocationInputSchema = z
  .strictObject({
    currency: currencySchema,
    premiumMinor: minorUnitSchema,
    participants: z.array(participationSchema).min(1).max(100),
    commission: commissionSchema,
  })
  .superRefine((input, context) => {
    const participants = input.participants;
    if (new Set(participants.map((participant) => participant.id)).size !== participants.length)
      context.addIssue({
        code: 'custom',
        path: ['participants'],
        message: 'Participant IDs must be unique',
      });
    if (participants.filter((participant) => participant.role === 'lead').length !== 1)
      context.addIssue({
        code: 'custom',
        path: ['participants'],
        message: 'Exactly one lead participant is required',
      });
    if (participants.reduce((sum, participant) => sum + participant.shareBps, 0) !== 10_000)
      context.addIssue({
        code: 'custom',
        path: ['participants'],
        message: 'Positive participant shares must total 10000 basis points',
      });
  });
export type FinancialAllocationInput = z.infer<typeof financialAllocationInputSchema>;

export const financialAllocationResultSchema = z.strictObject({
  currency: currencySchema,
  premiumMinor: minorUnitSchema,
  allocations: z
    .array(
      z.strictObject({
        participantId: financialId,
        role: z.enum(['lead', 'follow']),
        shareBps: basisPoints.min(1),
        premiumMinor: minorUnitSchema,
      }),
    )
    .min(1)
    .max(100),
  commission: commissionSchema.extend({ amountMinor: minorUnitSchema }),
  calculationVersion: z.literal('exact-money-v1'),
  rounding: z.literal('half-away-from-zero'),
  allocationMethod: z.literal('largest-remainder-id-order'),
});
export type FinancialAllocationResult = z.infer<typeof financialAllocationResultSchema>;

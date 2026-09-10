// Retained TypeScript exact-money-v1 conformance oracle. No runtime engine selection occurs here.
import {
  financialAllocationInputSchema,
  minorUnitSchema,
  type FinancialAllocationInput,
  type FinancialAllocationResult,
} from '../contracts/money.js';
import { KernelError } from './canonical.js';

const denominator = 10_000n;
const compareIds = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function boundedMinor(value: bigint): string {
  const result = value.toString();
  if (!minorUnitSchema.safeParse(result).success)
    throw new KernelError('MONEY_OVERFLOW', 'Calculated money exceeds 18 magnitude digits', 422);
  return result;
}

/**
 * Pure allocation of a signed premium or premium delta. Capacity amounts are gross shares;
 * commission is a separate calculated interest, not a deduction or a posted accounting ledger.
 */
export function allocateFinancialsReference(
  input: FinancialAllocationInput,
): FinancialAllocationResult {
  const parsed = financialAllocationInputSchema.safeParse(input);
  if (!parsed.success)
    throw new KernelError(
      'INVALID_FINANCIAL_ALLOCATION',
      'Invalid financial allocation: ' +
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      422,
    );

  const value = parsed.data;
  const premium = BigInt(value.premiumMinor);
  const sign = premium < 0n ? -1n : 1n;
  const magnitude = premium * sign;
  // Sort both returned allocations and residual ties by stable ID, never caller order or locale.
  const shares = [...value.participants]
    .sort((left, right) => compareIds(left.id, right.id))
    .map((participant) => {
      const numerator = magnitude * BigInt(participant.shareBps);
      return {
        ...participant,
        amount: numerator / denominator,
        remainder: numerator % denominator,
      };
    });
  let remaining = magnitude - shares.reduce((sum, share) => sum + share.amount, 0n);
  const residualOrder = [...shares].sort((left, right) =>
    left.remainder === right.remainder
      ? compareIds(left.id, right.id)
      : left.remainder > right.remainder
        ? -1
        : 1,
  );
  for (const share of residualOrder) {
    if (remaining === 0n) break;
    share.amount += 1n;
    remaining -= 1n;
  }

  const commissionNumerator = magnitude * BigInt(value.commission.rateBps);
  const commissionMagnitude =
    commissionNumerator / denominator +
    ((commissionNumerator % denominator) * 2n >= denominator ? 1n : 0n);

  return {
    currency: value.currency,
    premiumMinor: value.premiumMinor,
    allocations: shares.map((share) => ({
      participantId: share.id,
      role: share.role,
      shareBps: share.shareBps,
      premiumMinor: boundedMinor(share.amount * sign),
    })),
    commission: {
      ...value.commission,
      amountMinor: boundedMinor(commissionMagnitude * sign),
    },
    calculationVersion: 'exact-money-v1',
    rounding: 'half-away-from-zero',
    allocationMethod: 'largest-remainder-id-order',
  };
}

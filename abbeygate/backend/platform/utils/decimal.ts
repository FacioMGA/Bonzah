import { Decimal } from 'decimal.js';

/**
 * Financial Precision Utilities using Decimal.js
 * 
 * CRITICAL: All monetary calculations MUST use Decimal to avoid floating-point errors.
 * JavaScript's number type is unsafe for financial calculations:
 * 
 * Example:
 *   0.1 + 0.2 === 0.3  // false! (JavaScript number)
 *   new Decimal(0.1).plus(0.2).equals(0.3)  // true (Decimal.js)
 * 
 * Usage:
 *   const premium = toDecimal(basePremium).mul(factor);
 *   const total = premium.plus(taxes);
 *   const result = total.toNumber(); // Only convert to number at the very end
 */

// Configure Decimal.js defaults for currency (2 decimal places)
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/**
 * Safely convert any value to Decimal
 * @param value - number, string, Decimal, or unknown
 * @returns Decimal instance (defaults to 0 if invalid)
 */
export function toDecimal(value: unknown): Decimal {
    if (value instanceof Decimal) return value;

    if (typeof value === 'number') {
        return Number.isFinite(value) ? new Decimal(value) : new Decimal(0);
    }

    if (typeof value === 'string') {
        try {
            const parsed = new Decimal(value.replace(/[€$£,]/g, '').trim());
            return parsed.isFinite() ? parsed : new Decimal(0);
        } catch {
            return new Decimal(0);
        }
    }

    return new Decimal(0);
}

/**
 * Convert Decimal back to JavaScript number
 * WARNING: Only use this at the very end of calculations, never in the middle!
 * @param d - Decimal instance
 * @returns number
 */
export function fromDecimal(d: Decimal): number {
    return d.toNumber();
}

/**
 * Format Decimal as currency string
 * @param d - Decimal instance
 * @param currency - Currency code (EUR, USD, GBP)
 * @returns Formatted string like "€123.45"
 */
export function formatCurrency(d: Decimal, currency = 'EUR'): string {
    const symbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency;
    return `${symbol}${d.toFixed(2)}`;
}

/**
 * Calculate percentage of a Decimal amount
 * @param amount - Decimal amount
 * @param percentage - Percentage as number (e.g., 15 for 15%)
 * @returns Decimal result
 */
export function calcPercentage(amount: Decimal, percentage: number): Decimal {
    return amount.mul(percentage).div(100);
}

/**
 * Pro-rata calculation for insurance policies
 * @param annualPremium - Annual premium as Decimal
 * @param daysRemaining - Number of days remaining in policy
 * @param totalDays - Total days in policy period (default 365)
 * @returns Decimal pro-rata amount
 */
export function calcProRata(annualPremium: Decimal, daysRemaining: number, totalDays = 365): Decimal {
    return annualPremium.mul(daysRemaining).div(totalDays);
}

/**
 * Round Decimal to currency precision (2 decimal places)
 * @param d - Decimal instance
 * @returns Decimal rounded to 2 decimal places
 */
export function roundCurrency(d: Decimal): Decimal {
    return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Compare two Decimal values for financial equality (within 1 cent)
 * @param a - First Decimal
 * @param b - Second Decimal
 * @returns true if difference is less than $0.01
 */
export function financiallyEqual(a: Decimal, b: Decimal): boolean {
    return a.minus(b).abs().lessThan(0.01);
}

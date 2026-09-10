/**
 * Phone number rule factory.
 *
 * The phone validator is the single environment-specific dependency in
 * `@facio/validation`. The frontend uses
 * `react-phone-number-input`'s `isPossiblePhoneNumber`; the backend uses
 * `libphonenumber-js`'s `isValidPhoneNumber` (wrapped in try/catch to
 * mirror the historical `isPossiblePhoneNumber` semantics).
 *
 * `createPhoneE164` returns a Zod schema with the same string-shape and
 * length-cap semantics on both sides; only the structural number-format
 * verdict differs (and even then, the underlying library is the same in
 * both packages — `react-phone-number-input` re-exports the helper from
 * `libphonenumber-js`).
 */

import { z } from 'zod';

export type PhoneValidator = (raw: string) => boolean;

export function createPhoneE164(deps: { phoneValidator: PhoneValidator }): z.ZodTypeAny {
  const { phoneValidator } = deps;
  return z
    .string()
    .trim()
    .min(1, 'Please enter your phone number')
    .superRefine((raw, ctx) => {
      const digits = raw.replace(/\D/g, '');
      if (digits.length > 15 || raw.length > 20) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Phone number is too long' });
        return;
      }
      if (!phoneValidator(raw)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please enter a valid phone number' });
      }
    });
}

import { z } from 'zod';
import { isPossiblePhoneNumber } from 'libphonenumber-js';
import { EMAIL_REGEX, nationalityRule } from '@facio/validation';
import { getAddressValidationErrors } from '../../shared/addressValidation.js';

/**
 * Motor wizard step 1 — Personal details (Phase 6k canonical shape).
 *
 * Every field lives under `proposer.*` to match Travel + Home + the
 * shared `<PolicyHolderStep />`. The schema runs against the full
 * RHF `QuoteData` (which carries vehicle + driving fields too) so it
 * uses `.passthrough()` for non-proposer keys — strict full-quote
 * validation lives on the backend in `quoteDataInputSchema`.
 */
const ProposerAddressShape = z.object({
  line1: z.string().trim().min(5, 'Please enter your address'),
  line2: z.string().optional().default(''),
  city: z.string().trim().min(2, 'Please enter your city'),
  province: z.string().optional().default(''),
  postcode: z.string().trim().min(3, 'Please enter your post code'),
  country: z.string().optional().default(''),
});

const ProposerShape = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(2, 'Please enter your first name (min 2 characters)')
      .max(50, 'First name must be less than 50 characters'),
    lastName: z
      .string()
      .trim()
      .min(2, 'Please enter your last name (min 2 characters)')
      .max(50, 'Last name must be less than 50 characters'),
    address: ProposerAddressShape,
    phone: z
      .string()
      .trim()
      .min(1, 'Please enter your phone number')
      .superRefine((raw, ctx) => {
        const digits = raw.replace(/\D/g, '');
        if (digits.length > 15 || raw.length > 20) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Phone number is too long' });
          return;
        }
        if (!isPossiblePhoneNumber(raw)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please enter a valid phone number' });
        }
      }),
    dateOfBirth: z
      .string()
      .min(1, 'Please enter your date of birth')
      .superRefine((v, ctx) => {
        const dob = new Date(v);
        if (Number.isNaN(dob.getTime())) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please enter your date of birth' });
          return;
        }
        const today = new Date();
        const age = today.getFullYear() - dob.getFullYear();
        const monthDiff = today.getMonth() - dob.getMonth();
        const actualAge =
          monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate()) ? age - 1 : age;

        if (actualAge < 18) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'You must be at least 18 to buy this insurance' });
        }
      }),
    email: z
      .string()
      .trim()
      .min(1, 'Please enter your email address')
      .refine((v) => EMAIL_REGEX.test(v), 'Please enter a valid email address'),
    // Canonical Nationality contract — same rule the validation registry
    // wires under the `nationality` key, importing directly from
    // `@facio/validation` so the schema and the registry cannot drift.
    nationality: nationalityRule,
    nif: z.string().optional().default(''),
    occupation: z.string().optional().default(''),
    whereDidYouHear: z.string().optional().default(''),
    marketingConsent: z.boolean().optional().default(false),
    privacyPolicyAccepted: z
      .boolean()
      .refine((v) => v === true, 'You must read and accept the Privacy Policy to continue'),
    bestTimeToCall: z.string().optional().default(''),
    domicileCountry: z.string().optional().default(''),
  })
  .superRefine((proposer, ctx) => {
    const address = proposer.address || {
      line1: '', line2: '', city: '', province: '', postcode: '', country: '',
    };
    const errors = getAddressValidationErrors({
      country: address.country,
      province: address.province,
      postCode: address.postcode,
    }) as Partial<Record<'province' | 'postCode', string>>;

    if (errors.province) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['address', 'province'], message: errors.province });
    }
    if (errors.postCode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['address', 'postcode'], message: errors.postCode });
    }
  });

export const Step1Schema = z
  .object({
    proposer: ProposerShape,
  })
  // See module docstring: per-step schemas validate against the full
  // RHF payload (vehicle + driving keys ride along with proposer in
  // the same form values), so non-proposer keys must pass through.
  .passthrough();

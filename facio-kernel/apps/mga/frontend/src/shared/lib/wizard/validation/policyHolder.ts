import { z } from 'zod';
import { isPossiblePhoneNumber } from 'react-phone-number-input';
import { EMAIL_REGEX } from '@facio/validation';

/**
 * Shared policyholder-step validator for wizards across all products.
 *
 * This is the single source of truth for "is the policyholder section
 * properly filled in?". Home, Travel, and any future product reuse this —
 * Motor has its own Step1Schema historically but the rules here intentionally
 * mirror Motor's contract (see `products/motor/wizard/schemas/step1.ts`).
 *
 * Usage:
 *   const errors = validatePolicyHolderStep(form.getValues(), { include });
 *   if (Object.keys(errors).length) {
 *     applyStepErrors(form, errors);
 *     return; // do not advance
 *   }
 */

export type PolicyHolderIncludeFlags = {
  dateOfBirth?: boolean;
  nationality?: boolean;
  nif?: boolean;
  occupation?: boolean;
  idType?: boolean;
  marketingConsent?: boolean;
};

export interface BuildPolicyHolderSchemaOptions {
  /** RHF path prefix for the proposer object. Default: 'proposer'. */
  pathPrefix?: string;
  include?: PolicyHolderIncludeFlags;
}

const DEFAULT_INCLUDE: Required<PolicyHolderIncludeFlags> = {
  dateOfBirth: true,
  nationality: true,
  nif: false,
  occupation: false,
  idType: false,
  marketingConsent: true,
};

function dateOfBirthSchema() {
  return z
    .string()
    .min(1, 'Please enter your date of birth')
    .superRefine((v, ctx) => {
      const dob = new Date(v);
      if (Number.isNaN(dob.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please enter a valid date of birth' });
        return;
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (dob > today) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date of birth cannot be in the future' });
        return;
      }
      let age = today.getFullYear() - dob.getFullYear();
      const monthDiff = today.getMonth() - dob.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;
      if (age < 18) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'You must be at least 18 to buy this insurance' });
      } else if (age > 100) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please enter a valid date of birth' });
      }
    });
}

function phoneSchema() {
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
      if (!isPossiblePhoneNumber(raw)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please enter a valid phone number' });
      }
    });
}

function addressSchema() {
  return z.object({
    line1: z.string().trim().min(5, 'Please enter your address'),
    city: z.string().trim().min(2, 'Please enter your city'),
    province: z.string().optional().default(''),
    postcode: z.string().optional().default(''),
    country: z.string().trim().min(2, 'Please enter your country'),
  }).passthrough();
}

export function buildPolicyHolderSchema(opts: BuildPolicyHolderSchemaOptions = {}) {
  const include = { ...DEFAULT_INCLUDE, ...(opts.include ?? {}) };

  const shape: Record<string, z.ZodTypeAny> = {
    firstName: z.string().trim().min(2, 'Please enter your first name (min 2 characters)'),
    lastName: z.string().trim().min(2, 'Please enter your last name (min 2 characters)'),
    email: z
      .string()
      .trim()
      .min(1, 'Please enter your email address')
      .refine((v) => EMAIL_REGEX.test(v), 'Please enter a valid email address'),
    phone: phoneSchema(),
    address: addressSchema(),
  };

  if (include.dateOfBirth) shape.dateOfBirth = dateOfBirthSchema();
  if (include.nationality) shape.nationality = z.string().trim().min(2, 'Please select your nationality');
  if (include.nif) shape.nif = z.string().optional().default('');
  if (include.occupation) shape.occupation = z.string().optional().default('');
  if (include.idType) {
    shape.idType = z.string().min(1, 'Please select an ID type');
    shape.idNumber = z.string().trim().min(2, 'Please enter your ID number');
  }
  if (include.marketingConsent) shape.marketingConsent = z.boolean().optional().default(false);

  const proposer = z.object(shape).passthrough();
  const prefix = opts.pathPrefix ?? 'proposer';
  if (!prefix) return proposer;
  return z.object({ [prefix]: proposer }).passthrough();
}

/**
 * Run the schema and flatten zod errors into RHF-shaped `{ 'proposer.firstName': 'Please…' }`.
 * Only the first error per field is returned (matches Motor's behavior).
 */
export function validatePolicyHolderStep(
  data: unknown,
  opts: BuildPolicyHolderSchemaOptions = {},
): Record<string, string> {
  const parsed = buildPolicyHolderSchema(opts).safeParse(data);
  if (parsed.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.join('.');
    if (!path || errors[path]) continue;
    errors[path] = issue.message;
  }
  return errors;
}

/** Apply a step-error map to an RHF form (clears previous errors first). */
export function applyStepErrors(
  form: {
    clearErrors: (path?: string | string[]) => void;
    setError: (path: string, error: { type?: string; message: string }) => void;
  },
  errors: Record<string, string>,
) {
  form.clearErrors();
  for (const [path, message] of Object.entries(errors)) {
    form.setError(path, { type: 'manual', message });
  }
}

/**
 * The list of RHF paths a step *claims* as its own. Useful if you want
 * to `form.trigger(policyHolderFieldPaths({ include, pathPrefix }))` or
 * clear only these errors before re-validating.
 */
export function policyHolderFieldPaths(opts: BuildPolicyHolderSchemaOptions = {}): string[] {
  const include = { ...DEFAULT_INCLUDE, ...(opts.include ?? {}) };
  const prefix = opts.pathPrefix ?? 'proposer';
  const p = (k: string) => (prefix ? `${prefix}.${k}` : k);
  const paths = [
    p('firstName'), p('lastName'), p('email'), p('phone'),
    p('address.line1'), p('address.city'), p('address.country'),
  ];
  if (include.dateOfBirth) paths.push(p('dateOfBirth'));
  if (include.nationality) paths.push(p('nationality'));
  if (include.nif) paths.push(p('nif'));
  if (include.occupation) paths.push(p('occupation'));
  if (include.idType) paths.push(p('idType'), p('idNumber'));
  if (include.marketingConsent) paths.push(p('marketingConsent'));
  return paths;
}

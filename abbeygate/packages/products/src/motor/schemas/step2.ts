import { z } from 'zod';
import { requiresForeignLicenceConfirmation } from '../licenceCountry.js';

/**
 * Motor wizard step 2 — Driving history (Phase 6k canonical shape).
 *
 * `occupation`, `whereDidYouHear`, and `dateOfBirth` live under
 * `proposer.*` — the BO underwriting tab and Travel/Home all read
 * the same canonical paths.
 */
const Step2ProposerShape = z.object({
  occupation: z.string().trim().min(2, 'Please enter your occupation'),
  whereDidYouHear: z.string().min(1, 'Please tell us where you heard about us'),
  dateOfBirth: z.string().optional().default(''),
}).passthrough();

const MotorConvictionEntrySchema = z.object({
  id: z.string().optional(),
  date: z.string().optional().default(''),
  convictionClass: z.string().optional().default(''),
  description: z.string().optional().default(''),
}).passthrough();

function ageInYearsFromDate(rawDate: string): number | null {
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  let years = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) years -= 1;
  return years;
}

export const Step2Schema = z
  .object({
    proposer: Step2ProposerShape,

    licenseYears: z
      .number({ error: 'Please select license years' })
      .min(0, 'Please select license years'),
    licenseType: z.string().min(1, 'Please select your license type'),
    licenseIssuedIn: z.string().min(1, 'Please select where your license was issued'),
    // Confirmation required only when the licence was issued outside the
    // UK/EU — the customer must confirm it legally permits them to drive in
    // the operating country without supervision. The conditional rule lives
    // in the superRefine below so a blank/UK/EU answer never demands it.
    licenseForeignDeclarationAccepted: z.boolean().nullable().optional(),

    hasClaims: z.boolean().nullable().superRefine((v, ctx) => {
      if (v === null || v === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please indicate if you have any claims' });
      }
    }),
    claimsDetails: z.string().optional().default(''),
    claimsCountLast5Years: z.number().optional(),
    claimsTotalCostLast5Years: z.number().optional(),
    maxFaultClaimCostLast5Years: z.number().optional(),

    hasConvictions: z.boolean().nullable().superRefine((v, ctx) => {
      if (v === null || v === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please indicate if you have any convictions' });
      }
    }),
    motorConvictions: z.array(MotorConvictionEntrySchema).optional().default([]),
    convictionsDetails: z.string().optional().default(''),
    hasMajorConvictionLast5Years: z.boolean().nullable().optional(),
    convictionClass: z.string().optional().default(''),
    majorConvictionWithinYears: z.number().optional(),

    // Coverage restriction (ABY-232). Canonical enum: who is allowed
    // to drive under this policy. Field-level required; downstream
    // conditional validation lives in `validateMotorBindStage`.
    driverRestriction: z
      .enum(['POLICYHOLDER_ONLY', 'NAMED_DRIVERS', 'ANY_DRIVER_25_PLUS', 'ANY_DRIVER_40_PLUS'])
      .nullable()
      .optional()
      .superRefine((v, ctx) => {
        if (v === null || v === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Please select who can drive this vehicle',
          });
        }
      }),
    // `hasAdditionalDrivers` is required only when
    // `driverRestriction === 'NAMED_DRIVERS'`. The cross-field
    // refinement lower down enforces that — at the schema level the
    // field is nullable so a fresh form (driverRestriction unset) can
    // be parsed.
    hasAdditionalDrivers: z.boolean().nullable().optional(),
    youngestDriverAge: z.number().optional(),
    otherDriversClaims: z.boolean().optional().default(false),
    otherDriversClaimsDetails: z.string().optional().default(''),
    otherDriversConvictions: z.boolean().optional().default(false),
    otherDriversConvictionsDetails: z.string().optional().default(''),
  })
  .superRefine((data, ctx) => {
    // Non-UK/EU driving licence: the customer must confirm it permits them
    // to drive in the operating country without supervision before binding.
    if (requiresForeignLicenceConfirmation(data.licenseIssuedIn) && data.licenseForeignDeclarationAccepted !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['licenseForeignDeclarationAccepted'],
        message: 'Please confirm your licence permits you to drive without supervision',
      });
    }

    const proposerDob = data.proposer?.dateOfBirth;
    if (proposerDob && typeof data.licenseYears === 'number') {
      const dob = new Date(proposerDob);
      if (!Number.isNaN(dob.getTime())) {
        const today = new Date();
        const age = today.getFullYear() - dob.getFullYear();
        if (age - data.licenseYears < 17) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['licenseYears'],
            message: "The licence duration doesn't match your age. You cannot have a licence before age 17",
          });
        }
      }
    }

    if (data.hasClaims) {
      if (!data.claimsDetails || data.claimsDetails.trim().length < 10) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['claimsDetails'], message: 'Please provide at least 10 characters about your claims' });
      }

      if (data.claimsCountLast5Years === undefined || data.claimsCountLast5Years <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['claimsCountLast5Years'],
          message: 'Please enter the number of claims in the last 5 years',
        });
      }
      if (data.claimsTotalCostLast5Years === undefined || data.claimsTotalCostLast5Years < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['claimsTotalCostLast5Years'],
          message: 'Please enter the total claims cost (0 if unknown)',
        });
      }
      if (data.maxFaultClaimCostLast5Years === undefined || data.maxFaultClaimCostLast5Years < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxFaultClaimCostLast5Years'],
          message: 'Please enter the largest fault claim cost (0 if none/unknown)',
        });
      }
    }

    if (data.hasConvictions) {
      const convictionRows = Array.isArray(data.motorConvictions) ? data.motorConvictions : [];
      if (convictionRows.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['motorConvictions'],
          message: 'Please add at least one conviction or endorsement',
        });
      }
      convictionRows.forEach((row, index) => {
        if (!row.date) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['motorConvictions', index, 'date'],
            message: 'Please enter the conviction date',
          });
        } else {
          const years = ageInYearsFromDate(row.date);
          if (years === null) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['motorConvictions', index, 'date'],
              message: 'Please enter a valid conviction date',
            });
          } else if (years < 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['motorConvictions', index, 'date'],
              message: 'Conviction date cannot be in the future',
            });
          } else if (years > 5) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['motorConvictions', index, 'date'],
              message: 'Only convictions within the last 5 years should be declared here',
            });
          }
        }
        if (!row.convictionClass) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['motorConvictions', index, 'convictionClass'],
            message: 'Please select the conviction type',
          });
        }
        if (!row.description || row.description.trim().length < 3) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['motorConvictions', index, 'description'],
            message: 'Please describe the conviction',
          });
        }
      });
      if (!data.convictionsDetails || data.convictionsDetails.trim().length < 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['convictionsDetails'],
          message: 'Please provide at least 10 characters about your convictions',
        });
      }
      if (data.hasMajorConvictionLast5Years === null || data.hasMajorConvictionLast5Years === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['hasMajorConvictionLast5Years'],
          message: 'Please indicate if any conviction is classed as major',
        });
      }
      if (!data.convictionClass) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['convictionClass'],
          message: 'Please select the conviction class',
        });
      }
      if (data.hasMajorConvictionLast5Years === true && data.convictionClass && data.convictionClass !== 'major') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['convictionClass'],
          message: 'Select Major conviction when you answered yes to a major conviction',
        });
      }
      if (data.hasMajorConvictionLast5Years === false && data.convictionClass === 'major') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['convictionClass'],
          message: 'Major conviction cannot be selected when you answered no to a major conviction',
        });
      }
      if (data.convictionClass === 'major') {
        const yrs = data.majorConvictionWithinYears;
        if (yrs !== 2 && yrs !== 3 && yrs !== 5) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['majorConvictionWithinYears'],
            message: 'Please select the major conviction timeframe',
          });
        }
      }
    }

    // `hasAdditionalDrivers` and the cascade of named/other-driver
    // questions only apply when the policy is on a NAMED_DRIVERS
    // basis. For POLICYHOLDER_ONLY / ANY_DRIVER_25_PLUS /
    // ANY_DRIVER_40_PLUS the wizard cascade-clears all of these and
    // we must not block validation on stale values.
    if (data.driverRestriction === 'NAMED_DRIVERS') {
      if (data.hasAdditionalDrivers === null || data.hasAdditionalDrivers === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['hasAdditionalDrivers'],
          message: 'Please indicate if there will be additional drivers',
        });
      }

      if (data.hasAdditionalDrivers) {
        const age = data.youngestDriverAge;
        if (age === undefined || age < 21 || age > 80) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['youngestDriverAge'],
            message: 'Youngest driver age must be between 21 and 80',
          });
        }

        if (data.otherDriversClaims === null || data.otherDriversClaims === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['otherDriversClaims'],
            message: 'Please indicate if other drivers have claims',
          });
        } else if (data.otherDriversClaims && (!data.otherDriversClaimsDetails || data.otherDriversClaimsDetails.trim().length < 10)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['otherDriversClaimsDetails'],
            message: "Please provide details of other drivers' claims",
          });
        }

        if (data.otherDriversConvictions === null || data.otherDriversConvictions === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['otherDriversConvictions'],
            message: 'Please indicate if other drivers have convictions',
          });
        } else if (
          data.otherDriversConvictions &&
          (!data.otherDriversConvictionsDetails || data.otherDriversConvictionsDetails.trim().length < 10)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['otherDriversConvictionsDetails'],
            message: "Please provide details of other drivers' convictions",
          });
        }
      }
    }
  })
  // See step1.ts for the cross-step `.passthrough()` rationale.
  .passthrough();

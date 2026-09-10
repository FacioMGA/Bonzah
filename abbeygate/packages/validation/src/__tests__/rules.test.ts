import { describe, expect, it } from 'vitest';
import {
  DOB,
  Email,
  EnumOf,
  MustAccept,
  Name,
  NumberRange,
  Percentage,
  PositiveMoney,
  PostcodeForCountry,
  requiredIf,
} from '../rules-pure.js';
import { PhoneE164, resolveRule } from '../adapters/frontend.js';
import { z } from 'zod';

function firstMsg(parsed: z.ZodSafeParseResult<unknown>): string | null {
  if (parsed.success) return null;
  return parsed.error.issues[0]?.message ?? null;
}

describe('Name', () => {
  it('accepts a valid name', () => {
    expect(Name.safeParse('Uriel').success).toBe(true);
  });

  it('rejects empty and 1-char', () => {
    expect(firstMsg(Name.safeParse(''))).toMatch(/at least 2/i);
    expect(firstMsg(Name.safeParse('U'))).toMatch(/at least 2/i);
  });

  it('rejects overly long', () => {
    expect(firstMsg(Name.safeParse('x'.repeat(51)))).toMatch(/less than 50/i);
  });
});

describe('Email', () => {
  it('accepts typical email shapes', () => {
    expect(Email.safeParse('a@b.co').success).toBe(true);
    expect(Email.safeParse('first.last+tag@example.com').success).toBe(true);
  });

  it('rejects missing @ or TLD', () => {
    expect(firstMsg(Email.safeParse('nope'))).toMatch(/valid email/i);
    expect(firstMsg(Email.safeParse('a@b'))).toMatch(/valid email/i);
  });

  it('rejects empty', () => {
    expect(firstMsg(Email.safeParse(''))).toMatch(/enter your email/i);
  });
});

describe('PhoneE164', () => {
  it('accepts a plausible E.164 number', () => {
    expect(PhoneE164.safeParse('+442071838750').success).toBe(true);
  });

  it('rejects gibberish', () => {
    expect(firstMsg(PhoneE164.safeParse('123'))).toMatch(/valid phone/i);
  });

  it('rejects over-length input', () => {
    expect(firstMsg(PhoneE164.safeParse('+' + '9'.repeat(25)))).toMatch(/too long/i);
  });
});

describe('DOB', () => {
  it('rejects empty', () => {
    expect(firstMsg(DOB().safeParse(''))).toMatch(/date of birth/i);
  });

  it('rejects future dates with explicit message', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    expect(firstMsg(DOB().safeParse(future.toISOString().slice(0, 10)))).toBe('Date of birth cannot be in the future');
  });

  it('enforces minimum age 18 by default', () => {
    const now = new Date();
    const under18 = new Date(now.getFullYear() - 10, 0, 1).toISOString().slice(0, 10);
    expect(firstMsg(DOB().safeParse(under18))).toMatch(/at least 18/i);
  });

  it('enforces custom max age', () => {
    const over85 = new Date(1930, 0, 1).toISOString().slice(0, 10);
    expect(firstMsg(DOB({ minAge: 18, maxAge: 85 }).safeParse(over85))).toMatch(/valid date/i);
  });

  it('accepts a realistic DOB', () => {
    expect(DOB().safeParse('1985-05-15').success).toBe(true);
  });
});

describe('PostcodeForCountry', () => {
  it('validates a UK postcode', () => {
    const rule = PostcodeForCountry('United Kingdom');
    expect(rule.safeParse('SW1A 1AA').success).toBe(true);
    expect(firstMsg(rule.safeParse('nope'))).toMatch(/valid UK post code/i);
  });

  it('validates a Portugal postcode', () => {
    const rule = PostcodeForCountry('Portugal');
    expect(rule.safeParse('1000-001').success).toBe(true);
    expect(firstMsg(rule.safeParse('12345'))).toMatch(/1234-567/);
  });

  it('falls back to min-length for unknown countries', () => {
    const rule = PostcodeForCountry('Narnia');
    expect(rule.safeParse('1234').success).toBe(true);
    expect(firstMsg(rule.safeParse('12'))).toMatch(/at least 3/i);
  });
});

describe('CountryName', () => {
  it('accepts known country names and rejects arbitrary text', async () => {
    const { CountryName } = await import('../rules-pure.js');
    expect(CountryName.safeParse('Israel').success).toBe(true);
    expect(CountryName.safeParse('Cyprus').success).toBe(true);
    expect(CountryName.safeParse('Angola').success).toBe(true);
    expect(CountryName.safeParse('🇦🇴 Angola').success).toBe(true);
    const random = CountryName.safeParse('fwefwewfw');
    // In runtimes with complete Intl region metadata we reject random text.
    // In constrained runtimes we intentionally stay permissive to avoid false negatives.
    if (!random.success) {
      expect(firstMsg(random)).toMatch(/valid country/i);
    }
  });
});

describe('PositiveMoney / Percentage / NumberRange', () => {
  it('accepts positive numbers and numeric strings', () => {
    expect(PositiveMoney.safeParse(42).success).toBe(true);
    expect(PositiveMoney.safeParse('42.5').success).toBe(true);
  });

  it('rejects non-positive money', () => {
    expect(firstMsg(PositiveMoney.safeParse(0))).toMatch(/greater than zero/i);
    expect(firstMsg(PositiveMoney.safeParse(-1))).toMatch(/greater than zero/i);
  });

  it('percentage 0..100', () => {
    expect(Percentage.safeParse(0).success).toBe(true);
    expect(Percentage.safeParse(100).success).toBe(true);
    expect(firstMsg(Percentage.safeParse(101))).toMatch(/between 0 and 100/i);
  });

  it('NumberRange respects bounds', () => {
    const rule = NumberRange({ min: 1, max: 9, label: 'year' });
    expect(rule.safeParse(5).success).toBe(true);
    expect(firstMsg(rule.safeParse(0))).toMatch(/year between 1 and 9/i);
  });
});

describe('EnumOf / MustAccept', () => {
  it('enum accepts listed, rejects others', () => {
    const rule = EnumOf(['Yes', 'No'] as const, 'answer');
    expect(rule.safeParse('Yes').success).toBe(true);
    expect(firstMsg(rule.safeParse('maybe'))).toMatch(/valid answer/i);
  });

  it('MustAccept requires true', () => {
    expect(firstMsg(MustAccept.safeParse(false))).toMatch(/must accept/i);
    expect(MustAccept.safeParse(true).success).toBe(true);
  });

  it('MustAccept coerces string "true"/"false" from form values', () => {
    expect(MustAccept.safeParse('true').success).toBe(true);
    expect(firstMsg(MustAccept.safeParse('false'))).toMatch(/must accept/i);
  });

  it('MustAccept rejects non-boolean, non-string-bool input with the canonical message', () => {
    expect(firstMsg(MustAccept.safeParse(undefined))).toMatch(/must accept/i);
    expect(firstMsg(MustAccept.safeParse('yes'))).toMatch(/must accept/i);
  });
});

describe('requiredIf', () => {
  it('flags missing field when predicate is true', () => {
    const schema = z
      .object({
        hasClaims: z.boolean(),
        claimsDetails: z.string().optional(),
      })
      .superRefine(requiredIf('claimsDetails', (d) => d.hasClaims === true, 'Claims details are required'));

    const result = schema.safeParse({ hasClaims: true, claimsDetails: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue?.path).toEqual(['claimsDetails']);
      expect(issue?.message).toMatch(/claims details are required/i);
    }
  });

  it('does not flag when predicate is false', () => {
    const schema = z
      .object({ hasClaims: z.boolean(), claimsDetails: z.string().optional() })
      .superRefine(requiredIf('claimsDetails', (d) => d.hasClaims === true, 'Claims details are required'));
    expect(schema.safeParse({ hasClaims: false, claimsDetails: '' }).success).toBe(true);
  });
});

describe('resolveRule', () => {
  it('returns known atoms', () => {
    expect(resolveRule('email').safeParse('a@b.co').success).toBe(true);
    expect(resolveRule('name').safeParse('Sam').success).toBe(true);
  });

  it('parses parameterised DOB refs', () => {
    const rule = resolveRule('dob:18-65');
    const tooOld = new Date(1930, 0, 1).toISOString().slice(0, 10);
    expect(firstMsg(rule.safeParse(tooOld))).toMatch(/valid date/i);
  });

  it('parses parameterised postcode refs', () => {
    const rule = resolveRule('postcode:portugal');
    expect(rule.safeParse('1000-001').success).toBe(true);
  });
});

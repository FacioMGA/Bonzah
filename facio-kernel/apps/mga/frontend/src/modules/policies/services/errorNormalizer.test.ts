import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import '@/src/products';
import { normalizeSchemaIssueMessage, normalizeSchemaMessageText } from './errorNormalizer';

describe('normalizeSchemaIssueMessage', () => {
  it('maps boolean invalid_type to yes/no copy', () => {
    const parsed = z.object({ hasClaims: z.boolean() }).safeParse({});
    if (parsed.success) throw new Error('Expected schema parse to fail');
    const issue = parsed.error.issues[0];
    const msg = normalizeSchemaMessageText(issue.message, {
      code: issue.code,
      fieldKey: 'hasClaims',
      productType: 'MOTOR',
    });
    expect(msg).toBe('Please choose Yes or No.');
  });

  it('maps select invalid_type to select copy', () => {
    const parsed = z.object({ licenseIssuedIn: z.string() }).safeParse({});
    if (parsed.success) throw new Error('Expected schema parse to fail');
    const issue = parsed.error.issues[0];
    const msg = normalizeSchemaMessageText(issue.message, {
      code: issue.code,
      fieldKey: 'licenseIssuedIn',
      productType: 'MOTOR',
    });
    expect(msg).toBe('Please select an option.');
  });

  it('falls back to original issue message when provided', () => {
    const parsed = z.object({ city: z.string().min(1, 'Please enter your city') }).safeParse({ city: '' });
    if (parsed.success) throw new Error('Expected schema parse to fail');
    const issue = parsed.error.issues[0];
    const msg = normalizeSchemaIssueMessage(issue);
    expect(msg).toBe('Please enter your city');
  });
});

describe('normalizeSchemaMessageText', () => {
  it('normalizes plain invalid input text without Zod issue context', () => {
    const msg = normalizeSchemaMessageText('Invalid input: expected string, received undefined', {
      fieldKey: 'licenseIssuedIn',
      productType: 'MOTOR',
    });
    expect(msg).toBe('Please select an option.');
  });
});


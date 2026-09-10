import { describe, expect, it } from 'vitest';
import { buildAccountIntelligenceSearchTerms } from '../accountIntelligenceSearchTerms.js';
import { buildAccountIntelligenceSearchWhere } from '../../app/accountIntelligenceSearch.js';

describe('buildAccountIntelligenceSearchTerms', () => {
  it('includes email, phone, policy numbers, and registration numbers', () => {
    const terms = buildAccountIntelligenceSearchTerms({
      email: 'client@example.com',
      phone: '+357 99 123456',
      policyNumbers: ['ABQ10001', 'ABQ10002'],
      registrationNumbers: ['KAA123', 'KBB456'],
    });
    expect(terms).toContain('client@example.com');
    expect(terms).toContain('+357 99 123456');
    expect(terms).toContain('35799123456');
    expect(terms).toContain('ABQ10001');
    expect(terms).toContain('KAA123');
  });

  it('indexes phone even when email is present', () => {
    const terms = buildAccountIntelligenceSearchTerms({
      email: 'client@example.com',
      phone: '+35799111222',
    });
    expect(terms).toContain('+35799111222');
    expect(terms).toContain('35799111222');
  });

  it('returns null when no searchable values exist', () => {
    expect(buildAccountIntelligenceSearchTerms({})).toBeNull();
  });
});

describe('buildAccountIntelligenceSearchWhere', () => {
  it('matches accountName, secondaryIdentity, and searchTerms', () => {
    expect(buildAccountIntelligenceSearchWhere('alpha')).toEqual({
      OR: [
        { accountName: { contains: 'alpha', mode: 'insensitive' } },
        { secondaryIdentity: { contains: 'alpha', mode: 'insensitive' } },
        { searchTerms: { contains: 'alpha', mode: 'insensitive' } },
      ],
    });
  });

  it('returns empty filter for blank search', () => {
    expect(buildAccountIntelligenceSearchWhere('   ')).toEqual({});
  });

  it('also searches the normalized phone value', () => {
    expect(buildAccountIntelligenceSearchWhere('+35799123456')).toEqual({
      OR: [
        { accountName: { contains: '+35799123456', mode: 'insensitive' } },
        { secondaryIdentity: { contains: '+35799123456', mode: 'insensitive' } },
        { searchTerms: { contains: '+35799123456', mode: 'insensitive' } },
        { searchTerms: { contains: '35799123456', mode: 'insensitive' } },
      ],
    });
  });
});

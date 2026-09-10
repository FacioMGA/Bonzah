import { describe, expect, it } from 'vitest';
import { buildPublicSessionUrl, buildPublicSessionCreateUrl } from '../buildPublicSessionUrl';

// Canonical URL builder for public session endpoints. Per
// docs/architecture/contracts/canonical-ownership.md, every product
// reaches its session API through this function; the canonical
// row "Issue-readiness HTTP" specifies the productCode-parameterised
// URL shape and forbids hardcoded product-string paths.

describe('buildPublicSessionUrl — canonical URL contract', () => {
  it('lowercases the product code and assembles the token-keyed session URL', () => {
    expect(buildPublicSessionUrl('MOTOR', 'abc123')).toBe('/api/public/motor/session/abc123');
    expect(buildPublicSessionUrl('Home', 'tok_2')).toBe('/api/public/home/session/tok_2');
    expect(buildPublicSessionUrl('travel', 'tok_3')).toBe('/api/public/travel/session/tok_3');
  });

  it('appends the segment when provided', () => {
    expect(buildPublicSessionUrl('motor', 'tok_4', 'rate')).toBe('/api/public/motor/session/tok_4/rate');
    expect(buildPublicSessionUrl('home', 'tok_5', 'issue-readiness')).toBe('/api/public/home/session/tok_5/issue-readiness');
  });

  it('strips a leading slash from the segment so callers can pass either form', () => {
    expect(buildPublicSessionUrl('travel', 'tok_6', '/fork')).toBe('/api/public/travel/session/tok_6/fork');
    expect(buildPublicSessionUrl('travel', 'tok_6', 'fork')).toBe('/api/public/travel/session/tok_6/fork');
  });

  it('URL-encodes the token to defend against accidental path traversal', () => {
    expect(buildPublicSessionUrl('motor', 'token/with/slashes')).toBe('/api/public/motor/session/token%2Fwith%2Fslashes');
    expect(buildPublicSessionUrl('motor', 'tok with space')).toBe('/api/public/motor/session/tok%20with%20space');
  });

  it('throws on missing product code instead of building a malformed URL', () => {
    expect(() => buildPublicSessionUrl('', 'tok')).toThrow(/productCode is required/);
    expect(() => buildPublicSessionUrl('   ', 'tok')).toThrow(/productCode is required/);
  });

  it('trims whitespace on the token when forming the path', () => {
    expect(buildPublicSessionUrl('motor', '  tok  ')).toBe('/api/public/motor/session/tok');
  });
});

describe('buildPublicSessionCreateUrl — canonical collection URL contract', () => {
  it('returns the productCode-lowercased session collection URL (no token, no trailing slash)', () => {
    expect(buildPublicSessionCreateUrl('MOTOR')).toBe('/api/public/motor/session');
    expect(buildPublicSessionCreateUrl('Home')).toBe('/api/public/home/session');
    expect(buildPublicSessionCreateUrl('travel')).toBe('/api/public/travel/session');
  });

  it('throws on missing product code', () => {
    expect(() => buildPublicSessionCreateUrl('')).toThrow(/productCode is required/);
  });
});

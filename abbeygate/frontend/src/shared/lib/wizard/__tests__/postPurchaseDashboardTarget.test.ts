/**
 * Regression suite for ABY-238 — the post-purchase "Go to my
 * dashboard" redirect target.
 *
 * Locks the canonical three-way rule:
 *   1. authenticated  → straight to /client (with optional ?policy=…)
 *   2. anon + email   → /verify-email?email=…&redirect=… (the OTP
 *      / DASHBOARD_ACCESS flow that actually links the policy
 *      server-side)
 *   3. anon, no email → /login?mode=signup&claimToken=… as a
 *      degraded fallback
 *
 * History: motor (1bcc8da7) and travel (f99a9bb5) regressed to
 * always-use-(3) on the assumption that `claimToken` would link the
 * policy. The backend signup route ignores the token, so (3) leaves
 * the policy unlinked. (2) is the only branch that links the policy
 * end-to-end.
 */
import { describe, expect, it } from 'vitest';
import { resolvePostPurchaseDashboardTarget } from '../postPurchaseDashboardTarget';

describe('resolvePostPurchaseDashboardTarget', () => {
  it('sends authenticated customers straight to /client when no deep link is provided', () => {
    expect(
      resolvePostPurchaseDashboardTarget({
        hasSession: true,
        email: 'effie@abbeygate.cy',
        policyId: 'token-abc',
      }),
    ).toBe('/client');
  });

  it('honours an explicit clientPath deep link for authenticated customers (travel ?policy=…)', () => {
    expect(
      resolvePostPurchaseDashboardTarget({
        hasSession: true,
        email: 'effie@abbeygate.cy',
        policyId: 'token-abc',
        clientPath: '/client?policy=abc-123',
      }),
    ).toBe('/client?policy=abc-123');
  });

  it('routes anon customers with an email to /verify-email (the OTP flow that actually links the policy)', () => {
    const url = resolvePostPurchaseDashboardTarget({
      hasSession: false,
      email: 'effie@abbeygate.cy',
      policyId: 'token-abc',
    });
    expect(url.startsWith('/verify-email?')).toBe(true);
    const params = new URL(`https://example.com${url}`).searchParams;
    expect(params.get('email')).toBe('effie@abbeygate.cy');
    expect(params.get('redirect')).toBe('/client');
  });

  it('preserves the clientPath in the verify-email redirect param', () => {
    const url = resolvePostPurchaseDashboardTarget({
      hasSession: false,
      email: 'effie@abbeygate.cy',
      policyId: 'token-abc',
      clientPath: '/client?policy=abc-123',
    });
    const params = new URL(`https://example.com${url}`).searchParams;
    expect(params.get('redirect')).toBe('/client?policy=abc-123');
  });

  it('falls back to /login?mode=signup&claimToken=… ONLY when no session and no email is known', () => {
    const url = resolvePostPurchaseDashboardTarget({
      hasSession: false,
      email: '',
      policyId: 'token-abc',
    });
    expect(url.startsWith('/login?')).toBe(true);
    const params = new URL(`https://example.com${url}`).searchParams;
    expect(params.get('mode')).toBe('signup');
    expect(params.get('claimToken')).toBe('token-abc');
    expect(params.get('next')).toBe('/client');
  });

  it('treats whitespace-only email as missing', () => {
    const url = resolvePostPurchaseDashboardTarget({
      hasSession: false,
      email: '   ',
      policyId: 'token-abc',
    });
    expect(url.startsWith('/login?')).toBe(true);
  });

  it('treats whitespace-only / nullish policyId as missing and omits the claimToken param', () => {
    const url = resolvePostPurchaseDashboardTarget({
      hasSession: false,
      email: '',
      policyId: null,
    });
    expect(url.startsWith('/login?')).toBe(true);
    const params = new URL(`https://example.com${url}`).searchParams;
    expect(params.get('claimToken')).toBeNull();
  });

  it('never returns the broken pre-fix shape (anon + email going to /login)', () => {
    // ABY-238 regression guard: the bug was sending anon-but-has-email
    // customers to /login (registration) instead of /verify-email
    // (OTP). This assertion prevents the regression from coming back.
    const url = resolvePostPurchaseDashboardTarget({
      hasSession: false,
      email: 'effie@abbeygate.cy',
      policyId: 'token-abc',
    });
    expect(url.startsWith('/login?')).toBe(false);
  });
});

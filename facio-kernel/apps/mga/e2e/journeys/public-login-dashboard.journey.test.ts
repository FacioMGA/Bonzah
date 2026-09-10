// Journey contract: post-purchase login -> dashboard (ABY-238).
//
// Bound to the canonical post-purchase target resolver. The three
// branches below ARE the contract; a silent rewrite that always
// routes to `/login?mode=signup&claimToken=...` (the May 2026
// regression) makes this file fail before customers re-experience
// the unlinked-policy bug.

import { describe, expect, it } from 'vitest';
import { resolvePostPurchaseDashboardTarget } from '../../frontend/src/shared/lib/wizard/postPurchaseDashboardTarget';

describe('journey: public-login-dashboard (ABY-238)', () => {
  it('routes an authenticated visitor straight to /client', () => {
    expect(resolvePostPurchaseDashboardTarget({ hasSession: true })).toBe('/client');
  });

  it('routes a logged-out visitor with an email through /verify-email', () => {
    const target = resolvePostPurchaseDashboardTarget({
      hasSession: false,
      email: 'jane@example.com',
    });
    expect(target.startsWith('/verify-email?')).toBe(true);
    expect(target).toContain('email=jane%40example.com');
  });

  it('falls back to /login (signup mode) when neither session nor email is available', () => {
    const target = resolvePostPurchaseDashboardTarget({
      hasSession: false,
      policyId: 'token_abc',
    });
    expect(target.startsWith('/login?')).toBe(true);
    expect(target).toContain('mode=signup');
    expect(target).toContain('claimToken=token_abc');
  });
});

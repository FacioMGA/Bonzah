// Post-purchase "Go to my dashboard" redirect target — single canonical
// owner for motor / home / travel wizards (ABY-238).
//
// Why this lives here, not duplicated in each wizard:
//
// The three wizards used to hold their own copy of this logic. In May
// 2026 motor and travel were "fixed" to always send unauthenticated
// customers to `/login?mode=signup&claimToken=…` on the assumption
// that the claimToken would link the purchased policy to the new
// account. Home was not touched. The "fix" silently regressed the
// flow (ABY-238 from production):
//
//   * The backend `signup` route accepts a `claimToken` in its
//     payload schema (`backend/modules/auth/http/authPayloadSchemas.ts`)
//     but never consumes it — there is no handler reading the token,
//     so the policy stays unlinked.
//   * The flow that actually links a post-purchase policy to a
//     customer is `DASHBOARD_ACCESS` OTP at `/verify-email`. Its
//     verify route sweeps unassigned policies by email
//     (`backend/modules/auth/http/authRouter/emailOtpRoutes.ts`,
//     `~164-222`).
//
// Restoring home's three-way pattern as the canonical rule:
//   1. valid client session   → go straight to `/client` (with
//      optional `?policy=…` deep link when known).
//   2. no session but email   → `/verify-email?email=…&redirect=…`
//      (the OTP path that actually links the policy).
//   3. no session, no email   → `/login?mode=signup&claimToken=…`
//      as a degraded fallback — at least gets the user into a
//      signup flow, even though the token is currently dropped.
//
// This helper is pure (no DOM, no localStorage reads). Callers pass
// the inputs they already have so unit tests can exercise every
// branch deterministically. Use the matching `readClientSessionFlag`
// helper at the call site if you want the default session probe.

const CLIENT_PATH_DEFAULT = '/client';

export type PostPurchaseDashboardArgs = {
  /** True when the visitor already has a valid client session. */
  hasSession: boolean;
  /** Optional customer email captured during the wizard (the proposer). */
  email?: string | null;
  /**
   * Public session token / policy id the wizard owns. Surfaces in the
   * `claimToken=` fallback URL and (today) is the only handle the
   * unauthenticated leg of the signup flow has on the purchased policy.
   */
  policyId?: string | null;
  /**
   * Optional deep link target the authenticated leg should jump to —
   * usually `/client` or `/client?policy=…`. Travel passes the policy
   * deep link; motor / home use the bare client root.
   */
  clientPath?: string;
};

/**
 * Resolve where to send a customer who just clicked "Go to my
 * dashboard" on the wizard's success screen.
 *
 * Pure function — no side effects. Returns an absolute path (starting
 * with `/`) the caller is responsible for navigating to.
 */
export function resolvePostPurchaseDashboardTarget(args: PostPurchaseDashboardArgs): string {
  const clientPath = args.clientPath?.trim() || CLIENT_PATH_DEFAULT;
  if (args.hasSession) return clientPath;

  const email = String(args.email ?? '').trim();
  if (email) {
    const params = new URLSearchParams({ email, redirect: clientPath });
    return `/verify-email?${params.toString()}`;
  }

  const token = String(args.policyId ?? '').trim();
  const params = new URLSearchParams({ mode: 'signup', next: clientPath });
  if (token) params.set('claimToken', token);
  return `/login?${params.toString()}`;
}

/**
 * Standard client-session probe used by the three wizards today.
 *
 * Extracted as a single seam so the synchronous, optimistic
 * `localStorage` check that all three wizards rely on lives in
 * exactly one place. When we replace it with the real `useSession`
 * hook this is the only line that has to change.
 */
export function readClientSessionFlag(): boolean {
  try {
    return Boolean(typeof window !== 'undefined' && window.localStorage?.getItem('auth_token'));
  } catch {
    return false;
  }
}

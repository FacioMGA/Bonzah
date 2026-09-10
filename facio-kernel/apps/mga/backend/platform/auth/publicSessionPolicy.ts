/**
 * Public session resolution policy.
 *
 * Public quote-session endpoints accept ONLY the opaque public-session token.
 * Legacy identifiers (UUID, policyNumber) used to be accepted in non-production
 * for dev convenience, gated by `PUBLIC_SESSION_ALLOW_LEGACY_IDS=true`. That
 * flag was deleted in PR6 of the aggressive-cleanup plan; every public route
 * now requires the canonical token.
 *
 * BO callers (authenticated `req.user`) can still resolve a policy by UUID
 * via authenticated APIs — that path does not use this policy module.
 */
export type PublicSessionResolveMode = 'token' | 'none';

export function isPublicSessionModeAllowed(mode: PublicSessionResolveMode): boolean {
  return mode === 'token';
}

export function buildPublicSessionTokenRequiredError() {
  return {
    success: false,
    error: {
      code: 'SESSION_TOKEN_REQUIRED',
      message: 'This session must be accessed via a public session token.',
    },
  };
}

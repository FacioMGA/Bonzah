/**
 * can() — Pure RBAC permission check
 *
 * Domain layer — deterministic, no side effects, no DB calls.
 * All permission resolution (DB → resolved sets) happens in app layer;
 * this function receives the resolved data and evaluates it.
 *
 * Usage:
 *   const permissions = await resolveUserPermissions(userId);
 *   if (!can(permissions, 'claims.approve_payment', { amount: 12000 })) {
 *     return res.status(403).json({ error: 'FORBIDDEN' });
 *   }
 */

export type ResolvedPermission = {
  key: string;               // "claims.approve_payment"
  constraints?: {
    maxAmount?: number;
    requiresApproval?: boolean;
    [k: string]: unknown;
  };
};

export type CanContext = {
  amount?: number;           // for financial authority checks
  [k: string]: unknown;
};

/**
 * Checks whether the resolved permission set grants access to the given key,
 * optionally validating constraint rules against context.
 */
export function can(
  permissions: ResolvedPermission[],
  permissionKey: string,
  context?: CanContext,
): boolean {
  const match = permissions.find((p) => p.key === permissionKey);
  if (!match) return false;

  // Constraint evaluation
  if (match.constraints && context) {
    if (
      match.constraints.maxAmount !== undefined &&
      context.amount !== undefined &&
      context.amount > match.constraints.maxAmount
    ) {
      return false;
    }
    if (match.constraints.requiresApproval === true) {
      // Phase 3: plug in approval workflow here; for now, allow
      // (approval requirement is surfaced in UI, not hard-blocked)
    }
  }

  return true;
}

/**
 * Convenience: check if a coarse Role string has a permission
 * via the system-role preset sets (fast path, no DB needed).
 * Used in middleware before DB-resolved sets are available.
 */
export function roleImpliesPermission(
  role: string,
  permissionKey: string,
  adminSet: Set<string>,
  underwriterSet: Set<string>,
  customerSet: Set<string>,
): boolean {
  if (role === 'ADMIN') return adminSet.has(permissionKey);
  if (role === 'UNDERWRITER') return underwriterSet.has(permissionKey);
  if (role === 'CUSTOMER') return customerSet.has(permissionKey);
  return false;
}

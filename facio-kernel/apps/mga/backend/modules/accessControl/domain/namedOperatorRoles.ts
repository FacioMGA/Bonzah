/**
 * Explicit operator role definitions.
 *
 * Product code must not hardcode these emails. The seeder looks up existing
 * User rows and assigns CUSTOM AccessRoles that operators can also change
 * in BO Configure → Users. Missing users are skipped — never invented.
 */

export type NamedOperatorRoleDef = {
  name: string;
  description: string;
  permissions: readonly string[];
  emails: readonly string[];
};

export const CONFIGURE_ADMIN_PERMISSIONS: readonly string[] = [
  'settings.configure',
  'settings.view',
  'settings.edit',
  'users.view',
  'users.invite',
  'users.edit',
  'users.assign_roles',
  'users.suspend',
  'users.reset_password',
  'users.revoke_sessions',
  'roles.view',
  'roles.create',
  'roles.edit',
  'roles.assign',
  'audit.view',
];

// Memberships are provisioned explicitly by the platform; no identity receives
// permissions because its email matches a customer-specific source fixture.
export const NAMED_OPERATOR_ROLES: readonly NamedOperatorRoleDef[] = [];

export function requiredPermissionForPolicyAssignment(args: {
  actorUserId: string;
  assignedToUserId: string;
}): 'underwriting.review.receive' | 'renewals.allocate' {
  return args.actorUserId === args.assignedToUserId
    ? 'underwriting.review.receive'
    : 'renewals.allocate';
}

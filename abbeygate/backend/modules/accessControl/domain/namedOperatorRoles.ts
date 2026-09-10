/**
 * Named-operator access roles (Danny / Peter / Andy).
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

export const NAMED_OPERATOR_ROLES: readonly NamedOperatorRoleDef[] = [
  {
    name: 'Configure Admin',
    description: 'BO Configure / admin. Assigned to Danny and Peter only — not Andy.',
    permissions: CONFIGURE_ADMIN_PERMISSIONS,
    emails: ['danny@abbeygate.cy', 'peter@abbeygate.cy'],
  },
  {
    name: 'Staff Activity',
    description: 'View the staff activity log. Assigned to Danny, Peter, and Andy.',
    permissions: ['people.activity.view'],
    emails: ['danny@abbeygate.cy', 'peter@abbeygate.cy', 'andy@abbeygate.cy', 'andy@abbeygate.pt'],
  },
  {
    name: 'Leave Input',
    description: 'Record holiday and sick leave. Assigned to Peter and Danny.',
    permissions: ['people.leave.edit'],
    emails: ['danny@abbeygate.cy', 'peter@abbeygate.cy'],
  },
  {
    name: 'Leave Cancellation',
    description: 'Cancel recorded holiday and sick leave. Assigned to Danny, Peter, and Andy.',
    permissions: ['people.leave.cancel'],
    emails: ['danny@abbeygate.cy', 'peter@abbeygate.cy', 'andy@abbeygate.cy', 'andy@abbeygate.pt'],
  },
  {
    name: 'Renewals Allocate',
    description: 'Generate the renewals list and allocate work. Assigned to Danny, Peter, and Andy.',
    permissions: ['renewals.allocate'],
    emails: ['danny@abbeygate.cy', 'peter@abbeygate.cy', 'andy@abbeygate.cy', 'andy@abbeygate.pt'],
  },
  {
    name: 'Underwriting Review',
    description: 'Take a UW review onto yourself on the policy-holder tab. Assigned to Danny, Peter, and Andy.',
    permissions: ['underwriting.review.receive'],
    emails: ['danny@abbeygate.cy', 'peter@abbeygate.cy', 'andy@abbeygate.cy', 'andy@abbeygate.pt'],
  },
];

export function requiredPermissionForPolicyAssignment(args: {
  actorUserId: string;
  assignedToUserId: string;
}): 'underwriting.review.receive' | 'renewals.allocate' {
  return args.actorUserId === args.assignedToUserId
    ? 'underwriting.review.receive'
    : 'renewals.allocate';
}

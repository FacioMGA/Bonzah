/**
 * Canonical Permission Taxonomy
 *
 * Strategic design: this is the industry SaaS standard for MGA insurance systems.
 * Every resource.action pair here maps to a row in the `permissions` table (seeded
 * at startup). Phase 3 enforcement wires `can()` checks onto existing routers.
 *
 * Domain layer — pure constants, no side effects.
 */

export type PermissionKey = `${string}.${string}`;

/**
 * Canonical parser for `resource.action` keys. Action may itself contain
 * dots (`people.activity.view`). `String.prototype.split('.', 2)` is wrong
 * here — it discards the remainder instead of keeping it as the action.
 */
export function parsePermissionKey(key: string): { resource: string; action: string } {
  const trimmed = String(key || '').trim();
  const dot = trimmed.indexOf('.');
  if (dot <= 0 || dot === trimmed.length - 1) {
    throw new Error(`Invalid permission key '${key}'`);
  }
  return { resource: trimmed.slice(0, dot), action: trimmed.slice(dot + 1) };
}

export type PermissionDef = {
  resource: string;
  action: string;
  displayName: string;
  description: string;
  constraints?: Record<string, unknown>; // shape hint for the constraint editor
};

/** Grouped by domain for the permission toggle grid UI. */
export const PERMISSION_TAXONOMY: Record<string, PermissionDef[]> = {
  Policies: [
    { resource: 'policies', action: 'view',   displayName: 'View Policies',      description: 'Read access to all policy records and their details.' },
    { resource: 'policies', action: 'create', displayName: 'Create Policy',      description: 'Create new policy records from the BO.' },
    { resource: 'policies', action: 'edit',   displayName: 'Edit Policy',        description: 'Edit policyholder details and underwriting fields.' },
    { resource: 'policies', action: 'bind',   displayName: 'Bind Policy',        description: 'Bind a quoted policy, triggering document generation.', constraints: { requiresApproval: false } },
    { resource: 'policies', action: 'issue',  displayName: 'Issue Policy',       description: 'Issue a bound policy and generate the final document pack.', constraints: { requiresApproval: false } },
    { resource: 'policies', action: 'cancel', displayName: 'Cancel Policy',      description: 'Request or approve policy cancellation.' },
    { resource: 'policies', action: 'export', displayName: 'Export Policies',    description: 'Export policy data to CSV / bordereaux.' },
  ],
  Claims: [
    { resource: 'claims', action: 'view',            displayName: 'View Claims',           description: 'Read access to all claim records.' },
    { resource: 'claims', action: 'create',          displayName: 'Create Claim',          description: 'Submit a new claim against a policy.' },
    { resource: 'claims', action: 'edit',            displayName: 'Edit Claim',            description: 'Update claim details, status, and documentation.' },
    { resource: 'claims', action: 'reserve',         displayName: 'Set Reserve',           description: 'Set or adjust the financial reserve on a claim.' },
    { resource: 'claims', action: 'approve_payment', displayName: 'Approve Payment',       description: 'Approve a claim payment up to the authority limit.', constraints: { maxAmount: 5000 } },
    { resource: 'claims', action: 'export',          displayName: 'Export Claims',         description: 'Export claims data for reporting.' },
  ],
  Billing: [
    { resource: 'billing', action: 'view',       displayName: 'View Billing',       description: 'Read access to invoices, payments, and reconciliation.' },
    { resource: 'billing', action: 'create',     displayName: 'Create Invoice',     description: 'Generate invoices for policies.' },
    { resource: 'billing', action: 'edit',       displayName: 'Edit Invoice',       description: 'Amend invoice lines and amounts.' },
    { resource: 'billing', action: 'finalize',   displayName: 'Finalize Invoice',   description: 'Lock an invoice, making it immutable for reporting.' },
    { resource: 'billing', action: 'reconcile',  displayName: 'Reconcile Payments', description: 'Match incoming payments to open invoices.' },
    { resource: 'billing', action: 'export',     displayName: 'Export Billing',     description: 'Export billing data to CSV.' },
  ],
  Endorsements: [
    { resource: 'endorsements', action: 'view',   displayName: 'View Endorsements',   description: 'Read access to all endorsement records.' },
    { resource: 'endorsements', action: 'create', displayName: 'Create Endorsement',  description: 'Draft a new mid-term adjustment.' },
    { resource: 'endorsements', action: 'bind',   displayName: 'Bind Endorsement',    description: 'Bind a drafted endorsement, updating the policy.', constraints: { requiresApproval: false } },
    { resource: 'endorsements', action: 'cancel', displayName: 'Cancel Endorsement',  description: 'Cancel an applied endorsement.' },
  ],
  Documents: [
    { resource: 'documents', action: 'view',     displayName: 'View Documents',      description: 'Access generated document packs.' },
    { resource: 'documents', action: 'generate', displayName: 'Generate Documents',  description: 'Manually trigger document pack generation.' },
    { resource: 'documents', action: 'download', displayName: 'Download Documents',  description: 'Download PDF documents from storage.' },
    { resource: 'documents', action: 'delete',   displayName: 'Delete Documents',    description: 'Remove a superseded document version.' },
  ],
  Users: [
    { resource: 'users', action: 'view',           displayName: 'View Users',          description: 'Read the user list and profiles.' },
    { resource: 'users', action: 'invite',         displayName: 'Invite Users',        description: 'Send invitations to new platform users.' },
    { resource: 'users', action: 'edit',           displayName: 'Edit Users',          description: 'Update user profile, role, and scope.' },
    { resource: 'users', action: 'assign_roles',   displayName: 'Assign Roles',        description: 'Grant and revoke access-role assignments for operators.' },
    { resource: 'users', action: 'suspend',        displayName: 'Suspend Users',       description: 'Suspend or reactivate user accounts.' },
    { resource: 'users', action: 'delete',         displayName: 'Delete Users',        description: 'Permanently remove a user record.' },
    { resource: 'users', action: 'revoke_sessions', displayName: 'Revoke Sessions',    description: 'Immediately invalidate active sessions for any user.' },
    { resource: 'users', action: 'reset_password', displayName: 'Reset Password',      description: 'Admin-trigger password reset for any user.' },
  ],
  Roles: [
    { resource: 'roles', action: 'view',    displayName: 'View Roles',         description: 'Read access roles, permission matrices, and member assignments.' },
    { resource: 'roles', action: 'create',  displayName: 'Create Roles',       description: 'Create custom access roles.' },
    { resource: 'roles', action: 'edit',    displayName: 'Edit Roles',         description: 'Update custom access role details and permissions.' },
    { resource: 'roles', action: 'assign',  displayName: 'Manage Memberships', description: 'Assign or remove users from access roles.' },
    { resource: 'roles', action: 'archive', displayName: 'Archive Roles',      description: 'Archive custom roles so they can no longer be assigned.' },
  ],
  Audit: [
    { resource: 'audit', action: 'view', displayName: 'View Access Audit', description: 'Read the access control audit trail and role-change history.' },
  ],
  Programs: [
    { resource: 'programs', action: 'view',    displayName: 'View Programs',     description: 'Read program and binder configuration.' },
    { resource: 'programs', action: 'create',  displayName: 'Create Program',    description: 'Create a new underwriting program.' },
    { resource: 'programs', action: 'edit',    displayName: 'Edit Program',      description: 'Edit program rules, MBE config, and rating models.' },
    { resource: 'programs', action: 'publish', displayName: 'Publish Program',   description: 'Publish a program, making it available for quoting.' },
    { resource: 'programs', action: 'archive', displayName: 'Archive Program',   description: 'Archive an inactive program.' },
  ],
  Binders: [
    { resource: 'binders', action: 'view',    displayName: 'View Binders',     description: 'Read binder details and linked programs.' },
    { resource: 'binders', action: 'create',  displayName: 'Create Binder',    description: 'Create a new Lloyd\'s binder record.' },
    { resource: 'binders', action: 'edit',    displayName: 'Edit Binder',      description: 'Edit binder fields and authority parameters.' },
    { resource: 'binders', action: 'publish', displayName: 'Publish Binder', description: 'Activate a reviewed binder and its authority configuration.' },
    { resource: 'binders', action: 'archive', displayName: 'Archive Binder',   description: 'Archive an expired or replaced binder.' },
  ],
  Reports: [
    { resource: 'reports', action: 'view',     displayName: 'View Reports',      description: 'Access generated reports and bordereaux.' },
    { resource: 'reports', action: 'generate', displayName: 'Generate Reports',  description: 'Run on-demand bordereaux and analytics reports.' },
    { resource: 'reports', action: 'export',   displayName: 'Export Reports',    description: 'Download report data as CSV or Excel.' },
    { resource: 'reports', action: 'schedule', displayName: 'Schedule Reports',  description: 'Configure automated report generation schedules.' },
  ],
  Settings: [
    { resource: 'settings', action: 'view', displayName: 'View Settings',  description: 'Read platform configuration and templates.' },
    { resource: 'settings', action: 'edit', displayName: 'Edit Settings',  description: 'Update global settings, templates, and financial rules.' },
    { resource: 'settings', action: 'configure', displayName: 'Configure Admin', description: 'Open BO Configure (users, roles, binders, programs). Assigned to Danny and Peter; not Andy.' },
  ],
  People: [
    { resource: 'people', action: 'activity.view', displayName: 'View Staff Activity', description: 'Open the staff activity log. Assigned to Danny, Peter, and Andy.' },
    { resource: 'people', action: 'leave.view', displayName: 'View Leave Calendar', description: 'View holiday and sick leave for all staff.' },
    { resource: 'people', action: 'leave.edit', displayName: 'Input Leave', description: 'Record holiday and sick leave. Assigned to Peter and Danny.' },
    { resource: 'people', action: 'leave.cancel', displayName: 'Cancel Leave', description: 'Cancel a recorded staff absence. Assigned to Danny, Peter, and Andy.' },
    { resource: 'people', action: 'diary.view', displayName: 'View Staff Diaries', description: 'Open every staff diary that is marked STAFF visibility.' },
  ],
  Renewals: [
    { resource: 'renewals', action: 'worklist.view', displayName: 'View Renewals Worklist', description: 'Open the renewals worklist (existing Renewal Queue).' },
    { resource: 'renewals', action: 'allocate', displayName: 'Generate / Allocate Renewals', description: 'Generate the renewals list and allocate work. Assigned to Danny, Peter, and Andy.' },
  ],
  Underwriting: [
    { resource: 'underwriting', action: 'review.receive', displayName: 'Take UW Review', description: 'Assign a UW review to yourself on the policy-holder tab. Assigned to Danny, Peter, and Andy.' },
  ],
  Accounts: [
    { resource: 'accounts', action: 'notes.view', displayName: 'View Client Notes', description: 'Read staff notes on client account files.' },
    { resource: 'accounts', action: 'notes.create', displayName: 'Add Client Notes', description: 'Add staff notes on client account files visible to all staff.' },
  ],
  /**
   * Config MCP permission family (ADR-0036). All Config MCP tool calls
   * map to one of these permissions. `publish_production` is reserved —
   * no V1 tool wires it.
   */
  Configuration: [
    { resource: 'configuration', action: 'read',               displayName: 'Read Config Drafts',              description: 'Read product launch templates, drafts, and validation issues via Config MCP.' },
    { resource: 'configuration', action: 'draft',              displayName: 'Edit Config Drafts',              description: 'Clone templates and stage configuration changes via Config MCP tools.' },
    { resource: 'configuration', action: 'validate',           displayName: 'Validate Config Drafts',          description: 'Run validation against a Config MCP draft.' },
    { resource: 'configuration', action: 'simulate',           displayName: 'Simulate Config Drafts',          description: 'Run quote and scenario simulations against a Config MCP draft.' },
    { resource: 'configuration', action: 'publish_sandbox',    displayName: 'Publish to Sandbox',              description: 'Publish a validated, simulated Config MCP draft into a SYNTHETIC tenant.' },
    { resource: 'configuration', action: 'publish_production', displayName: 'Publish to Production (V2)',     description: 'Reserved — production publishing is out of V1 scope.', constraints: { v1: false } },
  ],
  /**
   * Operator MCP permission family (ADR-0036 amendment #2). All
   * `operator.*` MCP tool calls map to one of these. `operator.mutate`
   * is reserved for V2 (quote mutation, endorsement drafts) and is
   * never granted to a V1 key.
   */
  Operator: [
    { resource: 'operator', action: 'read',      displayName: 'Read Operator Data',          description: 'Search customers, quotes, policies; read account context via Operator MCP.' },
    { resource: 'operator', action: 'comm',      displayName: 'Send Approved Comms',         description: 'Send wizard / quote / FNOL / document-resend links via approved templates only.' },
    { resource: 'operator', action: 'analytics', displayName: 'Read Operator Analytics',     description: 'List UW queue, sales stats, conversion funnel via Operator MCP.' },
    { resource: 'operator', action: 'mutate',    displayName: 'Mutate Quotes / Endorsements (V2)', description: 'Reserved — quote mutation and endorsement drafts are out of V1 scope.', constraints: { v1: false } },
  ],
};

/** Flat list of all permissions for seeding and lookup. */
export const ALL_PERMISSIONS: PermissionDef[] = Object.values(PERMISSION_TAXONOMY).flat();

/** What ADMIN gets: everything. */
export const ADMIN_PERMISSIONS: Set<string> = new Set(
  ALL_PERMISSIONS.map((p) => `${p.resource}.${p.action}`)
);

/** What a Technician gets: operational data entry, no authority actions. */
export const TECHNICIAN_PERMISSIONS: Set<string> = new Set([
  'policies.view', 'policies.create', 'policies.edit',
  'claims.view', 'claims.create', 'claims.edit',
  'billing.view', 'billing.create',
  'endorsements.view', 'endorsements.create',
  'documents.view',
  'accounts.notes.view', 'accounts.notes.create',
  'programs.view',
  'binders.view',
  'reports.view', 'reports.generate',
  'operator.read', 'operator.comm', 'operator.analytics',
  'people.leave.view',
  'people.diary.view',
  'renewals.worklist.view',
]);

/** Authority overlay for managers who can bind, issue, export, and download. */
export const MANAGER_AUTHORITY_PERMISSIONS: Set<string> = new Set([
  ...TECHNICIAN_PERMISSIONS,
  'policies.bind', 'policies.issue', 'policies.cancel', 'policies.export',
  'claims.reserve', 'claims.approve_payment', 'claims.export',
  'billing.finalize', 'billing.reconcile', 'billing.export',
  'endorsements.bind', 'endorsements.cancel',
  'documents.generate', 'documents.download',
  'reports.export', 'reports.schedule',
]);

/** Coarse UNDERWRITER users map to Technician unless an authority AccessRole is assigned. */
export const UNDERWRITER_PERMISSIONS: Set<string> = TECHNICIAN_PERMISSIONS;

/** What CUSTOMER gets: self-service portal access only. */
export const CUSTOMER_PERMISSIONS: Set<string> = new Set([
  'policies.view',
  'documents.view', 'documents.download',
]);

/**
 * Baseline for remote Config MCP API keys (ADR-0036 amendment).
 *
 * An API-key-authenticated agent (Claude / ChatGPT / Cursor talking to
 * /api/v1/mcp/config via the official MCP Streamable HTTP transport)
 * carries no User; instead it presents a `facio_…` token whose
 * `ApiKey.permissions` array is set at issuance time.
 *
 * Every MCP key is issued with this baseline. Sandbox publish
 * (`configuration.publish_sandbox`) is opt-in per key at generation
 * time. Production publish stays unreachable from any MCP key in V1.
 */
export const CONFIG_AGENT_BASELINE: readonly string[] = [
  'configuration.read',
  'configuration.draft',
  'configuration.validate',
  'configuration.simulate',
];

/** Optional opt-ins available at key creation time. */
export const CONFIG_AGENT_OPTIONAL: readonly string[] = [
  'configuration.publish_sandbox',
];

/**
 * Baseline for remote Operator MCP API keys (ADR-0036 amendment #2).
 *
 * V1 has no opt-ins — `operator.mutate` (quote fork/update/save,
 * endorsement drafts) is V2 scope. The full V2 ADR will add a per-key
 * opt-in plus confirmation-token preview store.
 */
export const OPERATOR_AGENT_BASELINE: readonly string[] = [
  'operator.read',
  'operator.comm',
  'operator.analytics',
];

/**
 * Per-key opt-ins available at key creation time. V2 added
 * `operator.mutate` (quote fork/update/save + endorsement drafts) —
 * see ADR-0039. The BO operator issuing the key must themselves hold
 * `operator.mutate` (defense-in-depth in `mcpKeysRouter`).
 */
export const OPERATOR_AGENT_OPTIONAL: readonly string[] = [
  'operator.mutate',
  'policies.bind',
  'documents.view',
];

/**
 * OAuth consent-gating (ADR-0040 §6 — MCP V2.1).
 *
 * Splits the scope set into "what this BO user is allowed to grant to
 * an OAuth client" vs "what would require an ADMIN to grant". The rule:
 *
 *   - ADMIN role: may grant ANY scope (operator.* + configuration.*).
 *   - non-admin BO role (UNDERWRITER, MANAGER, etc.): may grant
 *     operator.* scopes ONLY. configuration.* requires ADMIN.
 *   - Defense-in-depth on operator.mutate: the consenting user must
 *     ALSO hold operator.mutate themselves (per their resolved
 *     permissions, not the global taxonomy).
 *
 * Returns the grantable subset + the rejected subset. Never throws —
 * the consent UI uses the rejected list to render "requires ADMIN"
 * badges so the BO user understands why something is greyed out.
 *
 * Single owner: consumed by the OAuth consent router. Pinned by
 * `tools/quality/check-oauth-consent-role-gate.mjs` — every consent
 * handler MUST call this before issuing a code.
 */
export interface ConsentGrantDecision {
  grantable: string[];
  rejected: Array<{ scope: string; reason: 'requires_admin' | 'requires_explicit_operator_mutate' }>;
}

export function assertCanGrantScopes(args: {
  role: string | null | undefined;
  userPermissions: readonly string[];
  requestedScopes: readonly string[];
}): ConsentGrantDecision {
  const role = String(args.role || '').trim().toUpperCase();
  const isAdmin = role === 'ADMIN';
  const userPermissions = new Set(args.userPermissions || []);
  const hasOperatorMutate = userPermissions.has('operator.mutate');
  const grantable: string[] = [];
  const rejected: ConsentGrantDecision['rejected'] = [];
  for (const scope of args.requestedScopes) {
    if (
      scope.startsWith('configuration.') ||
      scope.startsWith('programs.') ||
      scope.startsWith('binders.')
    ) {
      if (isAdmin) {
        grantable.push(scope);
      } else {
        rejected.push({ scope, reason: 'requires_admin' });
      }
      continue;
    }
    if (scope === 'operator.mutate' && !isAdmin && !hasOperatorMutate) {
      rejected.push({ scope, reason: 'requires_explicit_operator_mutate' });
      continue;
    }
    if (scope.startsWith('policies.') || scope.startsWith('documents.')) {
      if (isAdmin || userPermissions.has(scope)) {
        grantable.push(scope);
      } else {
        rejected.push({ scope, reason: 'requires_admin' });
      }
      continue;
    }
    if (scope.startsWith('operator.')) {
      grantable.push(scope);
      continue;
    }
    // Unknown scopes are silently dropped — same posture as
    // parseScopeString in oauth/domain/scopes.ts.
  }
  return { grantable, rejected };
}

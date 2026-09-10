import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, hash, KernelError } from '../domain/canonical.js';
import { scopeSchema, type Scope } from '../contracts/configuration.js';
import {
  accountSchema,
  tenantRecordSchema,
  requirementsAttachmentSchema,
  runtimeDraftSchema,
  sandboxReleaseSchema,
  principalSchema,
  type TenantRecord,
  type RequirementsAttachment,
  type RuntimeDraft,
  type SandboxRelease,
  type Principal,
  type AccountBootstrap,
  type AccountRole,
} from '../contracts/control-plane.js';

export const controlScopeKey = (s: Scope) =>
  canonicalJson([s.workspaceId, s.tenantId, s.environment, s.operatingEntityId]);
const forbidden = () =>
  new KernelError('FORBIDDEN', 'The current membership does not authorize this resource', 403);
const integrity = () =>
  new KernelError('INTEGRITY_ERROR', 'Persisted sandbox data failed its integrity check', 500);
/** Repositories share Store's connection and transaction. No independent commits or asynchronous work. */
export class ControlStorage {
  constructor(private readonly db: DatabaseSync) {}
  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS control_accounts(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,display_name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS control_actors(actor_id TEXT PRIMARY KEY,issuer TEXT NOT NULL,subject TEXT NOT NULL,UNIQUE(issuer,subject));
      CREATE TABLE IF NOT EXISTS control_memberships(account_id TEXT NOT NULL REFERENCES control_accounts(id),actor_id TEXT NOT NULL REFERENCES control_actors(actor_id),role TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','revoked')),PRIMARY KEY(account_id,actor_id));
      CREATE TABLE IF NOT EXISTS control_invitations(account_id TEXT NOT NULL REFERENCES control_accounts(id),issuer TEXT NOT NULL,email TEXT NOT NULL,role TEXT NOT NULL,accepted_actor_id TEXT,status TEXT NOT NULL CHECK(status IN ('pending','accepted','revoked')),PRIMARY KEY(account_id,issuer,email));
      CREATE TABLE IF NOT EXISTS control_tenants(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES control_accounts(id),scope TEXT NOT NULL UNIQUE,operation_id TEXT NOT NULL UNIQUE,owner_actor_id TEXT NOT NULL REFERENCES control_actors(actor_id),tenant_json TEXT NOT NULL,tenant_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS control_tenant_memberships(tenant_id TEXT NOT NULL REFERENCES control_tenants(id),actor_id TEXT NOT NULL REFERENCES control_actors(actor_id),role TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','revoked')),PRIMARY KEY(tenant_id,actor_id));
      CREATE TABLE IF NOT EXISTS control_requests(account_id TEXT NOT NULL,operation TEXT NOT NULL,key TEXT NOT NULL,request_hash TEXT NOT NULL,result_json TEXT NOT NULL,result_hash TEXT NOT NULL,PRIMARY KEY(account_id,operation,key));
      CREATE TABLE IF NOT EXISTS control_requirements(tenant_id TEXT NOT NULL REFERENCES control_tenants(id),version INTEGER NOT NULL,attachment_json TEXT NOT NULL,attachment_hash TEXT NOT NULL,PRIMARY KEY(tenant_id,version));
      CREATE TABLE IF NOT EXISTS control_runtime_drafts(tenant_id TEXT PRIMARY KEY REFERENCES control_tenants(id),version INTEGER NOT NULL,draft_json TEXT NOT NULL,draft_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS control_sandbox_releases(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES control_tenants(id),scope TEXT NOT NULL,version INTEGER NOT NULL,bundle_json TEXT NOT NULL,bundle_hash TEXT NOT NULL,UNIQUE(tenant_id,version));
      CREATE TABLE IF NOT EXISTS control_active_releases(tenant_id TEXT PRIMARY KEY REFERENCES control_tenants(id),release_id TEXT NOT NULL REFERENCES control_sandbox_releases(id));
      CREATE TABLE IF NOT EXISTS control_audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,account_id TEXT,tenant_id TEXT,operation TEXT NOT NULL,outcome TEXT NOT NULL,correlation_id TEXT NOT NULL,created_at TEXT NOT NULL);
      INSERT OR IGNORE INTO schema_migrations VALUES(4);
      INSERT OR IGNORE INTO schema_migrations VALUES(5);
    `);
    for (const table of [
      'control_requirements',
      'control_sandbox_releases',
      'control_requests',
      'control_audit',
    ])
      for (const action of ['UPDATE', 'DELETE'])
        this.db.exec(
          `CREATE TRIGGER IF NOT EXISTS ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'immutable sandbox evidence'); END;`,
        );
  }
  private parse<T>(schema: z.ZodType<T>, raw: unknown, expectedHash: unknown): T {
    try {
      const value = schema.parse(JSON.parse(String(raw)));
      if (hash(value) !== expectedHash) throw integrity();
      return value;
    } catch {
      throw integrity();
    }
  }
  private ensureActor(actor: { issuer: string; subject: string; actorId: string }) {
    principalSchema.parse({
      issuer: actor.issuer,
      subject: actor.subject,
      actorId: actor.actorId,
      correlationId: randomUUID(),
    });
    const existing = this.db
      .prepare(
        'SELECT actor_id,issuer,subject FROM control_actors WHERE actor_id=? OR (issuer=? AND subject=?)',
      )
      .all(actor.actorId, actor.issuer, actor.subject);
    if (
      existing.some(
        (row) =>
          row.actor_id !== actor.actorId ||
          row.issuer !== actor.issuer ||
          row.subject !== actor.subject,
      )
    )
      throw integrity();
    this.db
      .prepare('INSERT OR IGNORE INTO control_actors VALUES(?,?,?)')
      .run(actor.actorId, actor.issuer, actor.subject);
  }
  bootstrap(input: AccountBootstrap) {
    const account = accountSchema.omit({ role: true }).parse({
      id: input.accountId,
      workspaceId: input.workspaceId,
      displayName: input.displayName,
    });
    const existing = this.db
      .prepare('SELECT workspace_id FROM control_accounts WHERE id=?')
      .get(account.id);
    if (existing && existing.workspace_id !== account.workspaceId) throw integrity();
    this.db
      .prepare('INSERT OR IGNORE INTO control_accounts VALUES(?,?,?)')
      .run(account.id, account.workspaceId, account.displayName);
    for (const member of input.members) {
      accountSchema.shape.role.parse(member.role);
      if ('subject' in member) {
        this.ensureActor(member);
        this.db
          .prepare("INSERT OR IGNORE INTO control_memberships VALUES(?,?,?,'active')")
          .run(account.id, member.actorId, member.role);
      } else {
        const email = z.string().email().parse(member.email).toLowerCase();
        this.db
          .prepare("INSERT OR IGNORE INTO control_invitations VALUES(?,?,?,?,NULL,'pending')")
          .run(account.id, member.issuer, email, member.role);
      }
    }
  }
  acceptInvitation(principal: Principal) {
    if (!principal.email) return;
    const invitations = this.db
      .prepare(
        "SELECT account_id,role FROM control_invitations WHERE issuer=? AND email=? AND status='pending'",
      )
      .all(principal.issuer, principal.email.toLowerCase());
    if (!invitations.length) return;
    this.ensureActor(principal);
    for (const invitation of invitations) {
      this.db
        .prepare("INSERT OR IGNORE INTO control_memberships VALUES(?,?,?,'active')")
        .run(String(invitation.account_id), principal.actorId, String(invitation.role));
      this.db
        .prepare(
          "UPDATE control_invitations SET status='accepted',accepted_actor_id=? WHERE account_id=? AND issuer=? AND email=? AND status='pending'",
        )
        .run(
          principal.actorId,
          String(invitation.account_id),
          principal.issuer,
          principal.email.toLowerCase(),
        );
    }
  }
  assertActor(principal: Principal) {
    const row = this.db
      .prepare('SELECT actor_id FROM control_actors WHERE issuer=? AND subject=?')
      .get(principal.issuer, principal.subject);
    if (!row || row.actor_id !== principal.actorId) throw forbidden();
  }
  accounts(principal: Principal) {
    this.assertActor(principal);
    return this.db
      .prepare(
        "SELECT a.id,a.workspace_id AS workspaceId,a.display_name AS displayName,m.role FROM control_accounts a JOIN control_memberships m ON m.account_id=a.id WHERE m.actor_id=? AND m.status='active' ORDER BY a.id",
      )
      .all(principal.actorId)
      .map((row) => accountSchema.parse(row));
  }
  account(principal: Principal, accountId: string) {
    const account = this.accounts(principal).find((a) => a.id === accountId);
    if (!account) throw forbidden();
    return account;
  }
  tenant(tenantId: string): TenantRecord {
    const row = this.db
      .prepare(
        'SELECT tenant_json,tenant_hash,account_id,scope,operation_id,owner_actor_id FROM control_tenants WHERE id=?',
      )
      .get(tenantId);
    if (!row) throw new KernelError('NOT_FOUND', 'Sandbox tenant not found', 404);
    const tenant = this.parse(tenantRecordSchema, row.tenant_json, row.tenant_hash);
    if (
      tenant.id !== tenantId ||
      tenant.accountId !== row.account_id ||
      controlScopeKey(tenant.scope) !== row.scope ||
      tenant.operationId !== row.operation_id ||
      tenant.ownerActorId !== row.owner_actor_id
    )
      throw integrity();
    return tenant;
  }
  tenantForOperation(operationId: string) {
    const row = this.db
      .prepare('SELECT id FROM control_tenants WHERE operation_id=?')
      .get(operationId);
    if (!row) throw new KernelError('NOT_FOUND', 'Provisioning operation not found', 404);
    return this.tenant(String(row.id));
  }
  authorize(principal: Principal, tenantId: string): { tenant: TenantRecord; role: AccountRole } {
    // Tenant existence is not disclosed until a matching membership is established.
    this.assertActor(principal);
    const row = this.db
      .prepare('SELECT account_id,owner_actor_id FROM control_tenants WHERE id=?')
      .get(tenantId);
    if (!row) throw forbidden();
    const account = this.account(principal, String(row.account_id));
    if (account.role === 'owner' || account.role === 'admin')
      return { tenant: this.tenant(tenantId), role: account.role };
    const membership = this.db
      .prepare(
        'SELECT role,status FROM control_tenant_memberships WHERE tenant_id=? AND actor_id=?',
      )
      .get(tenantId, principal.actorId);
    if (membership) {
      if (membership.status !== 'active') throw forbidden();
      const role = accountSchema.shape.role.parse(membership.role);
      return { tenant: this.tenant(tenantId), role: account.role === 'viewer' ? 'viewer' : role };
    }
    if (row.owner_actor_id === principal.actorId && account.role === 'builder')
      return { tenant: this.tenant(tenantId), role: 'builder' };
    throw forbidden();
  }
  tenants(principal: Principal) {
    const accountIds = new Set(this.accounts(principal).map((a) => a.id));
    return this.db
      .prepare('SELECT id,account_id FROM control_tenants ORDER BY rowid DESC')
      .all()
      .filter((row) => accountIds.has(String(row.account_id)))
      .flatMap((row) => {
        try {
          return [this.authorize(principal, String(row.id)).tenant];
        } catch (error) {
          if (error instanceof KernelError && error.code === 'FORBIDDEN') return [];
          throw error;
        }
      });
  }
  insertTenant(tenant: TenantRecord) {
    const value = tenantRecordSchema.parse(tenant);
    this.db
      .prepare('INSERT INTO control_tenants VALUES(?,?,?,?,?,?,?)')
      .run(
        value.id,
        value.accountId,
        controlScopeKey(value.scope),
        value.operationId,
        value.ownerActorId,
        canonicalJson(value),
        hash(value),
      );
  }
  updateTenant(tenant: TenantRecord) {
    const old = this.tenant(tenant.id);
    if (
      old.accountId !== tenant.accountId ||
      old.operationId !== tenant.operationId ||
      old.ownerActorId !== tenant.ownerActorId ||
      controlScopeKey(old.scope) !== controlScopeKey(tenant.scope)
    )
      throw integrity();
    this.db
      .prepare('UPDATE control_tenants SET tenant_json=?,tenant_hash=? WHERE id=?')
      .run(canonicalJson(tenantRecordSchema.parse(tenant)), hash(tenant), tenant.id);
  }
  isManaged(scope: Scope) {
    return !!this.db
      .prepare('SELECT id FROM control_tenants WHERE scope=?')
      .get(controlScopeKey(scope));
  }
  tenantIdForScope(scope: Scope): string | null {
    const row = this.db
      .prepare('SELECT id FROM control_tenants WHERE scope=?')
      .get(controlScopeKey(scope));
    return row ? String(row.id) : null;
  }
  replay(
    accountId: string,
    operation: string,
    key: string,
    requestHash: string,
  ): unknown | undefined {
    const row = this.db
      .prepare(
        'SELECT request_hash,result_json,result_hash FROM control_requests WHERE account_id=? AND operation=? AND key=?',
      )
      .get(accountId, operation, key);
    if (!row) return undefined;
    if (row.request_hash !== requestHash)
      throw new KernelError(
        'IDEMPOTENCY_CONFLICT',
        'This key was already used for another control-plane request',
        409,
      );
    const value = JSON.parse(String(row.result_json));
    if (hash(value) !== row.result_hash) throw integrity();
    return value;
  }
  remember(
    accountId: string,
    operation: string,
    key: string,
    requestHash: string,
    result: unknown,
  ) {
    this.db
      .prepare('INSERT INTO control_requests VALUES(?,?,?,?,?,?)')
      .run(accountId, operation, key, requestHash, canonicalJson(result), hash(result));
  }
  requirements(tenantId: string): RequirementsAttachment | null {
    const row = this.db
      .prepare(
        'SELECT attachment_json,attachment_hash FROM control_requirements WHERE tenant_id=? ORDER BY version DESC LIMIT 1',
      )
      .get(tenantId);
    return row
      ? this.parse(requirementsAttachmentSchema, row.attachment_json, row.attachment_hash)
      : null;
  }
  attach(tenantId: string, value: RequirementsAttachment) {
    this.db
      .prepare('INSERT INTO control_requirements VALUES(?,?,?,?)')
      .run(
        tenantId,
        value.version,
        canonicalJson(requirementsAttachmentSchema.parse(value)),
        hash(value),
      );
  }
  runtimeDraft(tenantId: string): RuntimeDraft {
    const row = this.db
      .prepare('SELECT draft_json,draft_hash FROM control_runtime_drafts WHERE tenant_id=?')
      .get(tenantId);
    if (!row) return { version: 1, hash: hash([]), policies: [] };
    const value = this.parse(runtimeDraftSchema, row.draft_json, row.draft_hash);
    if (hash(value.policies) !== value.hash) throw integrity();
    return value;
  }
  saveRuntimeDraft(tenantId: string, value: RuntimeDraft) {
    this.db
      .prepare(
        'INSERT INTO control_runtime_drafts VALUES(?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET version=excluded.version,draft_json=excluded.draft_json,draft_hash=excluded.draft_hash',
      )
      .run(tenantId, value.version, canonicalJson(runtimeDraftSchema.parse(value)), hash(value));
  }
  release(scope: Scope, releaseId?: string): SandboxRelease | null {
    const row = releaseId
      ? this.db
          .prepare(
            'SELECT bundle_json,bundle_hash FROM control_sandbox_releases WHERE id=? AND scope=?',
          )
          .get(releaseId, controlScopeKey(scope))
      : this.db
          .prepare(
            'SELECT r.bundle_json,r.bundle_hash FROM control_sandbox_releases r JOIN control_active_releases a ON a.release_id=r.id WHERE r.scope=?',
          )
          .get(controlScopeKey(scope));
    if (!row) return null;
    const value = this.parse(sandboxReleaseSchema, row.bundle_json, row.bundle_hash);
    const { hash: contentHash, ...content } = value;
    if (
      (releaseId !== undefined && value.id !== releaseId) ||
      hash(content) !== contentHash ||
      controlScopeKey(value.scope) !== controlScopeKey(scope) ||
      hash(value.configuration.configuration) !== value.configuration.hash ||
      hash(value.requirements.profile) !== value.requirements.sourceProfileHash ||
      hash(value.runtimeDraft.policies) !== value.runtimeDraft.hash
    )
      throw integrity();
    return value;
  }
  activate(value: SandboxRelease) {
    sandboxReleaseSchema.parse(value);
    this.db
      .prepare('INSERT INTO control_sandbox_releases VALUES(?,?,?,?,?,?)')
      .run(
        value.id,
        value.tenantId,
        controlScopeKey(value.scope),
        value.version,
        canonicalJson(value),
        hash(value),
      );
    this.db
      .prepare(
        'INSERT INTO control_active_releases VALUES(?,?) ON CONFLICT(tenant_id) DO UPDATE SET release_id=excluded.release_id',
      )
      .run(value.tenantId, value.id);
  }
  nextReleaseVersion(tenantId: string): number {
    const row = this.db
      .prepare('SELECT MAX(version) AS version FROM control_sandbox_releases WHERE tenant_id=?')
      .get(tenantId);
    return Number(row?.version ?? 0) + 1;
  }
  selectRelease(tenantId: string, releaseId: string) {
    const tenant = this.tenant(tenantId);
    const release = this.release(tenant.scope, releaseId);
    if (!release || release.tenantId !== tenantId)
      throw new KernelError(
        'RELEASE_NOT_AVAILABLE',
        'The retained release is not available in this tenant',
        404,
      );
    this.db
      .prepare(
        'INSERT INTO control_active_releases VALUES(?,?) ON CONFLICT(tenant_id) DO UPDATE SET release_id=excluded.release_id',
      )
      .run(tenantId, release.id);
  }
  requireRevocableMember(accountId: string, actorId: string, tenantId?: string) {
    const member = this.db
      .prepare('SELECT role,status FROM control_memberships WHERE account_id=? AND actor_id=?')
      .get(accountId, actorId);
    if (!member) throw new KernelError('NOT_FOUND', 'Account member not found', 404);
    if (tenantId && (member.role === 'owner' || member.role === 'admin'))
      throw new KernelError(
        'ACCOUNT_ADMIN_SCOPE',
        'Account administrators inherit tenant access; revoke their account membership instead',
        409,
      );
    if (
      !tenantId &&
      member.status === 'active' &&
      (member.role === 'owner' || member.role === 'admin')
    ) {
      const count = this.db
        .prepare(
          "SELECT count(*) AS count FROM control_memberships WHERE account_id=? AND status='active' AND role IN ('owner','admin')",
        )
        .get(accountId);
      if (Number(count?.count ?? 0) <= 1)
        throw new KernelError(
          'LAST_ADMIN_REQUIRED',
          'Retain at least one active account administrator',
          409,
        );
    }
  }
  revoke(accountId: string, actorId: string, tenantId?: string) {
    if (tenantId)
      this.db
        .prepare(
          "INSERT INTO control_tenant_memberships VALUES(?,?,'viewer','revoked') ON CONFLICT(tenant_id,actor_id) DO UPDATE SET status='revoked'",
        )
        .run(tenantId, actorId);
    else
      this.db
        .prepare(
          "UPDATE control_memberships SET status='revoked' WHERE account_id=? AND actor_id=?",
        )
        .run(accountId, actorId);
  }
  audit(
    principal: Principal,
    operation: string,
    outcome: string,
    accountId: string | null = null,
    tenantId: string | null = null,
  ) {
    this.db
      .prepare('INSERT INTO control_audit VALUES(?,?,?,?,?,?,?,?)')
      .run(
        randomUUID(),
        principal.actorId,
        accountId,
        tenantId,
        operation,
        outcome,
        principal.correlationId,
        new Date().toISOString(),
      );
  }
}

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { contextSchema, permissions, type Context } from '../contracts/configuration.js';
import {
  principalSchema,
  controlOperations,
  tenantSetupSchema,
  sandboxReleaseSchema,
  sandboxRegionResidencies,
  type Principal,
  type AccountBootstrap,
  type ControlPlaneOptions,
  type ControlOperationName,
  type TenantRecord,
  type TenantSetup,
  type RuntimeDraft,
} from '../contracts/control-plane.js';
import { canonicalJson, hash, KernelError } from '../domain/canonical.js';
import { validateConfiguration } from '../domain/validate.js';
import { RequirementsRegistry } from './requirements.js';
import { Store } from '../storage/store.js';

const fail = (code: string, message: string, status = 422): never => {
  throw new KernelError(code, message, status);
};
const writer = (role: string) => role === 'owner' || role === 'admin' || role === 'builder';
const capabilities = new Set([
  'definition_validation',
  'manual_external_quote',
  'exact_money',
  'insurance_decisions',
  'coverage_rating',
]);
export class ControlPlane {
  constructor(
    private readonly store: Store,
    readonly options: ControlPlaneOptions,
  ) {}
  /** Trusted startup allowlist only. Existing memberships, including revocations, are preserved. */
  bootstrapAccount(input: AccountBootstrap) {
    this.store.transaction(() => this.store.control.bootstrap(input));
  }
  /** Call only after provider signature, issuer, audience, organization and verified email checks. */
  acceptVerifiedInvitation(principal: Principal) {
    const parsed = principalSchema.parse(principal);
    this.store.transaction(() => this.store.control.acceptInvitation(parsed));
  }
  session(principal: Principal) {
    principalSchema.parse(principal);
    return this.store.transaction(() => ({
      principal,
      accounts: this.store.control.accounts(principal),
      tenants: this.store.control.tenants(principal),
    }));
  }
  resolveContext(principal: Principal, tenantId: string): Context {
    principalSchema.parse(principal);
    const { tenant, role } = this.store.control.authorize(
      principal,
      z.string().uuid().parse(tenantId),
    );
    return contextSchema.parse({
      ...tenant.scope,
      actorId: principal.actorId,
      correlationId: principal.correlationId,
      permissions: writer(role)
        ? permissions.filter(
            (permission) =>
              !['insurance:approve', 'finance:post', 'finance:reconcile'].includes(permission) ||
              role === 'owner' ||
              role === 'admin',
          )
        : [
            'configuration:read',
            'insurance:read',
            'provider:read',
            'documents:read',
            'finance:read',
            'fnol:read',
          ],
    });
  }
  private setup(principal: Principal, tenantId: string): TenantSetup {
    const context = this.resolveContext(principal, tenantId);
    const tenant = this.store.control.tenant(tenantId);
    const requirements = this.store.control.requirements(tenantId);
    const runtimeDraft = this.store.control.runtimeDraft(tenantId);
    const snapshot = this.store.read(context, 'draft');
    // Runtime capability validation is specific to this executable release. Future inventory gaps remain visible elsewhere.
    const metadata = {
      ...snapshot.configuration,
      products: snapshot.configuration.products.map((p) => ({
        ...p,
        requiredCapabilities: p.requiredCapabilities.filter(
          (c) => !capabilities.has(c) || c === 'definition_validation',
        ),
      })),
    };
    const report = validateConfiguration(metadata, context, snapshot);
    const blockers = report.gaps
      .filter((g) => g.code === 'CONFIGURATION_GAP' || g.field.includes('.requiredCapabilities.'))
      .map((g) => g.currentState);
    const deployedResidency =
      sandboxRegionResidencies[this.options.region as keyof typeof sandboxRegionResidencies];
    if (
      deployedResidency &&
      snapshot.configuration.tenant &&
      snapshot.configuration.tenant.residency !== deployedResidency
    )
      blockers.push(
        `Tenant residency ${snapshot.configuration.tenant.residency} does not match this host in ${this.options.region} (${deployedResidency}). Change the draft residency or provision in an approved matching region.`,
      );
    if (!requirements)
      blockers.push(
        'Attach a requirements profile before activation. Source document claims remain unverified.',
      );
    if (!runtimeDraft.policies.length)
      blockers.push('Configure at least one supported executable insurance policy.');
    if (snapshot.configuration.integrations.length)
      blockers.push('Provider adapters are not supported by this manual sandbox release.');
    const seen = new Set<string>();
    for (const policy of runtimeDraft.policies) {
      const key = policy.id + '@' + policy.version;
      if (seen.has(key)) blockers.push(`Duplicate runtime policy ${key}.`);
      seen.add(key);
      const product = snapshot.configuration.products.find(
        (p) => p.id === policy.id && p.version === policy.version,
      );
      if (!product || product.operatingEntityId !== context.operatingEntityId)
        blockers.push(
          `Runtime policy ${key} must match a product in the authorized operating entity.`,
        );
      if (policy.effectiveFrom > policy.effectiveTo)
        blockers.push(`Runtime policy ${key} has an invalid effective window.`);
      if (
        policy.requirements.payment !== 'not_required' ||
        policy.requirements.providerVerification !== 'not_required' ||
        !['not_required', 'independent_review'].includes(policy.requirements.approval)
      )
        blockers.push(
          `Runtime policy ${key} requires an unsupported approval, payment or provider workflow.`,
        );
      if (
        snapshot.configuration.tenant &&
        snapshot.configuration.tenant.currency !== policy.currency
      )
        blockers.push(`Runtime policy ${key} currency differs from tenant configuration.`);
    }
    for (const product of snapshot.configuration.products)
      if (!seen.has(product.id + '@' + product.version))
        blockers.push(`Product ${product.id}@${product.version} has no supported runtime policy.`);
    return tenantSetupSchema.parse({
      tenant,
      requirements,
      runtimeDraft,
      activeRelease: this.store.control.release(context),
      candidate: {
        draftVersion: snapshot.version,
        draftHash: snapshot.hash,
        requirementsHash: requirements?.sourceProfileHash ?? null,
        runtimeDraftVersion: runtimeDraft.version,
        runtimeDraftHash: runtimeDraft.hash,
        canActivate: blockers.length === 0,
        blockers: [...new Set(blockers)],
      },
    });
  }
  private provision(principal: Principal, tenantId: string): TenantRecord {
    try {
      return this.store.transaction(() => {
        const { tenant, role } = this.store.control.authorize(principal, tenantId);
        if (!writer(role)) fail('FORBIDDEN', 'This membership cannot provision a tenant', 403);
        if (tenant.provisioningState === 'Ready') return tenant;
        this.store.provisionScope(tenant.scope);
        const requirements = this.store.control.requirements(tenant.id);
        const updated: TenantRecord = {
          ...tenant,
          provisioningState: requirements ? 'Ready' : 'Provisioning',
          setupStatus: requirements ? 'configured' : 'awaiting_requirements',
          failureCode: null,
          updatedAt: new Date().toISOString(),
        };
        this.store.control.updateTenant(updated);
        this.store.control.audit(
          principal,
          'control_provision_tenant',
          'succeeded',
          tenant.accountId,
          tenant.id,
        );
        return updated;
      });
    } catch (error) {
      this.store.transaction(() => {
        const { tenant, role } = this.store.control.authorize(principal, tenantId);
        if (writer(role))
          this.store.control.updateTenant({
            ...tenant,
            provisioningState: 'Failed',
            failureCode: error instanceof KernelError ? error.code : 'PROVISIONING_FAILED',
            updatedAt: new Date().toISOString(),
          });
      });
      throw error;
    }
  }
  execute(
    name: ControlOperationName,
    raw: unknown,
    principal: Principal,
    targetTenantId?: string,
  ): unknown {
    principalSchema.parse(principal);
    const operation = controlOperations[name];
    try {
      const input = operation.input.parse(raw);
      if (name === 'control_create_tenant') {
        const command = controlOperations.control_create_tenant.input.parse(input);
        const tenantId = this.store.transaction(() => {
          const account = this.store.control.account(principal, command.accountId);
          if (!writer(account.role))
            fail('FORBIDDEN', 'This account membership cannot create tenants', 403);
          if (command.region !== this.options.region)
            fail('REGION_UNAVAILABLE', 'Requested region must match the deployed sandbox region');
          const requestHash = hash(command);
          const replay = this.store.control.replay(
            account.id,
            name,
            command.idempotencyKey,
            requestHash,
          );
          if (replay) {
            const id = z.string().uuid().parse(replay);
            this.store.control.authorize(principal, id);
            return id;
          }
          const id = randomUUID();
          const now = new Date().toISOString();
          const tenant: TenantRecord = {
            id,
            accountId: account.id,
            displayName: command.displayName,
            region: command.region,
            scope: {
              workspaceId: account.workspaceId,
              tenantId: 'tenant_' + id.replaceAll('-', ''),
              environment: 'sandbox',
              operatingEntityId: 'entity_' + id.replaceAll('-', ''),
            },
            ownerActorId: principal.actorId,
            operationId: randomUUID(),
            provisioningState: 'Requested',
            setupStatus: 'awaiting_requirements',
            createdAt: now,
            updatedAt: now,
            failureCode: null,
          };
          this.store.control.insertTenant(tenant);
          this.store.control.remember(account.id, name, command.idempotencyKey, requestHash, id);
          this.store.control.audit(principal, name, 'requested', account.id, id);
          return id;
        });
        return operation.output.parse({ tenant: this.provision(principal, tenantId) });
      }
      if (name === 'control_retry_tenant') {
        const command = controlOperations.control_retry_tenant.input.parse(input);
        const tenant = this.store.transaction(() => {
          // Resolve by current authorized listing before exposing the operation record.
          const value = this.store.control
            .tenants(principal)
            .find((t) => t.operationId === command.operationId);
          if (!value) fail('FORBIDDEN', 'This provisioning operation is not authorized', 403);
          const { role } = this.store.control.authorize(principal, value!.id);
          if (!writer(role)) fail('FORBIDDEN', 'This membership cannot retry provisioning', 403);
          const requestHash = hash(command);
          const replay = this.store.control.replay(
            value!.accountId,
            name,
            command.idempotencyKey,
            requestHash,
          );
          if (replay === undefined)
            this.store.control.remember(
              value!.accountId,
              name,
              command.idempotencyKey,
              requestHash,
              value!.id,
            );
          return value!;
        });
        return operation.output.parse({ tenant: this.provision(principal, tenant.id) });
      }
      return this.store.transaction(() => {
        if (name === 'control_tenants')
          return operation.output.parse({ tenants: this.store.control.tenants(principal) });
        if (name === 'control_revoke_membership') {
          const value = controlOperations.control_revoke_membership.input.parse(input);
          const account = this.store.control.account(principal, value.accountId);
          if (account.role !== 'owner' && account.role !== 'admin')
            fail('FORBIDDEN', 'Only account administrators can revoke memberships', 403);
          if (
            value.membershipTenantId &&
            this.store.control.authorize(principal, value.membershipTenantId).tenant.accountId !==
              account.id
          )
            fail('FORBIDDEN', 'Tenant does not belong to the authorized account', 403);
          const requestHash = hash(value);
          const replay = this.store.control.replay(
            account.id,
            name,
            value.idempotencyKey,
            requestHash,
          );
          if (replay !== undefined) return operation.output.parse(replay);
          this.store.control.requireRevocableMember(
            account.id,
            value.actorId,
            value.membershipTenantId,
          );
          this.store.control.revoke(account.id, value.actorId, value.membershipTenantId);
          const result = {
            revoked: true,
            accountId: account.id,
            actorId: value.actorId,
            tenantId: value.membershipTenantId ?? null,
          };
          this.store.control.remember(account.id, name, value.idempotencyKey, requestHash, result);
          this.store.control.audit(
            principal,
            name,
            'succeeded',
            account.id,
            value.membershipTenantId ?? null,
          );
          return operation.output.parse(result);
        }
        if (!targetTenantId)
          fail('TENANT_TARGET_REQUIRED', 'Select an authorized tenant explicitly', 400);
        const { tenant, role } = this.store.control.authorize(principal, targetTenantId!);
        if (operation.write && !writer(role))
          fail('FORBIDDEN', 'This membership cannot change tenant setup', 403);
        if (name === 'control_setup') return this.setup(principal, tenant.id);
        const command = input as { idempotencyKey: string };
        const requestHash = hash({ tenantId: tenant.id, input });
        const replay = this.store.control.replay(
          tenant.accountId,
          name,
          command.idempotencyKey,
          requestHash,
        );
        if (replay !== undefined) return operation.output.parse(replay);
        if (name === 'control_attach_requirements') {
          const value = controlOperations.control_attach_requirements.input.parse(input);
          const previous = this.store.control.requirements(tenant.id);
          if ((previous?.version ?? 0) !== value.expectedVersion)
            fail('VERSION_CONFLICT', 'Requirements attachment changed; reload setup', 409);
          const sourceProfileHash = hash(value.profile);
          try {
            new RequirementsRegistry([
              { scope: tenant.scope, profile: value.profile, sourceProfileHash },
            ]);
          } catch {
            fail(
              'INVALID_REQUIREMENTS_PROFILE',
              'Requirements require unique identifiers and valid source references',
            );
          }
          this.store.control.attach(tenant.id, {
            version: value.expectedVersion + 1,
            sourceProfileHash,
            profile: value.profile,
            sourceClaimsStatus: 'unverified',
            attachedAt: new Date().toISOString(),
            attachedBy: principal.actorId,
          });
          this.store.provisionScope(tenant.scope);
          this.store.control.updateTenant({
            ...tenant,
            provisioningState: 'Ready',
            setupStatus: 'configured',
            failureCode: null,
            updatedAt: new Date().toISOString(),
          });
        } else if (name === 'control_update_runtime_draft') {
          const value = controlOperations.control_update_runtime_draft.input.parse(input);
          const current = this.store.control.runtimeDraft(tenant.id);
          if (current.version !== value.expectedVersion)
            fail('VERSION_CONFLICT', 'Runtime draft changed; reload setup', 409);
          const draft: RuntimeDraft = {
            version: current.version + 1,
            policies: value.policies,
            hash: hash(value.policies),
          };
          this.store.control.saveRuntimeDraft(tenant.id, draft);
        } else if (name === 'control_activate') {
          const value = controlOperations.control_activate.input.parse(input);
          const setup = this.setup(principal, tenant.id);
          const { idempotencyKey: _, ...expected } = value;
          const { canActivate, blockers, ...actual } = setup.candidate;
          if (canonicalJson(expected) !== canonicalJson(actual))
            fail(
              'VERSION_CONFLICT',
              'Activation candidate changed; reload and review exact versions',
              409,
            );
          if (!canActivate) fail('ACTIVATION_BLOCKED', blockers.join(' '));
          const configuration = this.store.read(tenant.scope, 'draft');
          const rich = configuration.configuration.products.some((product) => !!product.insurance);
          const content = {
            id: randomUUID(),
            tenantId: tenant.id,
            scope: tenant.scope,
            version: this.store.control.nextReleaseVersion(tenant.id),
            configuration,
            requirements: setup.requirements!,
            runtimeDraft: setup.runtimeDraft,
            buildSha: this.options.buildSha,
            compatibilityVersion: rich
              ? ('sandbox-insurance-decision-v1' as const)
              : ('sandbox-manual-quote-v1' as const),
            activatedAt: new Date().toISOString(),
            activatedBy: principal.actorId,
            runtimeStatus: rich
              ? ('configured_product_decisions' as const)
              : ('manual_external_quote_only' as const),
            acceptanceStatus: 'not_recorded' as const,
          };
          this.store.control.activate(
            sandboxReleaseSchema.parse({ ...content, hash: hash(content) }),
          );
        } else if (name === 'control_rollback') {
          const value = controlOperations.control_rollback.input.parse(input);
          const active = this.store.control.release(tenant.scope);
          if (!active || active.id !== value.expectedActiveReleaseId)
            fail('VERSION_CONFLICT', 'Active release changed; reload before rollback', 409);
          this.store.control.selectRelease(tenant.id, value.releaseId);
        }
        const result = this.setup(principal, tenant.id);
        this.store.control.remember(
          tenant.accountId,
          name,
          command.idempotencyKey,
          requestHash,
          result,
        );
        this.store.control.audit(principal, name, 'succeeded', tenant.accountId, tenant.id);
        return operation.output.parse(result);
      });
    } catch (error) {
      const code =
        error instanceof KernelError
          ? error.code
          : error instanceof z.ZodError
            ? 'VALIDATION_ERROR'
            : 'INTERNAL_ERROR';
      this.store.control.audit(principal, name, code);
      if (error instanceof z.ZodError)
        fail('VALIDATION_ERROR', 'Input does not satisfy the control-plane contract', 422);
      throw error;
    }
  }
}

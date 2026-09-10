import { z } from 'zod';
import { contextSchema, diffSchema, type Context } from '../contracts/configuration.js';
import { operations, type OperationName } from '../contracts/operations.js';
import { catalog } from '../domain/catalog.js';
import { validateConfiguration } from '../domain/validate.js';
import { canonicalJson, hash, KernelError } from '../domain/canonical.js';
import { Store } from '../storage/store.js';
import type { ScopedRequirementsProfile } from '../contracts/requirements.js';
import { RequirementsRegistry } from './requirements.js';
import { InsuranceApplication } from './insurance.js';
import { ApprovalApplication } from './approval.js';
import { ProviderApplication } from './provider.js';
import { DocumentApplication } from './documents.js';
import { FinanceApplication } from './finance.js';
import { FnolApplication } from './fnol.js';
import { fnolOperations, type FnolOperationName } from '../contracts/fnol.js';
import { documentOperations, type DocumentOperationName } from '../contracts/documents.js';
import { financeOperations, type FinanceOperationName } from '../contracts/finance.js';
import { providerOperations, type ProviderOperationName } from '../contracts/provider-execution.js';
import { approvalOperations, type ApprovalOperationName } from '../contracts/approval.js';
import { ControlPlane } from './control-plane.js';
import type { ControlPlaneOptions, Principal } from '../contracts/control-plane.js';
import { requirementsReportSchema } from '../contracts/requirements.js';
import {
  insuranceOperations,
  type InsuranceOperationName,
  type ScopedRuntimePolicy,
} from '../contracts/insurance.js';

function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  return Object.keys(after)
    .sort()
    .filter((key) => canonicalJson(before[key]) !== canonicalJson(after[key]))
    .map((key) => diffSchema.parse({ path: '/' + key, before: before[key], after: after[key] }));
}
function validateOutput(schema: z.ZodType, value: unknown): unknown {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new KernelError('CONTRACT_VIOLATION', 'The operation produced an invalid result', 500);
  return result.data;
}
export class Kernel {
  readonly control: ControlPlane;
  private readonly requirements: RequirementsRegistry;
  private readonly insurance: InsuranceApplication;
  private readonly approvals: ApprovalApplication;
  readonly providers: ProviderApplication;
  readonly documents: DocumentApplication;
  private readonly finance: FinanceApplication;
  private readonly fnol: FnolApplication;
  constructor(
    readonly store: Store,
    profiles: readonly ScopedRequirementsProfile[] = [],
    runtimePolicies: readonly ScopedRuntimePolicy[] = [],
    clock?: () => Date,
    controlOptions: ControlPlaneOptions = { region: 'local', buildSha: 'development' },
    providerAdapters: ConstructorParameters<typeof ProviderApplication>[1] = [],
    documentPacks: ConstructorParameters<typeof DocumentApplication>[1] = [],
    fnolDestinations: ConstructorParameters<typeof FnolApplication>[1] = [],
  ) {
    this.control = new ControlPlane(store, controlOptions);
    this.requirements = new RequirementsRegistry(profiles);
    this.insurance = new InsuranceApplication(store, runtimePolicies, clock);
    this.approvals = new ApprovalApplication(store, this.insurance, clock);
    this.providers = new ProviderApplication(store, providerAdapters, clock);
    this.documents = new DocumentApplication(store, documentPacks, clock);
    this.finance = new FinanceApplication(store, clock);
    this.fnol = new FnolApplication(store, fnolDestinations, clock);
  }
  executeForPrincipal(
    name: OperationName,
    raw: unknown,
    principal: Principal,
    tenantId: string,
  ): unknown {
    const resolve = () => this.control.resolveContext(principal, tenantId);
    let context: Context;
    try {
      context = resolve();
    } catch (error) {
      this.store.control.audit(
        principal,
        name,
        error instanceof KernelError ? error.code : 'VALIDATION_ERROR',
      );
      throw error;
    }
    return this.execute(name, raw, context, resolve);
  }
  execute(
    name: OperationName,
    raw: unknown,
    context: Context,
    freshContext?: () => Context,
  ): unknown {
    // Identity has one trusted entry point; transports cannot deserialize this from tool arguments.
    contextSchema.parse(context);
    const operation = operations[name];
    try {
      if (!context.permissions.some((p) => p === operation.permission))
        throw new KernelError('FORBIDDEN', 'The credential does not grant this operation', 403);
      const input = operation.input.parse(raw);
      return this.store.transaction(() => {
        if (freshContext) context = freshContext();
        if (!context.permissions.some((p) => p === operation.permission))
          throw new KernelError('FORBIDDEN', 'The credential does not grant this operation', 403);
        let result: unknown;
        if (Object.hasOwn(insuranceOperations, name))
          result = this.insurance.execute(name as InsuranceOperationName, input, context);
        else if (Object.hasOwn(approvalOperations, name))
          result = this.approvals.execute(name as ApprovalOperationName, input, context);
        else if (Object.hasOwn(providerOperations, name))
          result = this.providers.execute(name as ProviderOperationName, input, context);
        else if (Object.hasOwn(documentOperations, name))
          result = this.documents.execute(name as DocumentOperationName, input, context);
        else if (Object.hasOwn(fnolOperations, name))
          result = this.fnol.execute(name as FnolOperationName, input, context);
        else if (Object.hasOwn(financeOperations, name))
          result = this.finance.execute(name as FinanceOperationName, input, context);
        else if (name === 'configuration_requirements') {
          const tenantId = this.store.control.tenantIdForScope(context);
          if (tenantId) {
            const attachment = this.store.control.requirements(tenantId);
            const {
              workspaceId,
              tenantId: scopedTenantId,
              environment,
              operatingEntityId,
            } = context;
            result = requirementsReportSchema.parse({
              scope: { workspaceId, tenantId: scopedTenantId, environment, operatingEntityId },
              sourceStatus: attachment ? 'source_attached' : 'source_not_attached',
              sourceProfileHash: attachment?.sourceProfileHash ?? null,
              profile: attachment?.profile ?? null,
              ...(attachment ? { sourceClaimsStatus: 'unverified' } : {}),
              runtimeStatus: 'pending_evidence',
              acceptanceStatus: 'not_recorded',
            });
          } else result = this.requirements.read(context);
        } else if (name === 'configuration_update_draft') {
          const update = operations.configuration_update_draft.input.parse(input);
          const requestHash = hash(update);
          const previous = this.store.replay(context, name, update.idempotencyKey, requestHash);
          if (previous !== undefined) {
            this.store.audit(context, name, 'replayed');
            return validateOutput(operation.output, previous);
          }
          // Connection status is observed server state, never a model assertion.
          const before = this.store.read(context, 'draft');
          for (const integration of update.configuration.integrations) {
            const existing = before.configuration.integrations.find(
              (item) => item.id === integration.id,
            );
            if (
              integration.connectionStatus !== 'unverified' &&
              (!existing ||
                existing.connectionRef !== integration.connectionRef ||
                existing.adapterId !== integration.adapterId ||
                existing.connectionStatus !== integration.connectionStatus)
            )
              throw new KernelError(
                'READ_ONLY_FIELD',
                'Connection health must be verified by a registered provider adapter',
                422,
              );
          }
          const snapshot = this.store.update(context, update.expectedVersion, update.configuration);
          const changes = diff(before.configuration, snapshot.configuration);
          result = {
            snapshot,
            diff: changes,
            summary: changes.length
              ? `Updated ${changes.length} configuration section(s); published configuration is unchanged.`
              : 'Saved a new draft version with no value changes.',
          };
          result = validateOutput(operation.output, result);
          this.store.remember(context, name, update.idempotencyKey, requestHash, result);
        } else if (name === 'configuration_catalog')
          result = { contractVersion: '0.1.0', categories: catalog };
        else if (name === 'configuration_context') {
          const { correlationId: _, ...scope } = context;
          result = scope;
        } else if (name === 'configuration_audit') result = { records: this.store.audits(context) };
        else {
          const { view } = operations.configuration_inspect.input.parse(input);
          const snapshot = this.store.read(context, view);
          result =
            name === 'configuration_inspect'
              ? snapshot
              : validateConfiguration(snapshot.configuration, context, snapshot);
        }
        const parsed = validateOutput(operation.output, result);
        this.store.audit(context, name, 'succeeded');
        return parsed;
      });
    } catch (error) {
      const code =
        error instanceof KernelError
          ? error.code
          : error instanceof z.ZodError
            ? 'VALIDATION_ERROR'
            : 'INTERNAL_ERROR';
      this.store.audit(context, name, code);
      if (error instanceof z.ZodError)
        throw new KernelError(
          code,
          'Input does not satisfy the strict operation contract: ' +
            error.issues
              .slice(0, 10)
              .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
              .join('; '),
          422,
        );
      throw error;
    }
  }
}

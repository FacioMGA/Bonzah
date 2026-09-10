/**
 * Prisma client extension: operating-tenant auto-inject + RLS GUC setter.
 *
 * Applies to tenant-scoped tables.
 * For each covered model every write operation automatically injects
 * `operatingTenantId` from the current ALS context, and every read/mutate
 * operation automatically adds `where: { operatingTenantId }` to scope the
 * result set.
 *
 * GUC injection (Sprint 3): standalone queries are wrapped in a short
 * transaction that sets `app.operating_tenant_id`. `runTenantScopedTransaction`
 * sets the same GUC once on its transaction connection and marks that async
 * scope so model queries do not open additional top-level transactions.
 *
 * Behaviour when no ALS context is present (CLI scripts, seed runner, tests
 * that bypass HTTP middleware):
 *   - `failClosed = true`  → throws `TenantContextError`.
 *   - `failClosed = false` → no injection; query runs across all tenants.
 *
 * Usage:
 *   import { prisma } from './connection.js';               // base client
 *   import { tenantScopedPrisma } from './connection.js';  // extended, fail-closed
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { getOperatingTenantConfig } from '../tenant/tenantAls.js';

const tenantTransactionScope = new AsyncLocalStorage<boolean>();

/**
 * Marks model queries as already protected by an operating-tenant transaction.
 * Only `runTenantScopedTransaction` may establish this scope, after setting the
 * transaction-local RLS GUC on the same Prisma transaction connection.
 */
export function runInsideTenantTransaction<T>(fn: () => T): T {
  return tenantTransactionScope.run(true, fn);
}

// ---------------------------------------------------------------------------
// All tenant-scoped models.
// ---------------------------------------------------------------------------

const TENANT_SCOPED_MODELS = new Set([
  'Settings',
  'CommunicationThread',
  'CommunicationMessage',
  'CommunicationTemplate',
  'CommunicationParticipant',
  'CommunicationDeliveryAttempt',
  'SyntheticEmailRun',
  // Sprint 2 — low-risk operational tables
  'RecoEvent',
  'RecoBanditArm',
  'SanctionScreeningRun',
  'PolicySearchIndex',
  'PolicyListIndex',
  'Outbox',
  'AuditAction',
  'ApiKey',
  'WebhookEndpoint',
  // Sprint 3 — core business tables
  'Account',
  'Policy',
  'RiskTransaction',
  'Endorsement',
  'EndorsementInstance',
  'Document',
  'DocumentSet',
  'Invoice',
  'Payment',
  'Reconciliation',
  'Claim',
  'ClaimAssignment',
  'ClaimEvent',
  'ClaimReserveTransaction',
  'Binder',
  'BinderProductAuthority',
  'BinderProductAuthorityProgramDefinition',
  'Program',
  'ProgramRatingModel',
  'ProgramDefinitionVersion',
  'PolicyHolder',
  'Entity',
  'AccountActivityFeed',
  'AccountAlertsProjection',
  'AccountIntelligenceProjection',
  'AccountSummaryProjection',
  'AccountPortfolioMetrics',
  'ClaimProjectionSnapshot',
  'PolicyStateCurrent',
  'PolicyQuoteHistory',
  // Behavior layer: semantic events + per-policy trajectory projection.
  'BehaviorEvent',
  'PolicyTrajectory',
  // Config MCP V1 (ADR-0037): product launch staging.
  'ProductLaunchDraft',
  // Retired ProductChannelSetting rows remain tenant-scoped while awaiting their
  // approved retention migration; they are not a runtime configuration source.
  'ProductChannelSetting',
  'OfficeStaffTarget',
  'PolicyAssignment',
  'PersonnelFile',
  'StaffAbsence',
  'StaffPayslip',
  'StaffDiaryEntry',
  'StaffMessage',
  'LoginEvent',
  'MotorMarketSubmission',
  'MotorMarketSubmissionAttempt',
  // Claim Memory V1 (ADR-0041): cached projection of claim memory + graph enrichment.
  'ClaimMemoryProjection',
  // Org2Vec demo (ADR-0044): submission memory projection + ingestion event log.
  'SubmissionMemoryProjection',
  'Org2VecIngestionEvent',
] as const);

type TenantScopedModel = typeof TENANT_SCOPED_MODELS extends Set<infer T> ? T : never;

function isTenantScoped(model: string | undefined): model is TenantScopedModel {
  return typeof model === 'string' && TENANT_SCOPED_MODELS.has(model as TenantScopedModel);
}

// ---------------------------------------------------------------------------
// Utility type — strip operatingTenantId from Prisma CreateInput types.
// The extension injects the real value at runtime; callers should not supply
// a placeholder.  Import this wherever you build create/upsert data objects.
//
// Example:
//   import { WithoutTenantScope } from '../db/tenantExtension.js';
//   const data: WithoutTenantScope<Prisma.OutboxUncheckedCreateInput> = { ... };
//   await tenantScopedPrisma.outbox.create({ data: data as Prisma.OutboxUncheckedCreateInput });
// ---------------------------------------------------------------------------

/** Strip `operatingTenantId` from a Prisma CreateInput type — injected by the extension. */
export type WithoutTenantScope<T> = Omit<T, 'operatingTenantId'>;

// ---------------------------------------------------------------------------
// Prisma middleware boundary type — single named cast for the opaque args
// object that `$allOperations` hands the extension. Per Prisma's design, the
// shape varies by operation (`{ data }` for create, `{ where }` for find,
// `{ create, update, where }` for upsert, …) and the middleware cannot know
// the per-model schema; full typing resumes downstream when `query(args)`
// runs against the typed client. Using one FAC-tagged alias instead of
// scattering the inline string-keyed-unknown shape across the file keeps the
// boundary concept named and policed in one place.
// ---------------------------------------------------------------------------

export type PrismaArgsObject = Record<string, unknown>; // TODO(FAC-9001): owner=platform-tenant expires=2026-12-31 deletionPR=tenant-extension-strong-types boundary type for Prisma $allOperations middleware args; per-model schema is unknown at this layer.

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class TenantContextError extends Error {
  readonly code: string;
  constructor(model: string, action: string, code: string = 'TENANT_CONTEXT_REQUIRED', message?: string) {
    super(
      message ??
        `TenantContextError: Prisma query on ${model}.${action} requires an operating tenant context. ` +
          'Ensure resolveOperatingTenant middleware has run, or call runWithOperatingTenant() explicitly.',
    );
    this.name = 'TenantContextError';
    this.code = code;
  }
}

/**
 * Thrown when a Prisma write or read explicitly carries an `operatingTenantId`
 * that disagrees with the ALS-resolved tenant. The previous behaviour was to
 * silently override the caller's value with the ALS value — a tenant-isolation
 * footgun: a worker that read `operatingTenantId: A` from a parent row and
 * passed it through could end up writing the row under tenant `B` if the ALS
 * context happened to be `B`, with no log, no exception, and no audit trail.
 *
 * The contract is now: if the caller supplies `operatingTenantId`, it MUST
 * match the ALS-resolved tenant. If it disagrees, throw. If it is absent, the
 * extension still injects the ALS value (defense in depth — the caller should
 * pass it explicitly so the call site is honest).
 *
 * Subclasses `TenantContextError` so existing `instanceof TenantContextError`
 * catches in HTTP error mappers continue to work unchanged.
 */
export class TenantMismatchError extends TenantContextError {
  readonly callerTenantId: string;
  readonly alsTenantId: string;
  constructor(
    model: string,
    operation: string,
    location: string,
    callerTenantId: string,
    alsTenantId: string,
  ) {
    const message =
      `TenantMismatchError: Prisma ${model}.${operation} called with ` +
      `${location}.operatingTenantId='${callerTenantId}' ` +
      `but the ALS-resolved tenant is '${alsTenantId}'. Pass the matching ` +
      `id or omit it; the extension injects the ALS value when absent. ` +
      `Silent override has been removed.`;
    super(model, operation, 'TENANT_MISMATCH', message);
    this.name = 'TenantMismatchError';
    this.callerTenantId = callerTenantId;
    this.alsTenantId = alsTenantId;
  }
}

/**
 * Throws `TenantMismatchError` when a caller-supplied `operatingTenantId` on a
 * Prisma data / where object disagrees with the ALS-resolved tenant. Returns
 * the asserted source unchanged so call sites can name-bind it before the
 * inject spread, making "assert runs before inject on the same object"
 * structurally enforced rather than depending on statement ordering.
 */
function assertOperatingTenantMatchesAls<T extends PrismaArgsObject>(
  source: T,
  location: string,
  model: string,
  operation: string,
  tenantId: string,
): T {
  const supplied = source.operatingTenantId;
  if (supplied !== undefined && supplied !== tenantId) {
    throw new TenantMismatchError(
      model,
      operation,
      location,
      String(supplied),
      tenantId,
    );
  }
  return source;
}

// ---------------------------------------------------------------------------
// Pure injection logic (testable without Prisma internals)
// ---------------------------------------------------------------------------

export type OperationContext = {
  model: string | undefined;
  operation: string;
  args: Record<string, unknown>;
  query: (args: Record<string, unknown>) => Promise<unknown>;
  failClosed: boolean;
  /** Base PrismaClient used to set the RLS GUC inside a transaction. When
   *  omitted, GUC injection is skipped (failOpen / test mode). */
  baseClient?: PrismaClient;
};

/**
 * Interactive-transaction options for the per-query GUC wrap.
 *
 * Prisma's built-in defaults (maxWait 2000 ms, timeout 5000 ms) are too tight
 * for tenant-scoped work that legitimately runs long under load: the issued
 * doc-pack path (headless-Chromium PDF render + blob upload interleaved with
 * writes) and the accounts-360 projection rebuild (a batch of upserts +
 * deleteMany/createMany) were tripping `Transaction API error: Transaction
 * already closed … 5069–6970 ms passed` on Azure Postgres. The failures were
 * `timeout`, not `maxWait` (queries acquired connections and started; they
 * just ran past the 5 s ceiling), so the primary lever is `timeout`. Values
 * are env-overridable so ops can tune per environment without a deploy.
 */
export const TENANT_GUC_TX_OPTIONS = {
  maxWait: Number(process.env.PRISMA_TENANT_TX_MAX_WAIT_MS) || 5000,
  timeout: Number(process.env.PRISMA_TENANT_TX_TIMEOUT_MS) || 15000,
} as const;

const WHERE_OPERATIONS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow',
  'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy',
  'update', 'updateMany',
  'delete', 'deleteMany',
]);

/**
 * Core injection logic. Exported for unit testing.
 * Wraps a Prisma query call with operating-tenant auto-inject + GUC setter.
 */
export async function applyTenantInjection(ctx: OperationContext): Promise<unknown> {
  const { model, operation, args: originalArgs, query, failClosed, baseClient } = ctx;

  if (!isTenantScoped(model)) {
    return query(originalArgs);
  }

  const config = getOperatingTenantConfig();

  if (!config) {
    if (failClosed) throw new TenantContextError(model ?? '?', operation);
    return query(originalArgs);
  }

  const tenantId = config.id;
  const modelName = model ?? '?';
  let args = originalArgs;

  // Two rules govern every branch below:
  //   1. Assert FIRST on the same object (via `assertOperatingTenantMatchesAls`).
  //      A mismatch throws `TenantMismatchError`; equal or absent is accepted.
  //   2. Spread order is `{ ...asserted, operatingTenantId: tenantId }` so the
  //      ALS value is the final canonical write — never ambiguous, regardless
  //      of whether the caller supplied the field. Combined with rule 1, this
  //      eliminates the silent-override footgun: the caller is either right
  //      (and the spread is a no-op) or wrong (and the assert threw).
  //
  // Special case: `upsert.update`. `operatingTenantId` is immutable on a
  // tenant-scoped row, so we assert any caller-supplied value matches ALS,
  // then STRIP the field from the update payload. The previous behaviour
  // injected ALS into update.data, which Prisma would attempt to write —
  // a no-op when the column already equals ALS, but a tenant-rewrite if it
  // ever didn't (defence-in-depth violation).
  if (operation === 'create') {
    const data = assertOperatingTenantMatchesAls(
      (args.data ?? {}) as PrismaArgsObject,
      'data', modelName, operation, tenantId,
    );
    args = { ...args, data: { ...data, operatingTenantId: tenantId } };
  } else if (operation === 'createMany') {
    const rows = args.data as Array<PrismaArgsObject>;
    args = {
      ...args,
      data: rows.map((row, index) => {
        const asserted = assertOperatingTenantMatchesAls(
          row, `data[${index}]`, modelName, operation, tenantId,
        );
        return { ...asserted, operatingTenantId: tenantId };
      }),
    };
  } else if (operation === 'upsert') {
    const create = assertOperatingTenantMatchesAls(
      (args.create ?? {}) as PrismaArgsObject,
      'create', modelName, operation, tenantId,
    );
    const update = assertOperatingTenantMatchesAls(
      (args.update ?? {}) as PrismaArgsObject,
      'update', modelName, operation, tenantId,
    );
    const { operatingTenantId: _omitImmutable, ...updateWithoutTenant } = update;
    void _omitImmutable;
    args = {
      ...args,
      create: { ...create, operatingTenantId: tenantId },
      update: updateWithoutTenant,
    };
  }

  // Inject operatingTenantId filter on read / mutate operations that accept where.
  if (WHERE_OPERATIONS.has(operation)) {
    const where = assertOperatingTenantMatchesAls(
      (args.where ?? {}) as PrismaArgsObject,
      'where', modelName, operation, tenantId,
    );
    args = { ...args, where: { ...where, operatingTenantId: tenantId } };
  }

  // GUC injection: set app.operating_tenant_id inside a transaction so the
  // Postgres RLS policy sees the correct value for this query.
  // set_config with is_local=true scopes the GUC to the current transaction,
  // making it connection-pool safe.
  //
  // Standalone model queries need a short transaction to scope the RLS GUC.
  // Queries inside `runTenantScopedTransaction` already have the GUC on their
  // outer transaction connection. Opening another top-level transaction there
  // doubles connection demand and can deadlock a saturated Prisma pool.
  if (baseClient && !tenantTransactionScope.getStore()) {
    return baseClient.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.operating_tenant_id', ${tenantId}, true)`;
      // The original extension callback is bound to the outer client. Calling
      // it here would use a different pool connection and lose the local GUC.
      // Dispatch the validated operation on this transaction's base delegate.
      const delegateName = modelName[0].toLowerCase() + modelName.slice(1);
      const delegate = (tx as unknown as Record<string, Record<string, (input: unknown) => Promise<unknown>>>)[delegateName];
      if (!delegate || typeof delegate[operation] !== 'function') {
        throw new TenantContextError(modelName, operation);
      }
      return delegate[operation](args);
    }, TENANT_GUC_TX_OPTIONS);
  }

  return query(args);
}

// ---------------------------------------------------------------------------
// Prisma extension factory
// ---------------------------------------------------------------------------

export type TenantExtensionOptions = {
  /** When true (default), throw if no ALS tenant context is present for a covered model. */
  failClosed?: boolean;
  /**
   * Base PrismaClient instance.  When provided, each covered-model query is
   * wrapped in a short transaction that sets the Postgres GUC
   * `app.operating_tenant_id` via `set_config`, keeping the RLS policy in sync.
   * Omit only in tests / fail-open contexts where RLS is not enforced.
   */
  baseClient?: PrismaClient;
};

export function buildTenantExtension(options: TenantExtensionOptions = {}) {
  const failClosed = options.failClosed ?? true;
  const baseClient = options.baseClient;

  return Prisma.defineExtension({
    name: 'operatingTenantAutoInject',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }: {
          model: string;
          operation: string;
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          return applyTenantInjection({ model, operation, args, query, failClosed, baseClient });
        },
      },
    },
  });
}

/** Default fail-closed extension instance (suitable for all HTTP request handlers). */
export const tenantExtension = buildTenantExtension({ failClosed: true });

/** Fail-open variant for scripts and tests that run outside HTTP context. */
export const tenantExtensionFailOpen = buildTenantExtension({ failClosed: false });

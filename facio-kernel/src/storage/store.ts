import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  configurationSchema,
  snapshotSchema,
  type Configuration,
  type Context,
  type Scope,
  type Snapshot,
} from '../contracts/configuration.js';
import {
  evaluateConfiguredCancellation,
  evaluateConfiguredService,
  effectiveConfiguredSubmission,
} from '../domain/insurance-service.js';
import { evaluateInsuranceProduct } from '../domain/insurance-decision.js';
import { allocateFinancials } from '../domain/money.js';
import { canonicalJson, hash, KernelError } from '../domain/canonical.js';
import { ControlStorage } from './control-plane.js';
import { ApprovalRepository } from './approval.js';
import { ProviderStorage } from './provider.js';
import { FinanceRepository } from './finance.js';
import { FnolRepository } from './fnol.js';
import { compareRenewalSubmissions } from '../domain/insurance-renewal.js';
import { DocumentRepository } from './documents.js';
import { assertSupportedSchema } from './schema-version.js';
import {
  insuranceRecordSchema,
  insuranceEventSchema,
  insuranceMutationResultSchema,
  type InsuranceRecord,
  type InsuranceEvent,
  type InsuranceMutationResult,
} from '../contracts/insurance.js';

const scopeKey = (s: Scope) =>
  canonicalJson([s.workspaceId, s.tenantId, s.environment, s.operatingEntityId]);
export class Store {
  private readonly db: DatabaseSync;
  readonly control: ControlStorage;
  readonly approvals: ApprovalRepository;
  readonly providers: ProviderStorage;
  readonly finance: FinanceRepository;
  readonly documents: DocumentRepository;
  readonly fnol: FnolRepository;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.control = new ControlStorage(this.db);
    this.approvals = new ApprovalRepository(this.db);
    this.providers = new ProviderStorage(this.db);
    this.finance = new FinanceRepository(this.db);
    this.documents = new DocumentRepository(this.db);
    this.fnol = new FnolRepository(this.db);
    try {
      assertSupportedSchema(this.db, 'schema_migrations', 7);
    } catch (error) {
      this.db.close();
      throw error;
    }
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
      INSERT OR IGNORE INTO schema_migrations VALUES(1);
      CREATE TABLE IF NOT EXISTS scopes(scope TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS drafts(scope TEXT PRIMARY KEY REFERENCES scopes(scope), version INTEGER NOT NULL, configuration TEXT NOT NULL, hash TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY, scope TEXT NOT NULL REFERENCES scopes(scope), version INTEGER NOT NULL, configuration TEXT NOT NULL, hash TEXT NOT NULL, effective_at TEXT NOT NULL, UNIQUE(scope,version));
      CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, scope TEXT NOT NULL, actor_id TEXT NOT NULL, operation TEXT NOT NULL, outcome TEXT NOT NULL, correlation_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS idempotency(scope TEXT NOT NULL, actor_id TEXT NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(scope,actor_id,operation,key));
      CREATE TRIGGER IF NOT EXISTS release_no_update BEFORE UPDATE ON releases BEGIN SELECT RAISE(ABORT,'immutable release'); END;
      CREATE TRIGGER IF NOT EXISTS release_no_delete BEFORE DELETE ON releases BEGIN SELECT RAISE(ABORT,'immutable release'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;`);
    try {
      this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS insurance_records(scope TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,record_hash TEXT NOT NULL,PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS insurance_revisions(scope TEXT NOT NULL,record_id TEXT NOT NULL,version INTEGER NOT NULL,record_json TEXT NOT NULL,record_hash TEXT NOT NULL,PRIMARY KEY(scope,record_id,version),FOREIGN KEY(scope,record_id) REFERENCES insurance_records(scope,id));
      CREATE TABLE IF NOT EXISTS insurance_events(id TEXT PRIMARY KEY,scope TEXT NOT NULL,record_id TEXT NOT NULL,version INTEGER NOT NULL,event_json TEXT NOT NULL,event_hash TEXT NOT NULL,UNIQUE(scope,record_id,version),FOREIGN KEY(scope,record_id,version) REFERENCES insurance_revisions(scope,record_id,version));
      CREATE TABLE IF NOT EXISTS insurance_outbox(id TEXT PRIMARY KEY,scope TEXT NOT NULL,record_id TEXT NOT NULL,event_id TEXT NOT NULL UNIQUE REFERENCES insurance_events(id),payload TEXT NOT NULL,payload_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status='pending'),created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS insurance_idempotency(scope TEXT NOT NULL,operation TEXT NOT NULL,key TEXT NOT NULL,request_hash TEXT NOT NULL,result TEXT NOT NULL,result_hash TEXT NOT NULL,PRIMARY KEY(scope,operation,key));
      CREATE TABLE IF NOT EXISTS insurance_quote_identities(scope TEXT NOT NULL,product_id TEXT NOT NULL,source_quote_reference TEXT NOT NULL,record_id TEXT NOT NULL,PRIMARY KEY(scope,product_id,source_quote_reference),UNIQUE(scope,record_id),FOREIGN KEY(scope,record_id) REFERENCES insurance_records(scope,id));
      INSERT INTO insurance_quote_identities(scope,product_id,source_quote_reference,record_id)
        SELECT r.scope,json_extract(r.record_json,'$.productId'),json_extract(r.record_json,'$.quote.sourceQuote.reference'),r.record_id FROM insurance_revisions r
        WHERE r.version=1 AND NOT EXISTS(SELECT 1 FROM insurance_quote_identities q WHERE q.scope=r.scope AND q.record_id=r.record_id);
      CREATE TRIGGER IF NOT EXISTS insurance_records_no_delete BEFORE DELETE ON insurance_records BEGIN SELECT RAISE(ABORT,'immutable insurance record identity'); END;
      CREATE TRIGGER IF NOT EXISTS insurance_revisions_no_update BEFORE UPDATE ON insurance_revisions BEGIN SELECT RAISE(ABORT,'immutable insurance revision'); END;
      CREATE TRIGGER IF NOT EXISTS insurance_revisions_no_delete BEFORE DELETE ON insurance_revisions BEGIN SELECT RAISE(ABORT,'immutable insurance revision'); END;
      CREATE TRIGGER IF NOT EXISTS insurance_events_no_update BEFORE UPDATE ON insurance_events BEGIN SELECT RAISE(ABORT,'immutable insurance event'); END;
      CREATE TRIGGER IF NOT EXISTS insurance_events_no_delete BEFORE DELETE ON insurance_events BEGIN SELECT RAISE(ABORT,'immutable insurance event'); END;
      CREATE TRIGGER IF NOT EXISTS insurance_outbox_no_update BEFORE UPDATE ON insurance_outbox BEGIN SELECT RAISE(ABORT,'outbox delivery is not implemented'); END;
      CREATE TRIGGER IF NOT EXISTS insurance_outbox_no_delete BEFORE DELETE ON insurance_outbox BEGIN SELECT RAISE(ABORT,'immutable pending outbox'); END;
      CREATE TRIGGER IF NOT EXISTS insurance_idempotency_no_update BEFORE UPDATE ON insurance_idempotency BEGIN SELECT RAISE(ABORT,'immutable insurance idempotency'); END;
      CREATE TRIGGER IF NOT EXISTS insurance_idempotency_no_delete BEFORE DELETE ON insurance_idempotency BEGIN SELECT RAISE(ABORT,'immutable insurance idempotency'); END;
      CREATE TRIGGER IF NOT EXISTS insurance_quote_identities_no_update BEFORE UPDATE ON insurance_quote_identities BEGIN SELECT RAISE(ABORT,'immutable external quote identity'); END;
      CREATE TRIGGER IF NOT EXISTS insurance_quote_identities_no_delete BEFORE DELETE ON insurance_quote_identities BEGIN SELECT RAISE(ABORT,'immutable external quote identity'); END;
      CREATE TABLE IF NOT EXISTS insurance_renewal_identities(scope TEXT NOT NULL,source_record_id TEXT NOT NULL,term_start TEXT NOT NULL,record_id TEXT NOT NULL,PRIMARY KEY(scope,source_record_id,term_start),UNIQUE(scope,record_id),FOREIGN KEY(scope,record_id) REFERENCES insurance_records(scope,id));
      CREATE TRIGGER IF NOT EXISTS insurance_renewal_identities_no_update BEFORE UPDATE ON insurance_renewal_identities BEGIN SELECT RAISE(ABORT,'immutable renewal identity'); END;
      CREATE TRIGGER IF NOT EXISTS insurance_renewal_identities_no_delete BEFORE DELETE ON insurance_renewal_identities BEGIN SELECT RAISE(ABORT,'immutable renewal identity'); END;
      INSERT OR IGNORE INTO schema_migrations VALUES(2);
      INSERT OR IGNORE INTO schema_migrations VALUES(3);
      COMMIT;`);
      this.transaction(() => {
        this.control.migrate();
        this.approvals.migrate();
        this.providers.migrate();
        this.finance.migrate();
        this.documents.migrate();
        this.fnol.migrate();
        this.db.exec(
          'INSERT OR IGNORE INTO schema_migrations VALUES(6); INSERT OR IGNORE INTO schema_migrations VALUES(7)',
        );
      });
    } catch {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* BEGIN may itself have failed. */
      }
      this.db.close();
      throw new KernelError(
        'STORAGE_MIGRATION_FAILED',
        'Insurance storage migration failed; existing data requires review before restarting',
        500,
      );
    }
  }
  close() {
    this.db.close();
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      if (result && typeof (result as { then?: unknown }).then === 'function')
        throw new Error('SQLite transactions must be synchronous');
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  /** Shared-host provisioning, called inside the control-plane transaction. */
  provisionScope(scope: Scope): void {
    if (scope.environment !== 'sandbox')
      throw new KernelError('ENVIRONMENT_UNSUPPORTED', 'Only sandbox provisioning is enabled', 403);
    const key = scopeKey(scope);
    const existing = this.db.prepare('SELECT scope FROM scopes WHERE scope=?').get(key);
    if (existing) {
      this.read(scope, 'draft');
      return;
    }
    const configuration: Configuration = {
      tenant: null,
      operatingEntities: [],
      products: [],
      processes: [],
      integrations: [],
    };
    this.db.prepare('INSERT INTO scopes VALUES(?)').run(key);
    this.db
      .prepare('INSERT INTO drafts VALUES(?,?,?,?,?)')
      .run(key, 1, canonicalJson(configuration), hash(configuration), new Date().toISOString());
  }
  /** Fixture bootstrap only. Existing scopes are never reset or overwritten. No production publisher exists. */
  seed(scope: Scope, configuration: Configuration, published?: Configuration) {
    if (scope.environment !== 'development' && scope.environment !== 'sandbox')
      throw new Error('Fixture bootstrap is restricted to development/sandbox');
    configurationSchema.parse(configuration);
    if (published) configurationSchema.parse(published);
    this.transaction(() => {
      const key = scopeKey(scope);
      if (this.db.prepare('SELECT scope FROM scopes WHERE scope=?').get(key)) return;
      this.db.prepare('INSERT INTO scopes VALUES(?)').run(key);
      const now = new Date().toISOString();
      this.db
        .prepare('INSERT INTO drafts VALUES(?,?,?,?,?)')
        .run(key, 1, canonicalJson(configuration), hash(configuration), now);
      if (published)
        this.db
          .prepare('INSERT INTO releases VALUES(?,?,?,?,?,?)')
          .run(randomUUID(), key, 1, canonicalJson(published), hash(published), now);
    });
  }
  read(scope: Scope, view: 'draft' | 'published'): Snapshot {
    if (view === 'published' && this.control.isManaged(scope)) {
      const release = this.control.release(scope);
      if (!release)
        throw new KernelError(
          'NOT_FOUND',
          'No active sandbox release exists in the authorized scope',
          404,
        );
      return snapshotSchema.parse({
        ...release.configuration,
        view: 'published',
        releaseId: release.id,
        effectiveAt: release.activatedAt,
        updatedAt: release.activatedAt,
      });
    }
    const row =
      view === 'draft'
        ? this.db
            .prepare('SELECT version,configuration,hash,updated_at FROM drafts WHERE scope=?')
            .get(scopeKey(scope))
        : this.db
            .prepare(
              'SELECT id,version,configuration,hash,effective_at FROM releases WHERE scope=? AND effective_at<=? ORDER BY version DESC LIMIT 1',
            )
            .get(scopeKey(scope), new Date().toISOString());
    if (!row)
      throw new KernelError(
        'NOT_FOUND',
        `No ${view} configuration exists in the authorized scope`,
        404,
      );
    let configuration: Configuration;
    try {
      configuration = configurationSchema.parse(JSON.parse(String(row.configuration)));
    } catch {
      throw new KernelError(
        'INTEGRITY_ERROR',
        'Stored configuration does not satisfy its schema',
        500,
      );
    }
    if (hash(configuration) !== row.hash)
      throw new KernelError(
        'INTEGRITY_ERROR',
        'Stored configuration failed its integrity check',
        500,
      );
    return snapshotSchema.parse({
      view,
      version: row.version,
      hash: row.hash,
      updatedAt: row.updated_at ?? row.effective_at,
      releaseId: row.id ?? null,
      effectiveAt: row.effective_at ?? null,
      configuration,
    });
  }
  update(context: Context, expectedVersion: number, configuration: Configuration): Snapshot {
    if (context.environment === 'production')
      throw new KernelError(
        'REQUIRES_ENGINEERING',
        'Production configuration authoring is not enabled in this foundation',
        403,
      );
    const result = this.db
      .prepare(
        'UPDATE drafts SET version=version+1,configuration=?,hash=?,updated_at=? WHERE scope=? AND version=?',
      )
      .run(
        canonicalJson(configuration),
        hash(configuration),
        new Date().toISOString(),
        scopeKey(context),
        expectedVersion,
      );
    if (result.changes !== 1)
      throw new KernelError(
        'VERSION_CONFLICT',
        'The draft changed. Reload it before applying your changes.',
        409,
      );
    return this.read(context, 'draft');
  }
  replay(
    context: Context,
    operation: string,
    key: string,
    requestHash: string,
  ): unknown | undefined {
    const row = this.db
      .prepare(
        'SELECT request_hash,result FROM idempotency WHERE scope=? AND actor_id=? AND operation=? AND key=?',
      )
      .get(scopeKey(context), context.actorId, operation, key);
    if (!row) return undefined;
    if (row.request_hash !== requestHash)
      throw new KernelError(
        'IDEMPOTENCY_CONFLICT',
        'This idempotency key was used with different input',
        409,
      );
    return JSON.parse(String(row.result));
  }
  remember(context: Context, operation: string, key: string, requestHash: string, result: unknown) {
    this.db
      .prepare('INSERT INTO idempotency VALUES(?,?,?,?,?,?)')
      .run(scopeKey(context), context.actorId, operation, key, requestHash, canonicalJson(result));
  }
  audit(context: Context, operation: string, outcome: string) {
    this.db
      .prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?)')
      .run(
        randomUUID(),
        scopeKey(context),
        context.actorId,
        operation,
        outcome,
        context.correlationId,
        new Date().toISOString(),
      );
  }
  audits(scope: Scope) {
    return this.db
      .prepare(
        'SELECT id,actor_id AS actorId,operation,outcome,correlation_id AS correlationId,created_at AS createdAt FROM audit WHERE scope=? ORDER BY rowid DESC LIMIT 100',
      )
      .all(scopeKey(scope));
  }

  private parseInsuranceRecord(
    raw: unknown,
    expectedHash: unknown,
    scope: Scope,
    recordId: string,
    ancestors: ReadonlySet<string> = new Set(),
  ): InsuranceRecord {
    try {
      const record = insuranceRecordSchema.parse(JSON.parse(String(raw)));
      const node = record.id + ':' + record.version;
      if (ancestors.has(node)) throw new Error('Cyclic insurance evidence graph');
      const ancestry = new Set([...ancestors, node]);
      const { recordHash, ...content } = record;
      if (record.sourceMode === 'configured_product') {
        const decision = record.decision;
        if (!decision) throw new Error('Configured record is missing decision evidence');
        for (const evidence of [
          decision.evaluation,
          ...(decision.bindEvaluation ? [decision.bindEvaluation.evaluation] : []),
        ]) {
          const { evaluationHash, ...evaluationContent } = evidence;
          if (
            hash(evaluationContent) !== evaluationHash ||
            hash(decision.submission) !== evidence.inputHash ||
            evidence.productId !== record.productId ||
            evidence.productVersion !== record.productVersion ||
            evidence.policyHash !== record.productPolicyHash ||
            evidence.runtimeReleaseId !== record.runtimeReleaseId
          )
            throw new Error('Configured decision identity differs');
        }
        if (
          decision.submission.reference !== record.quote.sourceQuote.reference ||
          decision.submission.version !== record.quote.sourceQuote.version ||
          decision.evaluation.rating.premiumMinor !== record.quote.premiumMinor ||
          (!record.configuredService &&
            !record.configuredCancellation &&
            record.premiumMinor !== record.quote.premiumMinor)
        )
          throw new Error('Configured decision quote differs');
      } else if (record.decision || record.configuredService || record.configuredCancellation)
        throw new Error('Manual records cannot assert configured decision or service evidence');
      if (
        record.decision?.evaluation.engineVersion === 'insurance-decision-v2' ||
        record.configuredService ||
        record.configuredCancellation
      ) {
        const release = record.runtimeReleaseId
          ? this.control.release(scope, record.runtimeReleaseId)
          : null;
        const definition = release?.configuration.configuration.products.find(
          (p) => p.id === record.productId && p.version === record.productVersion,
        )?.insurance;
        const policy = release?.runtimeDraft.policies.find(
          (p) => p.id === record.productId && p.version === record.productVersion,
        );
        if (
          !release ||
          definition?.schemaVersion !== 'insurance-product-v2' ||
          !policy ||
          hash(policy) !== record.productPolicyHash ||
          !record.decision
        )
          throw new Error('Configured v2 record has no matching retained release');
        for (const [evaluation, at] of [
          [record.decision.evaluation, record.decision.evaluatedAt],
          ...(record.decision.bindEvaluation
            ? [
                [
                  record.decision.bindEvaluation.evaluation,
                  record.decision.bindEvaluation.evaluatedAt,
                ],
              ]
            : []),
        ] as const) {
          if (typeof at !== 'string' || !evaluation || typeof evaluation === 'string')
            throw new Error('Missing decision time');
          const recomputed = evaluateInsuranceProduct(
            {
              productId: record.productId,
              productVersion: record.productVersion,
              definition,
              policy,
              policyHash: record.productPolicyHash,
              runtimeReleaseId: release.id,
              releaseHash: release.hash,
              now: new Date(at),
            },
            record.decision.submission,
          );
          if (hash(evaluation) !== hash(recomputed))
            throw new Error('Stored v2 decision differs from retained definition recomputation');
        }
        if (record.configuredService && !record.configuredCancellation) {
          const service = record.configuredService;
          if (
            record.status !== 'bound' ||
            service.status !== 'allowed' ||
            !service.calculation ||
            service.recordId !== record.id ||
            service.priorVersion !== record.version - 1 ||
            service.evaluatedAt !== record.updatedAt ||
            service.effectiveDate !== record.lastEffectiveDate
          )
            throw new Error('Service revision identity differs');
          const previousRow = this.db
            .prepare(
              'SELECT record_json,record_hash FROM insurance_revisions WHERE scope=? AND record_id=? AND version=?',
            )
            .get(scopeKey(scope), recordId, service.priorVersion);
          if (!previousRow || previousRow.record_hash !== service.priorRecordHash)
            throw new Error('Service prior revision is absent or differs');
          const previous = this.parseInsuranceRecord(
            previousRow.record_json,
            previousRow.record_hash,
            scope,
            recordId,
            ancestry,
          );
          if (
            previous.status !== 'bound' ||
            hash(previous.quote) !== hash(record.quote) ||
            hash(previous.decision) !== hash(record.decision) ||
            hash(previous.approval ?? null) !== hash(record.approval ?? null) ||
            previous.quoteHash !== record.quoteHash ||
            previous.createdAt !== record.createdAt ||
            previous.productId !== record.productId ||
            previous.productVersion !== record.productVersion ||
            previous.productPolicyHash !== record.productPolicyHash ||
            previous.runtimeReleaseId !== record.runtimeReleaseId ||
            previous.currency !== record.currency ||
            hash(effectiveConfiguredSubmission(previous)) !== service.priorSubmissionHash
          )
            throw new Error('Service altered original contract evidence');
          const recomputed = evaluateConfiguredService(
            {
              record: previous,
              definition,
              policy,
              releaseHash: release.hash,
              now: new Date(service.evaluatedAt),
            },
            {
              recordId: previous.id,
              recordHash: previous.recordHash,
              expectedVersion: previous.version,
              submission: service.submission,
              effectiveDate: service.effectiveDate,
              reason: service.reason,
              evidenceRefs: service.evidenceRefs,
            },
          );
          const { evaluatedAt: _, ...preview } = service;
          if (
            hash(preview) !== hash(recomputed) ||
            record.premiumMinor !== service.calculation.resultingPremiumMinor ||
            BigInt(record.premiumMinor) - BigInt(previous.premiumMinor) !==
              BigInt(service.calculation.premiumDeltaMinor)
          )
            throw new Error('Stored service differs from exact retained calculation');
        }
        if (record.configuredCancellation) {
          const cancellation = record.configuredCancellation;
          if (
            record.status !== 'cancelled' ||
            cancellation.status !== 'allowed' ||
            !cancellation.calculation ||
            cancellation.recordId !== record.id ||
            cancellation.priorVersion !== record.version - 1 ||
            cancellation.evaluatedAt !== record.updatedAt ||
            cancellation.effectiveDate !== record.lastEffectiveDate
          )
            throw new Error('Cancellation identity differs');
          const previousRow = this.db
            .prepare(
              'SELECT record_json,record_hash FROM insurance_revisions WHERE scope=? AND record_id=? AND version=?',
            )
            .get(scopeKey(scope), recordId, cancellation.priorVersion);
          if (!previousRow || previousRow.record_hash !== cancellation.priorRecordHash)
            throw new Error('Missing exact cancellation source');
          const previous = this.parseInsuranceRecord(
            previousRow.record_json,
            previousRow.record_hash,
            scope,
            recordId,
            ancestry,
          );
          if (
            previous.status !== 'bound' ||
            hash(previous.quote) !== hash(record.quote) ||
            hash(previous.decision) !== hash(record.decision) ||
            hash(previous.configuredService ?? null) !== hash(record.configuredService ?? null) ||
            hash(previous.approval ?? null) !== hash(record.approval ?? null) ||
            previous.quoteHash !== record.quoteHash ||
            previous.createdAt !== record.createdAt ||
            previous.productId !== record.productId ||
            previous.productVersion !== record.productVersion ||
            previous.productPolicyHash !== record.productPolicyHash ||
            previous.runtimeReleaseId !== record.runtimeReleaseId ||
            previous.currency !== record.currency
          )
            throw new Error('Cancellation changed retained contract evidence');
          const recomputed = evaluateConfiguredCancellation(
            {
              record: previous,
              definition,
              policy,
              releaseHash: release.hash,
              now: new Date(cancellation.evaluatedAt),
            },
            {
              recordId: previous.id,
              expectedVersion: previous.version,
              recordHash: previous.recordHash,
              effectiveDate: cancellation.effectiveDate,
              reason: cancellation.reason,
              evidenceRefs: cancellation.evidenceRefs,
            },
          );
          const { evaluatedAt: _, ...preview } = cancellation;
          if (
            hash(preview) !== hash(recomputed) ||
            record.premiumMinor !== cancellation.calculation.resultingPremiumMinor ||
            BigInt(record.premiumMinor) - BigInt(previous.premiumMinor) !==
              BigInt(cancellation.calculation.premiumDeltaMinor)
          )
            throw new Error('Cancellation calculation differs');
        }
        const expectedFinancials = allocateFinancials({
          currency: record.currency,
          premiumMinor: record.premiumMinor,
          participants: record.quote.participants,
          commission: policy.commission,
        });
        if (hash(expectedFinancials) !== hash(record.financials))
          throw new Error('Configured cumulative financial allocation differs');
      }
      if (record.renewal) {
        const link = record.renewal,
          source = link.source;
        if (
          record.sourceMode !== 'configured_product' ||
          !record.decision ||
          source.recordId === record.id
        )
          throw new Error('Invalid renewal relation');
        const row = this.db
          .prepare(
            'SELECT record_json,record_hash FROM insurance_revisions WHERE scope=? AND record_id=? AND version=?',
          )
          .get(scopeKey(scope), source.recordId, source.version);
        if (!row || row.record_hash !== source.recordHash)
          throw new Error('Missing pinned renewal source');
        const previous = this.parseInsuranceRecord(
            row.record_json,
            row.record_hash,
            scope,
            source.recordId,
            ancestry,
          ),
          submission = effectiveConfiguredSubmission(previous);
        if (
          previous.status !== 'bound' ||
          !submission ||
          previous.productId !== record.productId ||
          previous.quoteHash !== source.quoteHash ||
          hash(submission) !== source.submissionHash ||
          previous.runtimeReleaseId !== source.runtimeReleaseId ||
          record.quote.term.startDate <= submission.term.endDate ||
          record.quote.sourceQuote.reference === submission.reference ||
          link.requestedAt !== record.createdAt ||
          Date.parse(previous.updatedAt) > Date.parse(link.requestedAt) ||
          hash(link.comparison) !==
            hash(compareRenewalSubmissions(submission, record.decision.submission))
        )
          throw new Error('Renewal comparison or source linkage differs');
      }
      if (record.approval) {
        const evidence = record.approval;
        const approved = this.approvals.history(scope, evidence.approvalId)[
          evidence.approvalVersion - 1
        ];
        if (
          !approved ||
          approved.status !== 'approved' ||
          approved.approvalHash !== evidence.approvalHash ||
          hash(approved.target) !== hash(evidence.target) ||
          hash(approved.gates) !== hash(evidence.gates) ||
          approved.actorId !== evidence.reviewerId ||
          approved.occurredAt !== evidence.approvedAt ||
          approved.expiresAt !== evidence.expiresAt ||
          evidence.target.recordId !== record.id ||
          evidence.target.quoteHash !== record.quoteHash ||
          evidence.target.productId !== record.productId ||
          evidence.target.productVersion !== record.productVersion ||
          evidence.target.policyHash !== record.productPolicyHash ||
          evidence.target.runtimeReleaseId !== (record.runtimeReleaseId ?? null) ||
          evidence.target.recordVersion >= record.version ||
          Date.parse(evidence.approvedAt) > Date.parse(evidence.checkedAt) ||
          Date.parse(evidence.checkedAt) >= Date.parse(evidence.expiresAt)
        )
          throw new Error('Bound independent review differs from retained approval evidence');
        const source = this.db
          .prepare(
            'SELECT record_json,record_hash FROM insurance_revisions WHERE scope=? AND record_id=? AND version=?',
          )
          .get(scopeKey(scope), recordId, evidence.target.recordVersion);
        if (!source || source.record_hash !== evidence.target.recordHash)
          throw new Error('Independent review target has no matching retained quote');
        const quote = this.parseInsuranceRecord(
          source.record_json,
          source.record_hash,
          scope,
          recordId,
          ancestry,
        );
        if (
          quote.status !== 'quoted' ||
          quote.quoteHash !== evidence.target.quoteHash ||
          (quote.decision?.evaluation.evaluationHash ?? null) !== evidence.target.decisionHash ||
          (quote.decision?.evaluation.inputHash ?? null) !== evidence.target.inputHash ||
          (quote.decision?.evaluation.definitionHash ?? null) !== evidence.target.definitionHash
        )
          throw new Error('Independent review target is not the original evaluated quote');
        if (record.version === evidence.target.recordVersion + 1) {
          if (record.status !== 'bound' || record.updatedAt !== evidence.checkedAt)
            throw new Error('Independent review was not retained on the original bind');
        } else {
          const boundRow = this.db
            .prepare(
              'SELECT record_json,record_hash FROM insurance_revisions WHERE scope=? AND record_id=? AND version=?',
            )
            .get(scopeKey(scope), recordId, evidence.target.recordVersion + 1);
          if (!boundRow) throw new Error('Independent review has no retained bound revision');
          const bound = this.parseInsuranceRecord(
            boundRow.record_json,
            boundRow.record_hash,
            scope,
            recordId,
            ancestry,
          );
          if (hash(bound.approval) !== hash(evidence))
            throw new Error('Service revision changed original independent review evidence');
        }
      }
      if (
        recordHash !== expectedHash ||
        hash(content) !== recordHash ||
        hash(record.quote) !== record.quoteHash ||
        scopeKey(record.scope) !== scopeKey(scope) ||
        record.id !== recordId
      )
        throw new Error('Insurance record hash or scope differs');
      return record;
    } catch {
      throw new KernelError(
        'INTEGRITY_ERROR',
        'Stored insurance record failed its integrity check',
        500,
      );
    }
  }

  insuranceRead(scope: Scope, recordId: string): InsuranceRecord {
    const head = this.db
      .prepare('SELECT version,record_hash FROM insurance_records WHERE scope=? AND id=?')
      .get(scopeKey(scope), recordId);
    if (!head)
      throw new KernelError('NOT_FOUND', 'No insurance record exists in the authorized scope', 404);
    const row = this.db
      .prepare(
        'SELECT record_json,record_hash FROM insurance_revisions WHERE scope=? AND record_id=? AND version=?',
      )
      .get(scopeKey(scope), recordId, head.version!);
    if (!row || row.record_hash !== head.record_hash)
      throw new KernelError(
        'INTEGRITY_ERROR',
        'Insurance head does not match its immutable revision',
        500,
      );
    const record = this.parseInsuranceRecord(row.record_json, row.record_hash, scope, recordId);
    const identity = this.db
      .prepare(
        'SELECT product_id,source_quote_reference FROM insurance_quote_identities WHERE scope=? AND record_id=?',
      )
      .get(scopeKey(scope), recordId);
    if (
      !identity ||
      identity.product_id !== record.productId ||
      identity.source_quote_reference !== record.quote.sourceQuote.reference
    )
      throw new KernelError(
        'INTEGRITY_ERROR',
        'Insurance record has no matching immutable external quote identity',
        500,
      );
    if (record.version !== head.version)
      throw new KernelError('INTEGRITY_ERROR', 'Insurance revision number differs', 500);
    if (record.renewal) {
      const claim = this.db
        .prepare(
          'SELECT source_record_id,term_start FROM insurance_renewal_identities WHERE scope=? AND record_id=?',
        )
        .get(scopeKey(scope), record.id);
      if (
        !claim ||
        claim.source_record_id !== record.renewal.source.recordId ||
        claim.term_start !== record.quote.term.startDate
      )
        throw new KernelError(
          'INTEGRITY_ERROR',
          'Renewal business identity differs from its retained quote',
          500,
        );
    }
    return record;
  }

  insuranceList(scope: Scope) {
    const rows = this.db
      .prepare('SELECT id FROM insurance_records WHERE scope=? ORDER BY rowid DESC LIMIT 101')
      .all(scopeKey(scope));
    return {
      records: rows.slice(0, 100).map((row) => this.insuranceRead(scope, String(row.id))),
      hasMore: rows.length > 100,
    };
  }

  insuranceHistory(scope: Scope, recordId: string) {
    const current = this.insuranceRead(scope, recordId);
    const rows = this.db
      .prepare(
        'SELECT record_json,record_hash FROM insurance_revisions WHERE scope=? AND record_id=? ORDER BY version',
      )
      .all(scopeKey(scope), recordId);
    const revisions = rows.map((row) =>
      this.parseInsuranceRecord(row.record_json, row.record_hash, scope, recordId),
    );
    const eventRows = this.db
      .prepare(
        'SELECT event_json,event_hash FROM insurance_events WHERE scope=? AND record_id=? ORDER BY version',
      )
      .all(scopeKey(scope), recordId);
    try {
      const events = eventRows.map((row, index) => {
        const event = insuranceEventSchema.parse(JSON.parse(String(row.event_json)));
        const revision = revisions[index];
        if (
          hash(event) !== row.event_hash ||
          scopeKey(event.scope) !== scopeKey(scope) ||
          event.recordId !== recordId ||
          event.version !== index + 1 ||
          revision?.version !== index + 1 ||
          event.recordHash !== revision.recordHash ||
          event.createdAt !== revision.updatedAt ||
          event.effectiveDate !== revision.lastEffectiveDate ||
          event.previousRecordHash !== (revisions[index - 1]?.recordHash ?? null) ||
          BigInt(event.premiumDeltaMinor) !==
            BigInt(revision?.premiumMinor ?? '0') -
              BigInt(revisions[index - 1]?.premiumMinor ?? '0') ||
          (revision?.configuredCancellation?.priorVersion === index &&
            (event.type !== 'cancellation' ||
              event.effectiveDate !== revision.configuredCancellation.effectiveDate)) ||
          (!revision?.configuredCancellation &&
            revision?.configuredService?.priorVersion === index &&
            (event.type !== 'endorsement' ||
              event.effectiveDate !== revision.configuredService.effectiveDate))
        )
          throw new Error('Broken event chain');
        return event;
      });
      if (
        events.length !== current.version ||
        revisions.length !== current.version ||
        revisions.at(-1)?.recordHash !== current.recordHash
      )
        throw new Error('Incomplete insurance history');
      return { recordId, revisions, events };
    } catch {
      throw new KernelError('INTEGRITY_ERROR', 'Insurance history failed its integrity check', 500);
    }
  }

  /** Called inside the canonical command transaction, including outbox and idempotency. */
  insuranceCommit(
    record: InsuranceRecord,
    event: InsuranceEvent,
    previousVersion: number | null,
  ): void {
    this.parseInsuranceRecord(canonicalJson(record), record.recordHash, record.scope, record.id);
    insuranceEventSchema.parse(event);
    if (
      scopeKey(record.scope) !== scopeKey(event.scope) ||
      event.recordId !== record.id ||
      event.version !== record.version ||
      event.recordHash !== record.recordHash ||
      event.createdAt !== record.updatedAt ||
      event.effectiveDate !== record.lastEffectiveDate ||
      record.version !== (previousVersion ?? 0) + 1
    )
      throw new KernelError('INTEGRITY_ERROR', 'Insurance event does not match its revision', 500);
    const key = scopeKey(record.scope);
    if (previousVersion === null) {
      if (record.renewal) {
        const existing = this.db
          .prepare(
            'SELECT record_id FROM insurance_renewal_identities WHERE scope=? AND source_record_id=? AND term_start=?',
          )
          .get(key, record.renewal.source.recordId, record.quote.term.startDate);
        if (existing)
          throw new KernelError(
            'RENEWAL_EXISTS',
            'This source policy and renewal start date already belong to a retained renewal quote',
            409,
          );
      }

      const existing = this.db
        .prepare(
          'SELECT record_id FROM insurance_quote_identities WHERE scope=? AND product_id=? AND source_quote_reference=?',
        )
        .get(key, record.productId, record.quote.sourceQuote.reference);
      if (existing)
        throw new KernelError(
          'SOURCE_QUOTE_EXISTS',
          `This external source quote already belongs to record ${String(existing.record_id)}; revise that record`,
          409,
        );
      this.db
        .prepare('INSERT INTO insurance_records VALUES(?,?,?,?)')
        .run(key, record.id, record.version, record.recordHash);
      this.db
        .prepare('INSERT INTO insurance_quote_identities VALUES(?,?,?,?)')
        .run(key, record.productId, record.quote.sourceQuote.reference, record.id);
      if (record.renewal)
        this.db
          .prepare('INSERT INTO insurance_renewal_identities VALUES(?,?,?,?)')
          .run(key, record.renewal.source.recordId, record.quote.term.startDate, record.id);
    } else {
      const updated = this.db
        .prepare(
          'UPDATE insurance_records SET version=?,record_hash=? WHERE scope=? AND id=? AND version=? AND record_hash=?',
        )
        .run(
          record.version,
          record.recordHash,
          key,
          record.id,
          previousVersion,
          event.previousRecordHash,
        );
      if (updated.changes !== 1)
        throw new KernelError(
          'VERSION_CONFLICT',
          'The insurance record changed; reload it before retrying',
          409,
        );
    }
    this.db
      .prepare('INSERT INTO insurance_revisions VALUES(?,?,?,?,?)')
      .run(key, record.id, record.version, canonicalJson(record), record.recordHash);
    this.db
      .prepare('INSERT INTO insurance_events VALUES(?,?,?,?,?,?)')
      .run(event.id, key, record.id, event.version, canonicalJson(event), hash(event));
    const payload = { event };
    this.db
      .prepare('INSERT INTO insurance_outbox VALUES(?,?,?,?,?,?,?,?)')
      .run(
        randomUUID(),
        key,
        record.id,
        event.id,
        canonicalJson(payload),
        hash(payload),
        'pending',
        event.createdAt,
      );
  }

  insuranceReplay(
    scope: Scope,
    operation: string,
    key: string,
    requestHash: string,
  ): InsuranceMutationResult | undefined {
    const row = this.db
      .prepare(
        'SELECT request_hash,result,result_hash FROM insurance_idempotency WHERE scope=? AND operation=? AND key=?',
      )
      .get(scopeKey(scope), operation, key);
    if (!row) return undefined;
    if (row.request_hash !== requestHash)
      throw new KernelError(
        'IDEMPOTENCY_CONFLICT',
        'This insurance idempotency key was used with different input',
        409,
      );
    try {
      const result = insuranceMutationResultSchema.parse(JSON.parse(String(row.result)));
      if (hash(result) !== row.result_hash || scopeKey(result.record.scope) !== scopeKey(scope))
        throw new Error('Replay differs');
      return result;
    } catch {
      throw new KernelError(
        'INTEGRITY_ERROR',
        'Insurance retry result failed its integrity check',
        500,
      );
    }
  }

  insuranceRemember(
    scope: Scope,
    operation: string,
    key: string,
    requestHash: string,
    result: InsuranceMutationResult,
  ): void {
    this.db
      .prepare('INSERT INTO insurance_idempotency VALUES(?,?,?,?,?,?)')
      .run(scopeKey(scope), operation, key, requestHash, canonicalJson(result), hash(result));
  }

  insuranceOutbox(scope: Scope) {
    return this.db
      .prepare(
        'SELECT id,event_id AS eventId,payload,payload_hash AS payloadHash,status,created_at AS createdAt FROM insurance_outbox WHERE scope=? ORDER BY rowid',
      )
      .all(scopeKey(scope))
      .map((row) => {
        try {
          const payload = JSON.parse(String(row.payload));
          if (
            hash(payload) !== row.payloadHash ||
            scopeKey(insuranceEventSchema.parse(payload.event).scope) !== scopeKey(scope)
          )
            throw new Error('Outbox differs');
          return {
            id: String(row.id),
            eventId: String(row.eventId),
            payloadHash: String(row.payloadHash),
            status: String(row.status),
            createdAt: String(row.createdAt),
            payload,
          };
        } catch {
          throw new KernelError(
            'INTEGRITY_ERROR',
            'Pending insurance outbox failed its integrity check',
            500,
          );
        }
      });
  }
}

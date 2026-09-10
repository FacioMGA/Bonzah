import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { scopeSchema, type Scope } from '../contracts/configuration.js';
import {
  providerAuditSchema,
  providerExecutionViewSchema,
  providerJobStateSchema,
  providerRequestSchema,
  type ProviderAudit,
  type ProviderExecutionView,
  type ProviderJobState,
  type ProviderRequest,
} from '../contracts/provider-execution.js';
import {
  providerReceiptSchema,
  type ProviderEnvelope,
  type ProviderReceipt,
} from '../contracts/provider.js';
import { providerReceiptKeys, type ProviderHistory } from '../domain/provider.js';
import { canonicalJson, hash, KernelError } from '../domain/canonical.js';

const scopeKey = (scope: Scope) => canonicalJson(scopeSchema.parse(scope));
const integrity = () =>
  new KernelError('INTEGRITY_ERROR', 'Stored provider evidence failed integrity validation', 500);
type Snapshot = {
  request: ProviderRequest;
  state: ProviderJobState;
  audit: ProviderAudit[];
  receipts: ProviderReceipt[];
};
type Change = Partial<
  Pick<
    ProviderJobState,
    'status' | 'task' | 'attempts' | 'nextAttemptAt' | 'claim' | 'lastFailure' | 'receiptHash'
  >
>;

/** Shares the owning Store transaction/connection. Methods are synchronous and never commit. */
export class ProviderStorage {
  constructor(private readonly db: DatabaseSync) {}
  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS provider_requests (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, adapter_id TEXT NOT NULL,
        record_id TEXT NOT NULL, record_version INTEGER NOT NULL,
        request_json TEXT NOT NULL, request_hash TEXT NOT NULL,
        provider_id TEXT NOT NULL,quote_reference TEXT NOT NULL,stream_position INTEGER NOT NULL,
        UNIQUE(scope,adapter_id,record_id,record_version),UNIQUE(scope,provider_id,quote_reference,stream_position));
      CREATE TABLE IF NOT EXISTS provider_job_heads (
        request_id TEXT PRIMARY KEY REFERENCES provider_requests(id),
        version INTEGER NOT NULL, state_hash TEXT NOT NULL, status TEXT NOT NULL,
        next_attempt_at TEXT NOT NULL, claim_expires_at TEXT);
      CREATE TABLE IF NOT EXISTS provider_revisions (
        request_id TEXT NOT NULL REFERENCES provider_requests(id), version INTEGER NOT NULL,
        state_json TEXT NOT NULL,state_hash TEXT NOT NULL, PRIMARY KEY(request_id,version));
      CREATE TABLE IF NOT EXISTS provider_audit (
        request_id TEXT NOT NULL, version INTEGER NOT NULL,event_json TEXT NOT NULL,event_hash TEXT NOT NULL,
        PRIMARY KEY(request_id,version), FOREIGN KEY(request_id,version) REFERENCES provider_revisions(request_id,version));
      CREATE TABLE IF NOT EXISTS provider_receipts (
        event_key TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL UNIQUE,stream_key TEXT NOT NULL,
        sequence INTEGER NOT NULL, request_id TEXT NOT NULL REFERENCES provider_requests(id),
        receipt_json TEXT NOT NULL,receipt_hash TEXT NOT NULL UNIQUE,
        ordering_effect TEXT NOT NULL CHECK(ordering_effect IN ('active','historical')),association_hash TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS provider_active_sequence ON provider_receipts(stream_key,sequence) WHERE ordering_effect='active';
      CREATE TABLE IF NOT EXISTS provider_nonces (
        replay_key TEXT PRIMARY KEY,request_id TEXT NOT NULL REFERENCES provider_requests(id),payload_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS provider_commands (
        scope TEXT NOT NULL,operation TEXT NOT NULL,key TEXT NOT NULL,request_hash TEXT NOT NULL,
        result_json TEXT NOT NULL,result_hash TEXT NOT NULL,PRIMARY KEY(scope,operation,key));
      CREATE INDEX IF NOT EXISTS provider_due ON provider_job_heads(status,next_attempt_at);
      CREATE INDEX IF NOT EXISTS provider_leases ON provider_job_heads(status,claim_expires_at);
      CREATE INDEX IF NOT EXISTS provider_scoped_requests ON provider_requests(scope,record_id);
    `);
    for (const table of [
      'provider_requests',
      'provider_revisions',
      'provider_audit',
      'provider_receipts',
      'provider_nonces',
      'provider_commands',
    ])
      for (const action of ['UPDATE', 'DELETE'])
        this.db.exec(
          `CREATE TRIGGER IF NOT EXISTS ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'immutable provider evidence'); END;`,
        );
    this.db.exec(
      "CREATE TRIGGER IF NOT EXISTS provider_job_heads_no_delete BEFORE DELETE ON provider_job_heads BEGIN SELECT RAISE(ABORT,'immutable provider identity'); END;",
    );
  }
  private parse<T>(schema: z.ZodType<T>, raw: unknown, expectedHash: unknown, ownHash?: string): T {
    try {
      const value = schema.parse(JSON.parse(String(raw)));
      if (ownHash) {
        const data = value as Record<string, unknown>;
        const { [ownHash]: contentHash, ...content } = data;
        if (contentHash !== expectedHash || hash(content) !== expectedHash) throw integrity();
      } else if (hash(value) !== expectedHash) throw integrity();
      return value;
    } catch {
      throw integrity();
    }
  }
  request(id: string): ProviderRequest | null {
    const row = this.db.prepare('SELECT * FROM provider_requests WHERE id=?').get(id);
    if (!row) return null;
    const r = this.parse(providerRequestSchema, row.request_json, row.request_hash, 'requestHash');
    if (
      r.id !== row.id ||
      scopeKey(r.scope) !== row.scope ||
      r.adapter.adapterId !== row.adapter_id ||
      r.recordId !== row.record_id ||
      r.recordVersion !== row.record_version ||
      r.adapter.providerId !== row.provider_id ||
      r.selection.quoteReference !== row.quote_reference ||
      r.streamPosition !== row.stream_position ||
      hash(r.quote) !== r.selection.quoteHash ||
      hash(r.submission) !== r.selection.riskHash ||
      r.quote.sourceQuote.reference !== r.selection.quoteReference ||
      r.quote.sourceQuote.version !== r.selection.quoteVersion ||
      r.deadlineAt <= r.createdAt ||
      r.adapter.operations.indexOf('quote') < 0
    )
      throw integrity();
    return r;
  }
  snapshot(id: string): Snapshot | null {
    const request = this.request(id);
    if (!request) return null;
    const head = this.db.prepare('SELECT * FROM provider_job_heads WHERE request_id=?').get(id);
    const rows = this.db
      .prepare(
        'SELECT r.*,a.event_json,a.event_hash FROM provider_revisions r LEFT JOIN provider_audit a ON a.request_id=r.request_id AND a.version=r.version WHERE r.request_id=? ORDER BY r.version',
      )
      .all(id);
    if (!head || !rows.length) throw integrity();
    let previous: ProviderAudit | undefined;
    let state: ProviderJobState | undefined;
    const audit: ProviderAudit[] = [];
    for (const [index, row] of rows.entries()) {
      state = this.parse(providerJobStateSchema, row.state_json, row.state_hash, 'stateHash');
      const event = this.parse(providerAuditSchema, row.event_json, row.event_hash, 'auditHash');
      if (
        state.requestId !== id ||
        state.version !== index + 1 ||
        state.version !== row.version ||
        event.requestId !== id ||
        event.version !== state.version ||
        scopeKey(event.scope) !== scopeKey(request.scope) ||
        event.previousHash !== (previous?.auditHash ?? null) ||
        event.stateHash !== state.stateHash ||
        event.attempt !== state.attempts ||
        event.receiptHash !== state.receiptHash ||
        state.attempts > request.policy.maxAttempts ||
        (state.status === 'in_flight') !== (state.claim !== null)
      )
        throw integrity();
      previous = event;
      audit.push(event);
    }
    if (
      !state ||
      state.version !== head.version ||
      state.stateHash !== head.state_hash ||
      state.status !== head.status ||
      state.nextAttemptAt !== head.next_attempt_at ||
      (state.claim?.expiresAt ?? null) !== head.claim_expires_at
    )
      throw integrity();
    const receipts = this.db
      .prepare('SELECT * FROM provider_receipts WHERE request_id=? ORDER BY sequence')
      .all(id)
      .map((r) => this.receipt(r));
    if (state.receiptHash && !receipts.some((r) => r.receiptHash === state!.receiptHash))
      throw integrity();
    return { request, state, audit, receipts };
  }
  view(scope: Scope, id: string): ProviderExecutionView {
    const request = this.request(id);
    if (!request || scopeKey(request.scope) !== scopeKey(scope))
      throw new KernelError(
        'PROVIDER_REQUEST_NOT_FOUND',
        'Provider request is unavailable in this scope',
        404,
      );
    const snapshot = this.snapshot(id)!;
    const { claim: _claim, ...state } = snapshot.state;
    return providerExecutionViewSchema.parse({
      ...snapshot,
      state,
      authority: 'evidence_only_no_insurance_mutation',
    });
  }
  list(scope: Scope, recordId?: string): ProviderExecutionView[] {
    const rows = recordId
      ? this.db
          .prepare(
            'SELECT id FROM provider_requests WHERE scope=? AND record_id=? ORDER BY rowid DESC LIMIT 100',
          )
          .all(scopeKey(scope), recordId)
      : this.db
          .prepare('SELECT id FROM provider_requests WHERE scope=? ORDER BY rowid DESC LIMIT 100')
          .all(scopeKey(scope));
    return rows.map((r) => this.view(scope, String(r.id)));
  }
  hasMore(scope: Scope, recordId?: string): boolean {
    const row = recordId
      ? this.db
          .prepare('SELECT COUNT(*) AS total FROM provider_requests WHERE scope=? AND record_id=?')
          .get(scopeKey(scope), recordId)
      : this.db
          .prepare('SELECT COUNT(*) AS total FROM provider_requests WHERE scope=?')
          .get(scopeKey(scope));
    return Number(row?.total) > 100;
  }
  existing(scope: Scope, adapterId: string, recordId: string, version: number): string | null {
    const row = this.db
      .prepare(
        'SELECT id FROM provider_requests WHERE scope=? AND adapter_id=? AND record_id=? AND record_version=?',
      )
      .get(scopeKey(scope), adapterId, recordId, version);
    return row ? String(row.id) : null;
  }
  command(
    scope: Scope,
    operation: string,
    key: string,
    fingerprint: string,
  ): ProviderExecutionView | null {
    const row = this.db
      .prepare('SELECT * FROM provider_commands WHERE scope=? AND operation=? AND key=?')
      .get(scopeKey(scope), operation, key);
    if (!row) return null;
    if (row.request_hash !== fingerprint)
      throw new KernelError(
        'IDEMPOTENCY_CONFLICT',
        'Provider idempotency key was already used with different input',
        409,
      );
    const result = this.parse(providerExecutionViewSchema, row.result_json, row.result_hash);
    if (scopeKey(result.request.scope) !== scopeKey(scope)) throw integrity();
    return result;
  }
  remember(
    scope: Scope,
    operation: string,
    key: string,
    fingerprint: string,
    result: ProviderExecutionView,
  ) {
    this.db
      .prepare('INSERT INTO provider_commands VALUES(?,?,?,?,?,?)')
      .run(scopeKey(scope), operation, key, fingerprint, canonicalJson(result), hash(result));
  }
  create(request: ProviderRequest): void {
    this.db
      .prepare('INSERT INTO provider_requests VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(
        request.id,
        scopeKey(request.scope),
        request.adapter.adapterId,
        request.recordId,
        request.recordVersion,
        canonicalJson(request),
        request.requestHash,
        request.adapter.providerId,
        request.selection.quoteReference,
        request.streamPosition,
      );
    const base = {
      requestId: request.id,
      version: 1,
      status: 'queued' as const,
      task: 'send' as const,
      attempts: 0,
      nextAttemptAt: request.createdAt,
      claim: null,
      lastFailure: null,
      receiptHash: null,
      updatedAt: request.createdAt,
    };
    const state = providerJobStateSchema.parse({ ...base, stateHash: hash(base) });
    this.db
      .prepare('INSERT INTO provider_job_heads VALUES(?,?,?,?,?,?)')
      .run(request.id, 1, state.stateHash, state.status, state.nextAttemptAt, null);
    this.append(request, state, 'requested', request.actorId, request.correlationId, null, null);
  }
  private append(
    request: ProviderRequest,
    state: ProviderJobState,
    kind: ProviderAudit['kind'],
    actorId: string | null,
    correlationId: string,
    code: string | null,
    previousHash: string | null,
  ): void {
    const content = {
      id: randomUUID(),
      requestId: request.id,
      scope: request.scope,
      version: state.version,
      kind,
      actorId,
      correlationId,
      attempt: state.attempts,
      createdAt: state.updatedAt,
      stateHash: state.stateHash,
      receiptHash: state.receiptHash,
      code,
      previousHash,
    };
    const event = providerAuditSchema.parse({ ...content, auditHash: hash(content) });
    this.db
      .prepare('INSERT INTO provider_revisions VALUES(?,?,?,?)')
      .run(request.id, state.version, canonicalJson(state), state.stateHash);
    this.db
      .prepare('INSERT INTO provider_audit VALUES(?,?,?,?)')
      .run(request.id, state.version, canonicalJson(event), event.auditHash);
  }
  transition(
    id: string,
    change: Change,
    kind: ProviderAudit['kind'],
    now: string,
    options: { actorId?: string; correlationId?: string; code?: string } = {},
  ): ProviderJobState {
    const snapshot = this.snapshot(id);
    if (!snapshot) throw integrity();
    const { stateHash: _hash, ...before } = snapshot.state;
    const content = { ...before, ...change, version: before.version + 1, updatedAt: now };
    const state = providerJobStateSchema.parse({ ...content, stateHash: hash(content) });
    const updated = this.db
      .prepare(
        'UPDATE provider_job_heads SET version=?,state_hash=?,status=?,next_attempt_at=?,claim_expires_at=? WHERE request_id=? AND version=? AND state_hash=?',
      )
      .run(
        state.version,
        state.stateHash,
        state.status,
        state.nextAttemptAt,
        state.claim?.expiresAt ?? null,
        id,
        before.version,
        snapshot.state.stateHash,
      );
    if (updated.changes !== 1)
      throw new KernelError(
        'PROVIDER_VERSION_CONFLICT',
        'Provider request changed concurrently',
        409,
      );
    this.append(
      snapshot.request,
      state,
      kind,
      options.actorId ?? null,
      options.correlationId ?? snapshot.request.correlationId,
      options.code ?? null,
      snapshot.audit.at(-1)!.auditHash,
    );
    return state;
  }
  due(now: string): string | null {
    const row = this.db
      .prepare(
        "SELECT request_id FROM provider_job_heads WHERE status IN ('queued','retry_wait') AND next_attempt_at<=? ORDER BY next_attempt_at,request_id LIMIT 1",
      )
      .get(now);
    return row ? String(row.request_id) : null;
  }
  expiredClaims(now: string): string[] {
    return this.db
      .prepare(
        "SELECT request_id FROM provider_job_heads WHERE status='in_flight' AND claim_expires_at<=? ORDER BY claim_expires_at LIMIT 100",
      )
      .all(now)
      .map((r) => String(r.request_id));
  }
  private receipt(row: Record<string, unknown>): ProviderReceipt {
    const receipt = this.parse(
      providerReceiptSchema,
      row.receipt_json,
      row.receipt_hash,
      'receiptHash',
    );
    const keys = providerReceiptKeys(receipt.scope, receipt.envelope);
    const request = this.request(String(row.request_id));
    if (
      !request ||
      scopeKey(request.scope) !== scopeKey(receipt.scope) ||
      keys.eventKey !== row.event_key ||
      keys.idempotencyKey !== row.idempotency_key ||
      keys.streamKey !== row.stream_key ||
      receipt.envelope.sequence !== row.sequence ||
      receipt.eventKey !== keys.eventKey ||
      receipt.idempotencyKey !== keys.idempotencyKey ||
      receipt.streamKey !== keys.streamKey ||
      hash(receipt.envelope) !== receipt.envelopeHash ||
      hash(receipt.envelope.selection) !== hash(request.selection) ||
      receipt.envelope.correlationId !== request.correlationId ||
      receipt.envelope.idempotencyKey !== request.outboundIdempotencyKey ||
      !['active', 'historical'].includes(String(row.ordering_effect)) ||
      hash({
        requestId: request.id,
        receiptHash: receipt.receiptHash,
        orderingEffect: row.ordering_effect,
      }) !== row.association_hash
    )
      throw integrity();
    return receipt;
  }
  history(scope: Scope, envelope: ProviderEnvelope, historical = false): ProviderHistory {
    const keys = providerReceiptKeys(scope, envelope);
    const event = this.db
      .prepare('SELECT * FROM provider_receipts WHERE event_key=?')
      .get(keys.eventKey);
    const idempotency = this.db
      .prepare('SELECT * FROM provider_receipts WHERE idempotency_key=?')
      .get(keys.idempotencyKey);
    const latest = historical
      ? this.db
          .prepare(
            "SELECT * FROM provider_receipts WHERE stream_key=? AND ordering_effect='active' AND sequence<? ORDER BY sequence DESC LIMIT 1",
          )
          .get(keys.streamKey, envelope.sequence)
      : this.db
          .prepare(
            "SELECT * FROM provider_receipts WHERE stream_key=? AND ordering_effect='active' ORDER BY sequence DESC LIMIT 1",
          )
          .get(keys.streamKey);
    return {
      byEvent: event ? this.receipt(event) : null,
      byIdempotency: idempotency ? this.receipt(idempotency) : null,
      latestInStream: latest ? this.receipt(latest) : null,
    };
  }
  nextSequence(scope: Scope, providerId: string, quoteReference: string): number {
    const streamKey = hash({ scope, providerId, quoteReference });
    const row = this.db
      .prepare(
        "SELECT * FROM provider_receipts WHERE stream_key=? AND ordering_effect='active' ORDER BY sequence DESC LIMIT 1",
      )
      .get(streamKey);
    return row ? this.receipt(row).envelope.sequence + 1 : 1;
  }
  latestStreamRequest(
    scope: Scope,
    providerId: string,
    quoteReference: string,
  ): ProviderRequest | null {
    const row = this.db
      .prepare(
        'SELECT id FROM provider_requests WHERE scope=? AND provider_id=? AND quote_reference=? ORDER BY stream_position DESC LIMIT 1',
      )
      .get(scopeKey(scope), providerId, quoteReference);
    return row ? this.request(String(row.id)) : null;
  }
  activeStreamRequests(scope: Scope, providerId: string, quoteReference: string): string[] {
    const rows = this.db
      .prepare(
        "SELECT r.id FROM provider_requests r JOIN provider_job_heads h ON h.request_id=r.id WHERE r.scope=? AND h.status IN ('queued','in_flight','retry_wait','reconciliation_required')",
      )
      .all(scopeKey(scope));
    return rows
      .filter((row) => {
        const r = this.request(String(row.id))!;
        return r.adapter.providerId === providerId && r.selection.quoteReference === quoteReference;
      })
      .map((row) => String(row.id));
  }
  saveReceipt(
    requestId: string,
    receipt: ProviderReceipt,
    orderingEffect: 'active' | 'historical',
    replayKey?: string,
  ): void {
    if (replayKey) {
      const row = this.db
        .prepare('SELECT * FROM provider_nonces WHERE replay_key=?')
        .get(replayKey);
      if (
        row &&
        (row.request_id !== requestId || row.payload_hash !== receipt.envelope.source.payloadHash)
      )
        throw new KernelError(
          'PROVIDER_REPLAY_CONFLICT',
          'Authenticated nonce was already used for a different delivery',
          409,
        );
      if (!row)
        this.db
          .prepare('INSERT INTO provider_nonces VALUES(?,?,?)')
          .run(replayKey, requestId, receipt.envelope.source.payloadHash);
    }
    this.db
      .prepare('INSERT INTO provider_receipts VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
        receipt.eventKey,
        receipt.idempotencyKey,
        receipt.streamKey,
        receipt.envelope.sequence,
        requestId,
        canonicalJson(receipt),
        receipt.receiptHash,
        orderingEffect,
        hash({ requestId, receiptHash: receipt.receiptHash, orderingEffect }),
      );
  }
}

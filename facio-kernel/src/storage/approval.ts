import type { DatabaseSync } from 'node:sqlite';
import { approvalRecordSchema, type ApprovalRecord } from '../contracts/approval.js';
import type { Scope } from '../contracts/configuration.js';
import { canonicalJson, hash, KernelError } from '../domain/canonical.js';

const scopeKey = (scope: Scope) =>
  canonicalJson([scope.workspaceId, scope.tenantId, scope.environment, scope.operatingEntityId]);
const integrity = () =>
  new KernelError('INTEGRITY_ERROR', 'Independent review evidence failed its integrity check', 500);
function fixed(record: ApprovalRecord) {
  const {
    version: _,
    approvalHash: __,
    previousApprovalHash: ___,
    status: ____,
    action: _____,
    actorId: ______,
    correlationId: _______,
    occurredAt: ________,
    reason: _________,
    evidenceRefs: __________,
    ...identity
  } = record;
  return identity;
}
/** Same connection and transaction as Store. This repository never commits independently. */
export class ApprovalRepository {
  constructor(private readonly db: DatabaseSync) {}
  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS approval_heads(scope TEXT NOT NULL,id TEXT NOT NULL,record_id TEXT NOT NULL,record_version INTEGER NOT NULL,version INTEGER NOT NULL,approval_hash TEXT NOT NULL,PRIMARY KEY(scope,id),UNIQUE(scope,record_id,record_version));
      CREATE TABLE IF NOT EXISTS approval_revisions(scope TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,record_json TEXT NOT NULL,approval_hash TEXT NOT NULL,PRIMARY KEY(scope,id,version),FOREIGN KEY(scope,id) REFERENCES approval_heads(scope,id));
      CREATE TABLE IF NOT EXISTS approval_requests(scope TEXT NOT NULL,operation TEXT NOT NULL,key TEXT NOT NULL,request_hash TEXT NOT NULL,receipt_json TEXT NOT NULL,receipt_hash TEXT NOT NULL,PRIMARY KEY(scope,operation,key));
    `);
    for (const table of ['approval_revisions', 'approval_requests'])
      for (const action of ['UPDATE', 'DELETE'])
        this.db.exec(
          `CREATE TRIGGER IF NOT EXISTS ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'immutable independent review evidence'); END;`,
        );
  }
  private parse(raw: unknown, expectedHash: unknown, scope: Scope, id: string): ApprovalRecord {
    try {
      const value = approvalRecordSchema.parse(JSON.parse(String(raw)));
      const { approvalHash, ...content } = value;
      if (
        approvalHash !== expectedHash ||
        hash(content) !== approvalHash ||
        scopeKey(value.scope) !== scopeKey(scope) ||
        value.id !== id
      )
        throw integrity();
      return value;
    } catch {
      throw integrity();
    }
  }
  history(scope: Scope, id: string): ApprovalRecord[] {
    const head = this.db
      .prepare('SELECT * FROM approval_heads WHERE scope=? AND id=?')
      .get(scopeKey(scope), id);
    if (!head)
      throw new KernelError(
        'NOT_FOUND',
        'No independent review exists in this authorized scope',
        404,
      );
    const rows = this.db
      .prepare('SELECT * FROM approval_revisions WHERE scope=? AND id=? ORDER BY version')
      .all(scopeKey(scope), id);
    const result = rows.map((row) => this.parse(row.record_json, row.approval_hash, scope, id));
    if (
      !result.length ||
      result.length !== head.version ||
      result.at(-1)!.approvalHash !== head.approval_hash
    )
      throw integrity();
    for (const [index, record] of result.entries()) {
      const previous = result[index - 1];
      if (
        record.version !== index + 1 ||
        record.target.recordId !== head.record_id ||
        record.target.recordVersion !== head.record_version ||
        record.previousApprovalHash !== (previous?.approvalHash ?? null)
      )
        throw integrity();
      if (!previous) {
        if (
          record.status !== 'requested' ||
          record.action !== 'request' ||
          record.actorId !== record.requesterId ||
          record.requestedAt !== record.occurredAt
        )
          throw integrity();
      } else {
        if (
          hash(fixed(previous)) !== hash(fixed(record)) ||
          record.occurredAt < previous.occurredAt
        )
          throw integrity();
        if (record.action === 'approve' || record.action === 'decline') {
          if (
            previous.status !== 'requested' ||
            record.status !== (record.action === 'approve' ? 'approved' : 'declined') ||
            [record.requesterId, record.recordCreatorId, record.recordAuthorId].includes(
              record.actorId,
            )
          )
            throw integrity();
        } else if (record.action === 'revoke') {
          if (!['requested', 'approved'].includes(previous.status) || record.status !== 'revoked')
            throw integrity();
        } else throw integrity();
      }
    }
    return result;
  }
  read(scope: Scope, id: string): ApprovalRecord {
    return this.history(scope, id).at(-1)!;
  }
  forRecordVersion(scope: Scope, recordId: string, version: number): ApprovalRecord | null {
    const row = this.db
      .prepare('SELECT id FROM approval_heads WHERE scope=? AND record_id=? AND record_version=?')
      .get(scopeKey(scope), recordId, version);
    return row ? this.read(scope, String(row.id)) : null;
  }
  list(scope: Scope, recordId?: string): { approvals: ApprovalRecord[]; hasMore: boolean } {
    const rows = recordId
      ? this.db
          .prepare(
            'SELECT id FROM approval_heads WHERE scope=? AND record_id=? ORDER BY rowid DESC LIMIT 101',
          )
          .all(scopeKey(scope), recordId)
      : this.db
          .prepare('SELECT id FROM approval_heads WHERE scope=? ORDER BY rowid DESC LIMIT 101')
          .all(scopeKey(scope));
    return {
      approvals: rows.slice(0, 100).map((row) => this.read(scope, String(row.id))),
      hasMore: rows.length > 100,
    };
  }
  commit(record: ApprovalRecord, previousVersion: number | null): void {
    this.parse(canonicalJson(record), record.approvalHash, record.scope, record.id);
    if (previousVersion === null) {
      if (this.forRecordVersion(record.scope, record.target.recordId, record.target.recordVersion))
        throw new KernelError(
          'APPROVAL_EXISTS',
          'This exact insurance revision already has an independent review; inspect its history',
          409,
        );
      this.db
        .prepare('INSERT INTO approval_heads VALUES(?,?,?,?,?,?)')
        .run(
          scopeKey(record.scope),
          record.id,
          record.target.recordId,
          record.target.recordVersion,
          record.version,
          record.approvalHash,
        );
    } else {
      const updated = this.db
        .prepare(
          'UPDATE approval_heads SET version=?,approval_hash=? WHERE scope=? AND id=? AND version=?',
        )
        .run(
          record.version,
          record.approvalHash,
          scopeKey(record.scope),
          record.id,
          previousVersion,
        );
      if (updated.changes !== 1)
        throw new KernelError(
          'VERSION_CONFLICT',
          'The independent review changed; reload its current version',
          409,
        );
    }
    this.db
      .prepare('INSERT INTO approval_revisions VALUES(?,?,?,?,?)')
      .run(
        scopeKey(record.scope),
        record.id,
        record.version,
        canonicalJson(record),
        record.approvalHash,
      );
    this.history(record.scope, record.id);
  }
  replay(scope: Scope, operation: string, key: string, requestHash: string): string | null {
    const row = this.db
      .prepare('SELECT * FROM approval_requests WHERE scope=? AND operation=? AND key=?')
      .get(scopeKey(scope), operation, key);
    if (!row) return null;
    if (row.request_hash !== requestHash)
      throw new KernelError(
        'IDEMPOTENCY_CONFLICT',
        'This independent review request key belongs to different input or actor',
        409,
      );
    try {
      const receipt = JSON.parse(String(row.receipt_json)) as {
        approvalId: string;
        approvalVersion: number;
        approvalHash: string;
      };
      if (hash(receipt) !== row.receipt_hash) throw integrity();
      const record = this.history(scope, receipt.approvalId)[receipt.approvalVersion - 1];
      if (record?.approvalHash !== receipt.approvalHash) throw integrity();
      return receipt.approvalId;
    } catch {
      throw integrity();
    }
  }
  remember(
    scope: Scope,
    operation: string,
    key: string,
    requestHash: string,
    record: ApprovalRecord,
  ): void {
    const receipt = {
      approvalId: record.id,
      approvalVersion: record.version,
      approvalHash: record.approvalHash,
    };
    this.db
      .prepare('INSERT INTO approval_requests VALUES(?,?,?,?,?,?)')
      .run(scopeKey(scope), operation, key, requestHash, canonicalJson(receipt), hash(receipt));
  }
}

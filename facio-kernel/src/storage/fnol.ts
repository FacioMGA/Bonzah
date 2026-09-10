import type { DatabaseSync } from 'node:sqlite';
import type { Scope } from '../contracts/configuration.js';
import { fnolNoticeSchema, type FnolNotice } from '../contracts/fnol.js';
import { canonicalJson, hash, KernelError } from '../domain/canonical.js';
const key = (scope: Scope) =>
  canonicalJson([scope.workspaceId, scope.tenantId, scope.environment, scope.operatingEntityId]);
const integrity = () =>
  new KernelError('INTEGRITY_ERROR', 'Retained FNOL evidence failed its integrity check', 500);
export class FnolRepository {
  constructor(private readonly db: DatabaseSync) {
    db.function('facio_fnol_location_key', { deterministic: true }, (value) =>
      typeof value === 'string' ? value.trim().toLowerCase() : '',
    );
  }
  migrate() {
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS fnol_notices(scope TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,record_id TEXT NOT NULL,notice_json TEXT NOT NULL,notice_hash TEXT NOT NULL,PRIMARY KEY(scope,id,version));
  CREATE TABLE IF NOT EXISTS fnol_sources(scope TEXT NOT NULL,source_reference TEXT NOT NULL,notice_id TEXT NOT NULL,source_request_hash TEXT NOT NULL,receipt_hash TEXT NOT NULL,PRIMARY KEY(scope,source_reference));
  CREATE TABLE IF NOT EXISTS fnol_idempotency(scope TEXT NOT NULL,operation TEXT NOT NULL,key TEXT NOT NULL,request_hash TEXT NOT NULL,notice_id TEXT NOT NULL,version INTEGER NOT NULL,receipt_hash TEXT NOT NULL,PRIMARY KEY(scope,operation,key));`);
    for (const table of ['fnol_notices', 'fnol_sources', 'fnol_idempotency'])
      for (const action of ['UPDATE', 'DELETE'])
        this.db.exec(
          `CREATE TRIGGER IF NOT EXISTS ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'immutable FNOL evidence'); END;`,
        );
  }
  history(scope: Scope, id: string, version?: number): FnolNotice[] {
    const rows = this.db
      .prepare('SELECT * FROM fnol_notices WHERE scope=? AND id=? ORDER BY version')
      .all(key(scope), id);
    if (!rows.length)
      throw new KernelError('NOT_FOUND', 'No notice exists in this authorized scope', 404);
    try {
      const result: FnolNotice[] = [];
      for (const row of rows) {
        const notice = fnolNoticeSchema.parse(JSON.parse(String(row.notice_json))),
          previous = result.at(-1);
        const { noticeHash, ...content } = notice;
        const { recordHash, ...policyContent } = notice.policySnapshot;
        if (
          notice.id !== id ||
          key(notice.scope) !== key(scope) ||
          notice.version !== result.length + 1 ||
          notice.version !== row.version ||
          notice.policySnapshot.id !== row.record_id ||
          notice.noticeHash !== row.notice_hash ||
          hash(content) !== noticeHash ||
          notice.previousNoticeHash !== (previous?.noticeHash ?? null) ||
          hash(notice.policySnapshot) !== notice.policySnapshotHash ||
          hash(policyContent) !== recordHash ||
          key(notice.policySnapshot.scope) !== key(scope) ||
          hash(notice.destination) !== notice.destinationHash
        )
          throw integrity();
        if (!previous && notice.status !== 'draft') throw integrity();
        if (previous) {
          if (
            !['draft:draft', 'draft:submitted', 'submitted:acknowledged'].includes(
              `${previous.status}:${notice.status}`,
            )
          )
            throw integrity();
          for (const field of [
            'sourceReference',
            'sourceRequestHash',
            'policySnapshotHash',
            'destinationHash',
            'createdBy',
            'createdAt',
          ] as const)
            if (notice[field] !== previous[field]) throw integrity();
          if (
            previous.status === 'submitted' &&
            (hash(notice.details) !== hash(previous.details) ||
              hash(notice.duplicateReview) !== hash(previous.duplicateReview) ||
              hash(notice.possibleDuplicateIds) !== hash(previous.possibleDuplicateIds) ||
              notice.submittedAt !== previous.submittedAt)
          )
            throw integrity();
        }
        if (
          (notice.status === 'draft') !== (notice.submittedAt === null) ||
          (notice.status === 'acknowledged') !== !!notice.acknowledgement
        )
          throw integrity();
        if (
          notice.acknowledgement &&
          (notice.acknowledgement.destinationHash !== notice.destinationHash ||
            notice.acknowledgement.submittedNoticeHash !== previous?.noticeHash)
        )
          throw integrity();
        result.push(notice);
      }
      if (version !== undefined && !result[version - 1]) throw integrity();
      return version === undefined ? result : result.slice(0, version);
    } catch {
      throw integrity();
    }
  }
  read(scope: Scope, id: string, version?: number) {
    return this.history(scope, id, version).at(-1)!;
  }
  append(notice: FnolNotice) {
    const value = fnolNoticeSchema.parse(notice);
    this.db
      .prepare('INSERT INTO fnol_notices VALUES(?,?,?,?,?,?)')
      .run(
        key(value.scope),
        value.id,
        value.version,
        value.policySnapshot.id,
        canonicalJson(value),
        value.noticeHash,
      );
  }
  list(scope: Scope, recordId: string, limit = 50) {
    const rows = this.db
      .prepare(
        'SELECT id,MAX(version) AS version FROM fnol_notices WHERE scope=? AND record_id=? GROUP BY id ORDER BY MAX(rowid) DESC LIMIT ?',
      )
      .all(key(scope), recordId, limit + 1);
    return {
      notices: rows.slice(0, limit).map((row) => this.read(scope, String(row.id))),
      hasMore: rows.length > limit,
    };
  }
  related(scope: Scope, recordId: string, noticeId: string, lossDate: string, location: string) {
    const rows = this.db
      .prepare(
        `SELECT n.id FROM fnol_notices n WHERE n.scope=? AND n.record_id=? AND n.id<>? AND n.version=(SELECT MAX(v.version) FROM fnol_notices v WHERE v.scope=n.scope AND v.id=n.id) AND substr(json_extract(n.notice_json,'$.details.loss.occurredAt'),1,10)=? AND facio_fnol_location_key(json_extract(n.notice_json,'$.details.loss.location'))=? ORDER BY n.rowid DESC LIMIT 100`,
      )
      .all(key(scope), recordId, noticeId, lossDate, location.trim().toLowerCase());
    return rows.map((row) => this.read(scope, String(row.id)).id);
  }
  source(scope: Scope, sourceReference: string) {
    const row = this.db
      .prepare('SELECT * FROM fnol_sources WHERE scope=? AND source_reference=?')
      .get(key(scope), sourceReference);
    if (!row) return null;
    const receipt = {
      scope: key(scope),
      sourceReference,
      noticeId: String(row.notice_id),
      sourceRequestHash: String(row.source_request_hash),
    };
    const notice = this.read(scope, receipt.noticeId);
    if (
      hash(receipt) !== row.receipt_hash ||
      notice.sourceReference !== sourceReference ||
      notice.sourceRequestHash !== receipt.sourceRequestHash
    )
      throw integrity();
    return notice;
  }
  registerSource(notice: FnolNotice) {
    const receipt = {
      scope: key(notice.scope),
      sourceReference: notice.sourceReference,
      noticeId: notice.id,
      sourceRequestHash: notice.sourceRequestHash,
    };
    this.db
      .prepare('INSERT INTO fnol_sources VALUES(?,?,?,?,?)')
      .run(
        receipt.scope,
        receipt.sourceReference,
        receipt.noticeId,
        receipt.sourceRequestHash,
        hash(receipt),
      );
  }
  replay(scope: Scope, operation: string, requestKey: string, requestHash: string) {
    const row = this.db
      .prepare('SELECT * FROM fnol_idempotency WHERE scope=? AND operation=? AND key=?')
      .get(key(scope), operation, requestKey);
    if (!row) return null;
    const receipt = {
      scope: key(scope),
      operation,
      requestKey,
      requestHash: String(row.request_hash),
      noticeId: String(row.notice_id),
      version: Number(row.version),
    };
    if (hash(receipt) !== row.receipt_hash) throw integrity();
    if (requestHash !== receipt.requestHash)
      throw new KernelError(
        'IDEMPOTENCY_CONFLICT',
        'This request identity already belongs to different FNOL facts or actor',
        409,
      );
    this.read(scope, receipt.noticeId, receipt.version);
    return { noticeId: receipt.noticeId, version: receipt.version };
  }
  remember(
    scope: Scope,
    operation: string,
    requestKey: string,
    requestHash: string,
    notice: FnolNotice,
  ) {
    const receipt = {
      scope: key(scope),
      operation,
      requestKey,
      requestHash,
      noticeId: notice.id,
      version: notice.version,
    };
    this.db
      .prepare('INSERT INTO fnol_idempotency VALUES(?,?,?,?,?,?,?)')
      .run(
        receipt.scope,
        operation,
        requestKey,
        requestHash,
        notice.id,
        notice.version,
        hash(receipt),
      );
  }
}

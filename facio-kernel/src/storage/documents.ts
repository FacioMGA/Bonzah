import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import type { Scope } from '../contracts/configuration.js';
import {
  documentRequestSchema,
  documentStateSchema,
  documentArtifactSchema,
  type DocumentRequest,
  type DocumentState,
  type DocumentArtifact,
} from '../contracts/documents.js';
import { canonicalJson, hash, KernelError } from '../domain/canonical.js';

const key = (scope: Scope) =>
  canonicalJson([scope.workspaceId, scope.tenantId, scope.environment, scope.operatingEntityId]);
const integrity = () =>
  new KernelError('INTEGRITY_ERROR', 'Retained document evidence failed its integrity check', 500);
export const documentBytesHash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
/** Same Store connection and transaction; this repository never commits independently. */
export class DocumentRepository {
  constructor(private readonly db: DatabaseSync) {}
  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS document_requests(scope TEXT NOT NULL,id TEXT NOT NULL,record_id TEXT NOT NULL,record_version INTEGER NOT NULL,pack_id TEXT NOT NULL,pack_version TEXT NOT NULL,request_json TEXT NOT NULL,request_hash TEXT NOT NULL,PRIMARY KEY(scope,id),UNIQUE(scope,record_id,record_version,pack_id,pack_version));
      CREATE TABLE IF NOT EXISTS document_states(scope TEXT NOT NULL,job_id TEXT NOT NULL,version INTEGER NOT NULL,state_json TEXT NOT NULL,state_hash TEXT NOT NULL,PRIMARY KEY(scope,job_id,version),FOREIGN KEY(scope,job_id) REFERENCES document_requests(scope,id));
      CREATE TABLE IF NOT EXISTS document_artifacts(scope TEXT NOT NULL,id TEXT NOT NULL,job_id TEXT NOT NULL,template_id TEXT NOT NULL,format TEXT NOT NULL,metadata_json TEXT NOT NULL,metadata_hash TEXT NOT NULL,content BLOB NOT NULL,PRIMARY KEY(scope,id),UNIQUE(scope,job_id,template_id,format),FOREIGN KEY(scope,job_id) REFERENCES document_requests(scope,id));
      CREATE TABLE IF NOT EXISTS document_idempotency(scope TEXT NOT NULL,operation TEXT NOT NULL,key TEXT NOT NULL,request_hash TEXT NOT NULL,job_id TEXT NOT NULL,receipt_hash TEXT NOT NULL,PRIMARY KEY(scope,operation,key),FOREIGN KEY(scope,job_id) REFERENCES document_requests(scope,id));
    `);
    for (const table of [
      'document_requests',
      'document_states',
      'document_artifacts',
      'document_idempotency',
    ])
      for (const action of ['UPDATE', 'DELETE'])
        this.db.exec(
          `CREATE TRIGGER IF NOT EXISTS ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'immutable document evidence'); END;`,
        );
  }
  request(scope: Scope, id: string): DocumentRequest {
    const row = this.db
      .prepare('SELECT * FROM document_requests WHERE scope=? AND id=?')
      .get(key(scope), id);
    if (!row)
      throw new KernelError(
        'NOT_FOUND',
        'No document request exists in this authorized scope',
        404,
      );
    try {
      const request = documentRequestSchema.parse(JSON.parse(String(row.request_json)));
      const { requestHash, ...content } = request;
      const { recordHash, ...recordContent } = request.snapshot.record;
      if (
        hash(content) !== requestHash ||
        requestHash !== row.request_hash ||
        key(request.scope) !== key(scope) ||
        request.id !== id ||
        request.recordId !== row.record_id ||
        request.recordVersion !== row.record_version ||
        request.pack.id !== row.pack_id ||
        request.pack.version !== row.pack_version ||
        hash(request.pack) !== request.packHash ||
        hash(request.snapshot) !== request.snapshotHash ||
        (request.snapshot.record.decision
          ? !request.snapshot.definition ||
            hash(request.snapshot.definition) !==
              request.snapshot.record.decision.evaluation.definitionHash
          : request.snapshot.definition !== null) ||
        key(request.snapshot.record.scope) !== key(scope) ||
        request.snapshot.record.id !== request.recordId ||
        request.snapshot.record.version !== request.recordVersion ||
        recordHash !== request.recordHash ||
        hash(recordContent) !== recordHash ||
        key(request.snapshot.event.scope) !== key(scope) ||
        request.snapshot.event.recordId !== request.recordId ||
        request.snapshot.event.version !== request.recordVersion ||
        request.snapshot.event.recordHash !== recordHash
      )
        throw integrity();
      return request;
    } catch {
      throw integrity();
    }
  }
  history(scope: Scope, id: string): DocumentState[] {
    this.request(scope, id);
    const rows = this.db
      .prepare('SELECT * FROM document_states WHERE scope=? AND job_id=? ORDER BY version')
      .all(key(scope), id);
    try {
      const states: DocumentState[] = [];
      for (const row of rows) {
        const state = documentStateSchema.parse(JSON.parse(String(row.state_json)));
        const { stateHash, ...content } = state;
        const previous = states.at(-1);
        if (
          state.jobId !== id ||
          state.version !== states.length + 1 ||
          row.version !== state.version ||
          stateHash !== row.state_hash ||
          hash(content) !== stateHash ||
          state.previousStateHash !== (previous?.stateHash ?? null)
        )
          throw integrity();
        const transition = previous ? `${previous.status}:${state.status}` : `new:${state.status}`;
        if (
          ![
            'new:queued',
            'queued:rendering',
            'rendering:completed',
            'rendering:failed',
            'failed:queued',
            'rendering:queued',
          ].includes(transition)
        )
          throw integrity();
        if (
          state.attempts !== (previous?.attempts ?? 0) + (state.status === 'rendering' ? 1 : 0) ||
          (state.status === 'rendering') !== !!state.claim ||
          (state.status === 'failed') !== !!state.failureCode
        )
          throw integrity();
        states.push(state);
      }
      if (!states.length) throw integrity();
      return states;
    } catch {
      throw integrity();
    }
  }
  state(scope: Scope, id: string) {
    return this.history(scope, id).at(-1)!;
  }
  create(request: DocumentRequest, state: DocumentState) {
    this.db
      .prepare('INSERT INTO document_requests VALUES(?,?,?,?,?,?,?,?)')
      .run(
        key(request.scope),
        request.id,
        request.recordId,
        request.recordVersion,
        request.pack.id,
        request.pack.version,
        canonicalJson(request),
        request.requestHash,
      );
    this.append(request.scope, state);
  }
  append(scope: Scope, state: DocumentState) {
    this.db
      .prepare('INSERT INTO document_states VALUES(?,?,?,?,?)')
      .run(key(scope), state.jobId, state.version, canonicalJson(state), state.stateHash);
    this.history(scope, state.jobId);
  }
  existing(
    scope: Scope,
    recordId: string,
    recordVersion: number,
    packId: string,
    packVersion: string,
  ) {
    const row = this.db
      .prepare(
        'SELECT id FROM document_requests WHERE scope=? AND record_id=? AND record_version=? AND pack_id=? AND pack_version=?',
      )
      .get(key(scope), recordId, recordVersion, packId, packVersion);
    return row ? this.request(scope, String(row.id)) : null;
  }
  list(scope: Scope, recordId: string) {
    const rows = this.db
      .prepare(
        'SELECT id FROM document_requests WHERE scope=? AND record_id=? ORDER BY rowid DESC LIMIT 51',
      )
      .all(key(scope), recordId);
    return {
      requests: rows.slice(0, 50).map((row) => this.request(scope, String(row.id))),
      hasMore: rows.length > 50,
    };
  }
  nextQueued() {
    const rows = this.db
      .prepare(
        `SELECT r.scope,r.id FROM document_requests r JOIN document_states s ON s.scope=r.scope AND s.job_id=r.id WHERE s.version=(SELECT MAX(version) FROM document_states WHERE scope=r.scope AND job_id=r.id) AND json_extract(s.state_json,'$.status')='queued' ORDER BY r.rowid LIMIT 1`,
      )
      .all();
    const row = rows[0];
    if (!row) return null;
    const [workspaceId, tenantId, environment, operatingEntityId] = JSON.parse(String(row.scope));
    return this.request({ workspaceId, tenantId, environment, operatingEntityId }, String(row.id));
  }
  artifacts(scope: Scope, jobId: string) {
    this.request(scope, jobId);
    return this.db
      .prepare(
        'SELECT id FROM document_artifacts WHERE scope=? AND job_id=? ORDER BY template_id,format',
      )
      .all(key(scope), jobId)
      .map((row) => this.content(scope, String(row.id)).artifact);
  }
  content(scope: Scope, id: string) {
    const row = this.db
      .prepare('SELECT * FROM document_artifacts WHERE scope=? AND id=?')
      .get(key(scope), id);
    if (!row)
      throw new KernelError(
        'NOT_FOUND',
        'No document artifact exists in this authorized scope',
        404,
      );
    try {
      const artifact = documentArtifactSchema.parse(JSON.parse(String(row.metadata_json)));
      const request = this.request(scope, String(row.job_id));
      const template = request.pack.templates.find((item) => item.id === artifact.templateId);
      const bytes = Buffer.from(row.content as Uint8Array);
      if (
        artifact.id !== id ||
        hash(artifact) !== row.metadata_hash ||
        artifact.jobId !== request.id ||
        artifact.templateId !== row.template_id ||
        artifact.format !== row.format ||
        !template ||
        artifact.templateVersion !== template.version ||
        artifact.documentVersion !== request.recordVersion ||
        artifact.recordHash !== request.recordHash ||
        artifact.snapshotHash !== request.snapshotHash ||
        artifact.packHash !== request.packHash ||
        artifact.byteLength !== bytes.byteLength ||
        artifact.contentHash !== documentBytesHash(bytes) ||
        artifact.mimeType !== (artifact.format === 'pdf' ? 'application/pdf' : 'text/html')
      )
        throw integrity();
      return { artifact, bytes };
    } catch {
      throw integrity();
    }
  }
  saveArtifact(scope: Scope, artifact: DocumentArtifact, bytes: Uint8Array) {
    this.db
      .prepare('INSERT INTO document_artifacts VALUES(?,?,?,?,?,?,?,?)')
      .run(
        key(scope),
        artifact.id,
        artifact.jobId,
        artifact.templateId,
        artifact.format,
        canonicalJson(artifact),
        hash(artifact),
        bytes,
      );
    this.content(scope, artifact.id);
  }
  replay(scope: Scope, operation: string, requestKey: string, requestHash: string) {
    const row = this.db
      .prepare(
        'SELECT request_hash,job_id,receipt_hash FROM document_idempotency WHERE scope=? AND operation=? AND key=?',
      )
      .get(key(scope), operation, requestKey);
    if (!row) return null;
    if (row.request_hash !== requestHash)
      throw new KernelError(
        'IDEMPOTENCY_CONFLICT',
        'Document request key belongs to different input or actor',
        409,
      );
    if (
      row.receipt_hash !==
      hash({ scope: key(scope), operation, requestKey, requestHash, jobId: row.job_id })
    )
      throw integrity();
    return this.request(scope, String(row.job_id)).id;
  }
  remember(
    scope: Scope,
    operation: string,
    requestKey: string,
    requestHash: string,
    jobId: string,
  ) {
    this.db
      .prepare('INSERT INTO document_idempotency VALUES(?,?,?,?,?,?)')
      .run(
        key(scope),
        operation,
        requestKey,
        requestHash,
        jobId,
        hash({ scope: key(scope), operation, requestKey, requestHash, jobId }),
      );
  }
}

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { assertSupportedSchema } from './schema-version.js';

export const secret = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** A separate durable auth database: raw browser, bearer and refresh tokens are never stored. */
export class AuthStore {
  private readonly db: DatabaseSync;
  constructor(
    path: string,
    private readonly now = () => Date.now(),
  ) {
    this.db = new DatabaseSync(path);
    try {
      assertSupportedSchema(this.db, 'auth_schema_migrations', 1);
    } catch (error) {
      this.db.close();
      throw error;
    }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS auth_schema_migrations(version INTEGER PRIMARY KEY);
      INSERT OR IGNORE INTO auth_schema_migrations VALUES(1);
      CREATE TABLE IF NOT EXISTS auth_entries (
        kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, expires_at INTEGER NOT NULL,
        consumed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS auth_grants (
        id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, client_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS auth_grants_actor ON auth_grants(actor_id);`);
  }
  close() {
    this.db.close();
  }
  prune() {
    this.db.prepare('DELETE FROM auth_entries WHERE expires_at<?').run(this.now());
  }
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  put(kind: string, key: string, body: unknown, ttlMs: number) {
    this.db
      .prepare('INSERT INTO auth_entries(kind,id,body,expires_at) VALUES(?,?,?,?)')
      .run(kind, digest(key), JSON.stringify(body), this.now() + ttlMs);
  }
  read<T>(kind: string, key: string, includeConsumed = false): T | undefined {
    const row = this.db
      .prepare('SELECT body,consumed FROM auth_entries WHERE kind=? AND id=? AND expires_at>?')
      .get(kind, digest(key), this.now()) as { body: string; consumed: number } | undefined;
    return row && (includeConsumed || !row.consumed) ? (JSON.parse(row.body) as T) : undefined;
  }
  consume(kind: string, key: string): boolean {
    return (
      this.db
        .prepare(
          'UPDATE auth_entries SET consumed=1 WHERE kind=? AND id=? AND consumed=0 AND expires_at>?',
        )
        .run(kind, digest(key), this.now()).changes === 1
    );
  }
  grant(actorId: string, clientId: string, ttlMs: number): string {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO auth_grants(id,actor_id,client_id,expires_at) VALUES(?,?,?,?)')
      .run(id, actorId, clientId, this.now() + ttlMs);
    return id;
  }
  validGrant(id: string): boolean {
    return !!this.db
      .prepare('SELECT id FROM auth_grants WHERE id=? AND revoked=0 AND expires_at>?')
      .get(id, this.now());
  }
  revokeGrant(id: string) {
    this.db.prepare('UPDATE auth_grants SET revoked=1 WHERE id=?').run(id);
  }
  revokeActor(actorId: string) {
    this.db.prepare('UPDATE auth_grants SET revoked=1 WHERE actor_id=?').run(actorId);
  }
  connections(actorId: string) {
    return this.db
      .prepare(
        'SELECT id,client_id AS clientId,expires_at AS expiresAt FROM auth_grants WHERE actor_id=? AND revoked=0 AND expires_at>?',
      )
      .all(actorId, this.now());
  }
}

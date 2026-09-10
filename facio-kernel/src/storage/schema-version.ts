import type { DatabaseSync } from 'node:sqlite';
import { KernelError } from '../domain/canonical.js';

/** Read-only preflight: run before changing journal mode, applying migrations or writing data. */
export function assertSupportedSchema(
  db: DatabaseSync,
  table: 'schema_migrations' | 'auth_schema_migrations',
  supportedVersion: number,
): void {
  const marker = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
  if (!marker) return;
  const latest = db.prepare(`SELECT MAX(version) AS version FROM ${table}`).get()?.version;
  if (latest === null || latest === undefined) return;
  if (typeof latest !== 'number' || !Number.isSafeInteger(latest) || latest < 1)
    throw new KernelError(
      'STORAGE_SCHEMA_INVALID',
      'The database schema version marker is invalid',
      500,
    );
  if (latest > supportedVersion)
    throw new KernelError(
      'STORAGE_SCHEMA_TOO_NEW',
      `Database ${table} version ${latest} exceeds this image's supported version ${supportedVersion}; start a compatible image`,
      500,
    );
}

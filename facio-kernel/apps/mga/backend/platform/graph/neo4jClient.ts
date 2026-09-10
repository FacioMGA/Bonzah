/**
 * neo4jClient.ts — singleton Neo4j driver (ADR-0041).
 *
 * THIS IS THE ONLY FILE IN THE REPO ALLOWED TO IMPORT `neo4j-driver`.
 * Enforced by `tools/quality/check-neo4j-driver-only-in-platform-graph.mjs`.
 *
 * The driver is lazily instantiated on first use.  Connection details are
 * pulled from environment variables; if `NEO4J_URI` is unset (e.g. local
 * dev without Neo4j) the client returns a "disabled" handle whose
 * `withSession` method short-circuits with a `{ ok: false, reason:
 * 'neo4j_disabled' }` result — callers never have to check for the
 * driver themselves.
 *
 * The wider system treats Neo4j as off-the-critical-path enrichment
 * (ADR-0041 §2): the Claim Workspace + V1 MCP tools NEVER call this
 * module synchronously.  The async refresh worker is the only consumer.
 *
 * AuraDB connection (preferred per ADR-0041 §9):
 *   NEO4J_URI=neo4j+s://<dbid>.databases.neo4j.io
 *   NEO4J_USER=neo4j
 *   NEO4J_PASSWORD=<value-from-Key-Vault>
 *
 * In-cluster StatefulSet (dev/demo fallback):
 *   NEO4J_URI=bolt://neo4j.org2vec.svc.cluster.local:7687
 */

import neo4j, { type Driver, type Session } from 'neo4j-driver';
import { logger } from '../utils/logger.js';

export type GraphOperationResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'neo4j_disabled' | 'neo4j_unavailable' | 'cypher_error'; message?: string };

interface Neo4jConfig {
  uri: string;
  user: string;
  password: string;
  database?: string;
  connectionTimeoutMs: number;
  maxConnectionPoolSize: number;
}

function readConfig(): Neo4jConfig | null {
  const uri = String(process.env.NEO4J_URI || '').trim();
  if (!uri) return null;
  const user = String(process.env.NEO4J_USER || 'neo4j').trim();
  const password = String(process.env.NEO4J_PASSWORD || '').trim();
  if (!password) {
    logger.warn({ event: 'neo4j.config.missing_password' }, 'NEO4J_URI set but NEO4J_PASSWORD is empty; Neo4j client disabled.');
    return null;
  }
  return {
    uri,
    user,
    password,
    database: String(process.env.NEO4J_DATABASE || '').trim() || undefined,
    connectionTimeoutMs: Number(process.env.NEO4J_CONNECTION_TIMEOUT_MS || 5000),
    maxConnectionPoolSize: Number(process.env.NEO4J_MAX_POOL || 50),
  };
}

let driverPromise: Promise<Driver | null> | null = null;

async function getDriver(): Promise<Driver | null> {
  if (driverPromise) return driverPromise;
  driverPromise = (async () => {
    const config = readConfig();
    if (!config) return null;
    try {
      const driver = neo4j.driver(
        config.uri,
        neo4j.auth.basic(config.user, config.password),
        {
          connectionTimeout: config.connectionTimeoutMs,
          maxConnectionPoolSize: config.maxConnectionPoolSize,
          logging: {
            level: 'warn',
            logger: (level, message) => {
              if (level === 'error' || level === 'warn') {
                logger.warn({ event: 'neo4j.driver', level, message }, 'neo4j.driver');
              }
            },
          },
        },
      );
      await driver.verifyConnectivity();
      logger.info({ event: 'neo4j.client.connected', uri: config.uri }, 'neo4j.client.connected');
      return driver;
    } catch (err) {
      logger.warn({ event: 'neo4j.client.connect_failed', err: err instanceof Error ? err.message : String(err) }, 'neo4j.client.connect_failed');
      driverPromise = null; // allow retry next call
      return null;
    }
  })();
  return driverPromise;
}

/**
 * Acquire a Neo4j session, run `fn`, and always close the session.
 * Returns a discriminated-union result so callers can degrade gracefully
 * when Neo4j is disabled or unreachable.
 *
 * The session is configured for the configured `NEO4J_DATABASE` (defaults
 * to the driver default).
 */
export async function withSession<T>(fn: (session: Session) => Promise<T>): Promise<GraphOperationResult<T>> {
  const driver = await getDriver();
  if (!driver) return { ok: false, reason: 'neo4j_disabled' };
  let session: Session | null = null;
  try {
    session = driver.session({ database: process.env.NEO4J_DATABASE || undefined });
    const data = await fn(session);
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ event: 'neo4j.session.failed', message }, 'neo4j.session.failed');
    if (message.includes('ServiceUnavailable') || message.includes('connect') || message.includes('ECONNREFUSED')) {
      return { ok: false, reason: 'neo4j_unavailable', message };
    }
    return { ok: false, reason: 'cypher_error', message };
  } finally {
    if (session) await session.close();
  }
}

/** True when a working driver is configured; convenience for health probes. */
export async function isGraphEnabled(): Promise<boolean> {
  const driver = await getDriver();
  return Boolean(driver);
}

/** Shut down the driver (used in tests + graceful shutdown). */
export async function closeNeo4j(): Promise<void> {
  if (!driverPromise) return;
  const driver = await driverPromise;
  driverPromise = null;
  if (driver) await driver.close();
}

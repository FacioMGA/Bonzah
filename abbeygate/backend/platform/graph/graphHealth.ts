/**
 * graphHealth.ts — non-blocking health probe for the Neo4j enrichment
 * layer (ADR-0041).
 *
 * Surfaced via the `/healthz` endpoint as an OPTIONAL component health
 * field (an unhealthy graph does NOT fail the API liveness check —
 * Claim Workspace + V1 MCP tools never read Neo4j synchronously).
 */

import { isGraphEnabled, withSession } from './neo4jClient.js';

export interface GraphHealthSnapshot {
  enabled: boolean;
  reachable: boolean;
  latencyMs: number | null;
  reason?: string;
}

export async function probeGraphHealth(): Promise<GraphHealthSnapshot> {
  const enabled = await isGraphEnabled();
  if (!enabled) {
    return { enabled: false, reachable: false, latencyMs: null, reason: 'driver_disabled' };
  }
  const start = Date.now();
  const result = await withSession(async (session) => {
    await session.run('RETURN 1 AS ping');
  });
  const latencyMs = Date.now() - start;
  if (!result.ok) {
    return { enabled: true, reachable: false, latencyMs: null, reason: result.reason };
  }
  return { enabled: true, reachable: true, latencyMs };
}

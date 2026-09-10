import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const queueSource = readFileSync(path.join(ROOT, 'platform/events/queue.ts'), 'utf8');
const workerSource = readFileSync(path.join(ROOT, 'worker.ts'), 'utf8');
const connectionSource = readFileSync(path.join(ROOT, 'platform/db/connection.ts'), 'utf8');

function requiredDefault(source: string, pattern: RegExp, name: string): number {
  const match = source.match(pattern);
  expect(match, `${name} must declare an explicit numeric default`).not.toBeNull();
  return Number(match?.[1]);
}

describe('worker concurrency connection-pool budget', () => {
  it('leaves the unset worker entrypoint concurrency for the queue to derive', () => {
    expect(workerSource).not.toContain("process.env.WORKER_CONCURRENCY =");
    expect(workerSource).toContain('auto-from-effective-pool');
  });

  it('derives and validates capacity against the effective URL pool limit', () => {
    const connectionLimit = requiredDefault(
      connectionSource,
      /PRISMA_CONNECTION_LIMIT\)\s*\|\|\s*(\d+)/,
      'connection.ts PRISMA_CONNECTION_LIMIT',
    );

    expect(connectionLimit).toBe(10);
    expect(connectionSource).toContain('EFFECTIVE_PRISMA_CONNECTION_LIMIT');
    expect(queueSource).toContain('(EFFECTIVE_PRISMA_CONNECTION_LIMIT - 1)');
    expect(queueSource).toContain('activeConcurrency >= EFFECTIVE_PRISMA_CONNECTION_LIMIT');
  });

  it('awaits system outbox writes inside the operating-tenant scope', () => {
    expect(queueSource).toContain('runWithOperatingTenant(buildTenantConfigFromEnv(), write)');
    expect(queueSource).toContain('await tenantScopedPrisma.outbox.create({');
  });

  it('schedules issued-pack recovery for every active production tenant', () => {
    expect(queueSource).toContain("where: { kind: 'PRODUCTION', status: 'ACTIVE' }");
    expect(queueSource).toContain('runWithOperatingTenantById(operatingTenantId, write)');
    expect(queueSource).toContain('operatingTenantId: tenant.id');
    expect(queueSource).toContain('enqueueIssuedPackReconcileForActiveProductionTenants({');
  });
});

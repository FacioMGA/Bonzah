/**
 * Behavior Layer schema contract — smoke test.
 *
 * Verifies, against the real dev database, that:
 *  1. We can write a `BehaviorEvent` row including a 1536-dim pgvector and
 *     `deltaMsFromPreviousEvent` BigInt, and read it back losslessly.
 *  2. We can write a `PolicyTrajectory` row including a 1536-dim pgvector and
 *     the per-row window-size metadata (50/20 defaults), and read it back.
 *  3. The `<=>` cosine-distance operator works on the new `vector(1536)`
 *     columns end-to-end (so the API's similarity SQL has a real foundation).
 *
 * Manifesto reason: schema is the contract that keeps Prisma, raw SQL, and
 * workers honest. This test is the "is the contract real?" gate before any
 * logic is built on top.
 *
 * Gated by INTEGRATION_TESTS=true so it does not run in unit-test mode.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RUN_INTEGRATION = String(process.env.INTEGRATION_TESTS || '').toLowerCase() === 'true';

describe.runIf(RUN_INTEGRATION)('Behavior Layer schema (smoke / integration)', () => {
  type PrismaClient = typeof import('../../db/connection.js').prisma;
  let prisma: PrismaClient;

  let tenantId: string;
  let policyId: string;

  const createdBehaviorEventIds: string[] = [];
  const createdPolicyTrajectoryIds: string[] = [];

  function unitVector(seed: number, dim = 1536): number[] {
    // tiny deterministic generator — sin-based, then L2-normalize.
    const v: number[] = [];
    let sumSq = 0;
    for (let i = 0; i < dim; i++) {
      const x = Math.sin((i + 1) * (seed + 1) * 0.0173);
      v.push(x);
      sumSq += x * x;
    }
    const norm = Math.sqrt(sumSq) || 1;
    return v.map((x) => x / norm);
  }

  function toPgVectorLiteral(vec: number[]): string {
    // pgvector accepts the textual form '[v1,v2,...]'.
    return `[${vec.join(',')}]`;
  }

  beforeAll(async () => {
    ({ prisma } = await import('../../db/connection.js'));

    const tenant = await prisma.tenant.findFirst({ select: { id: true } });
    if (!tenant) throw new Error('Smoke test requires at least one tenant in the dev DB.');
    tenantId = tenant.id;

    const policy = await prisma.policy.findFirst({ select: { id: true } });
    if (!policy) throw new Error('Smoke test requires at least one policy in the dev DB.');
    policyId = policy.id;
  });

  afterAll(async () => {
    for (const id of createdBehaviorEventIds) {
      await prisma.behaviorEvent.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdPolicyTrajectoryIds) {
      await prisma.policyTrajectory.delete({ where: { policyId: id } }).catch(() => undefined);
    }
  });

  it('round-trips a BehaviorEvent with vector(1536) embedding and BigInt delta', async () => {
    const sourceEventId = `smoke-be-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const occurredAt = new Date('2026-04-26T10:00:00.000Z');
    const delta = 12345678901n; // BigInt > 2^31 to prove it's not silently coerced to int

    const created = await prisma.behaviorEvent.create({
      data: {
        operatingTenantId: tenantId,
        entityType: 'POLICY',
        entityId: policyId,
        behaviorType: 'policy.smoke_test',
        canonicalText: 'Smoke test behavior event for schema round-trip.',
        occurredAt,
        deltaMsFromPreviousEvent: delta,
        sourceEventId,
        payload: { ok: true, n: 42 },
      },
    });
    createdBehaviorEventIds.push(created.id);

    const vec = unitVector(7);
    await prisma.$executeRawUnsafe(
      `UPDATE "behavior_events" SET "embedding" = $1::vector WHERE "id" = $2`,
      toPgVectorLiteral(vec),
      created.id,
    );

    const round = await prisma.behaviorEvent.findUnique({ where: { id: created.id } });
    expect(round).toBeTruthy();
    expect(round!.entityType).toBe('POLICY');
    expect(round!.behaviorType).toBe('policy.smoke_test');
    expect(round!.sourceEventId).toBe(sourceEventId);
    expect(round!.occurredAt.toISOString()).toBe(occurredAt.toISOString());

    expect(typeof round!.deltaMsFromPreviousEvent).toBe('bigint');
    expect(round!.deltaMsFromPreviousEvent).toBe(delta);

    type EmbeddingRow = { embedding: string | null };
    const rawRows = await prisma.$queryRawUnsafe<EmbeddingRow[]>(
      `SELECT "embedding"::text AS embedding FROM "behavior_events" WHERE "id" = $1`,
      created.id,
    );
    expect(rawRows).toHaveLength(1);
    const stored = rawRows[0].embedding;
    expect(stored).toBeTypeOf('string');
    const parsed = JSON.parse(stored as string) as number[];
    expect(parsed).toHaveLength(1536);
    for (let i = 0; i < 1536; i++) {
      expect(parsed[i]).toBeCloseTo(vec[i], 5);
    }
  });

  it('enforces sourceEventId uniqueness', async () => {
    const sourceEventId = `smoke-be-dup-${Date.now()}`;
    const first = await prisma.behaviorEvent.create({
      data: {
        operatingTenantId: tenantId,
        entityType: 'POLICY',
        entityId: policyId,
        behaviorType: 'policy.smoke_test_dup',
        canonicalText: 'first',
        occurredAt: new Date(),
        sourceEventId,
      },
    });
    createdBehaviorEventIds.push(first.id);

    await expect(
      prisma.behaviorEvent.create({
        data: {
          operatingTenantId: tenantId,
          entityType: 'POLICY',
          entityId: policyId,
          behaviorType: 'policy.smoke_test_dup',
          canonicalText: 'second',
          occurredAt: new Date(),
          sourceEventId,
        },
      }),
    ).rejects.toThrow();
  });

  it('round-trips a PolicyTrajectory with vector(1536) and window-size defaults', async () => {
    const vec = unitVector(11);

    const created = await prisma.policyTrajectory.upsert({
      where: { policyId },
      create: {
        policyId,
        operatingTenantId: tenantId,
        eventCount: 3,
        lastEventAt: new Date('2026-04-26T11:00:00.000Z'),
        lastBehaviorTypes: ['policy.payment_failed', 'policy.comm_info_required', 'policy.payment_failed'],
        direction: 'DRIFT_TO_CANCELLATION',
        driftScore: '0.42',
      },
      update: {
        eventCount: 3,
        lastEventAt: new Date('2026-04-26T11:00:00.000Z'),
        lastBehaviorTypes: ['policy.payment_failed', 'policy.comm_info_required', 'policy.payment_failed'],
        direction: 'DRIFT_TO_CANCELLATION',
        driftScore: '0.42',
      },
    });
    createdPolicyTrajectoryIds.push(created.policyId);

    expect(created.trajectoryWindowSize).toBe(50);
    expect(created.directionWindowSize).toBe(20);
    expect(created.direction).toBe('DRIFT_TO_CANCELLATION');

    await prisma.$executeRawUnsafe(
      `UPDATE "policy_trajectories" SET "trajectoryEmbedding" = $1::vector WHERE "policyId" = $2`,
      toPgVectorLiteral(vec),
      policyId,
    );

    const round = await prisma.policyTrajectory.findUnique({ where: { policyId } });
    expect(round).toBeTruthy();
    expect(round!.eventCount).toBe(3);
    expect(round!.trajectoryWindowSize).toBe(50);
    expect(round!.directionWindowSize).toBe(20);
    expect(Array.isArray(round!.lastBehaviorTypes)).toBe(true);

    type DistRow = { distance: number };
    const distRows = await prisma.$queryRawUnsafe<DistRow[]>(
      `SELECT ("trajectoryEmbedding" <=> $1::vector)::float8 AS distance
         FROM "policy_trajectories"
        WHERE "policyId" = $2`,
      toPgVectorLiteral(vec),
      policyId,
    );
    expect(distRows).toHaveLength(1);
    expect(distRows[0].distance).toBeLessThan(1e-5);
  });
});

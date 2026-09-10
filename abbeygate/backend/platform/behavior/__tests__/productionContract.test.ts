import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('behavior vector production contract', () => {
  it('has checked-in DDL for behavior vector tables and RLS', () => {
    const sql = read('prisma/migrations/20260509192000_behavior_vector_tables/migration.sql');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "behavior_events"');
    expect(sql).toContain('"embedding" vector(1536)');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "policy_trajectories"');
    expect(sql).toContain('"trajectoryEmbedding" vector(1536)');
    expect(sql).toContain('ALTER TABLE "behavior_events" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE "behavior_events" FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE "policy_trajectories" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE "policy_trajectories" FORCE ROW LEVEL SECURITY');
  });

  it('removes dormant vector schema from the active Prisma model', () => {
    const schema = read('prisma/schema.prisma');
    const bootstrap = read('backend/platform/db/indexBootstrap.ts');
    const cleanup = read('prisma/migrations/20260509193000_remove_dormant_vector_schema/migration.sql');

    expect(schema).not.toContain('model PolicyVector');
    expect(schema).not.toContain('vectors              PolicyVector');
    expect(schema).not.toContain('policyVectors                  PolicyVector');
    expect(schema).not.toContain('embedding Unsupported("vector(1536)")?\n  createdAt DateTime');

    expect(bootstrap).not.toContain('policy_vectors_embedding_hnsw_cosine_idx');
    expect(cleanup).toContain('Refusing to drop policy_vectors because it contains rows');
    expect(cleanup).toContain('Refusing to drop binder_clauses.embedding because non-null embeddings exist');
    expect(cleanup).toContain('DROP TABLE IF EXISTS "policy_vectors"');
    expect(cleanup).toContain('ALTER TABLE "binder_clauses" DROP COLUMN IF EXISTS "embedding"');
  });

  it('tenant-constrains raw vector writes and similar-policy reads', () => {
    const normalize = read('backend/platform/behavior/normalize/normalizeOutboxEvent.ts');
    const trajectory = read('backend/platform/behavior/trajectory/updatePolicyTrajectory.ts');
    const similarity = read('backend/platform/behavior/similarity.ts');

    expect(normalize).toContain('AND "operatingTenantId" = $3');
    expect(normalize).toContain('behavior.normalize.vector_update_miss');

    expect(trajectory).toContain('AND "operatingTenantId" = $2');
    expect(trajectory).toContain('AND "operatingTenantId" = $3');
    expect(trajectory).toContain('behavior.trajectory.vector_update_miss');

    expect(similarity).toContain('WHERE pt."operatingTenantId" = $2');
    expect(similarity).toContain('AND pt."policyId" <> $1');
  });

  it('exposes failure-zone monitoring as advisory behavior evidence', () => {
    const router = read('backend/platform/behavior/http/behaviorRouter.ts');
    const uwTab = read('frontend/src/modules/policies/underwriting/views/UnderwritingTab.tsx');
    const banner = read('frontend/src/modules/policies/underwriting/views/FailureZoneBanner.tsx');
    const failureZoneHook = read('frontend/src/modules/policies/underwriting/views/useFailureZone.ts');

    expect(router).toContain("router.get('/policies/:id/failure-zone'");
    expect(router).toContain('loadSimilarFailureEvidence');
    expect(router).toContain('PAID_WITHOUT_INCEPTION');
    expect(router).toContain('ISSUED_DOCS_MISSING_SLA');
    expect(router).toContain('WELCOME_EMAIL_FAILED');

    expect(uwTab).toContain('FailureZoneBanner');
    expect(banner).toContain('Operational follow-up needed');
    expect(banner).toContain('Operational watch');
    expect(failureZoneHook).toContain('api.getBehaviorFailureZone(id)');
  });

  it('does not surface diagnostic-only signals or stale welcome-email failures to operators (ABY-263)', () => {
    // ABY-263 — the operator-facing failure zone previously surfaced
    // two leaks:
    //   1. `BEHAVIOR_TRAJECTORY_MISSING` — emitted whenever the
    //      behavior trajectory worker was lagging on a paid policy,
    //      with a `whatsHappening` line that explicitly told the
    //      operator "Customer is unaffected. No customer-facing
    //      action needed.". That is the definition of a diagnostic
    //      that does not belong in an operator alert.
    //   2. `WELCOME_EMAIL_FAILED` — emitted on any historical
    //      welcome-email failure event, even when a subsequent
    //      WELCOME_EMAIL_SENT row recorded a successful retry. The
    //      operator chased resends on policies the customer had
    //      already received documents for.
    //
    // Pin both behaviours from the source so they cannot regress
    // without an explicit ADR.
    const router = read('backend/platform/behavior/http/behaviorRouter.ts');
    const copy = read('frontend/src/modules/policies/underwriting/views/failureZoneCopy.ts');

    expect(
      router,
      'BEHAVIOR_TRAJECTORY_MISSING must NOT be emitted as a failure-zone signal — it is diagnostic-only.',
    ).not.toMatch(/signals\.push\(\s*\{\s*code:\s*'BEHAVIOR_TRAJECTORY_MISSING'/);
    expect(
      copy,
      'failureZoneCopy.ts must NOT carry a row for BEHAVIOR_TRAJECTORY_MISSING — the signal is no longer emitted.',
    ).not.toContain("'BEHAVIOR_TRAJECTORY_MISSING':");

    expect(
      router,
      'WELCOME_EMAIL_FAILED must be suppressed when a subsequent WELCOME_EMAIL_SENT is present (welcomeSent === true).',
    ).toMatch(/if \(welcomeFailure && !welcomeSent\)/);
  });

  it('surfaces FNOL_LINK_DELIVERY_FAILED with the canonical claim-scoped query (ABY-268)', () => {
    // ABY-268 — the failure zone must mirror WELCOME_EMAIL_FAILED for
    // the FNOL intake link. When the `COMMUNICATION_OUTBOUND` worker
    // exhausts retries on a `CLAIMS_FNOL_LINK` message tied to any
    // claim on this policy, the operator must see an alert-severity
    // signal in the same banner the welcome-email failure flows
    // through. Pin both the loader and the signal emit shape so the
    // cross-table query (claim ↔ thread ↔ message) cannot silently
    // be replaced by an inline open-shape map shortcut.
    const router = read('backend/platform/behavior/http/behaviorRouter.ts');

    expect(
      router,
      'loadFailedFnolLinkForPolicy must narrow by the CLAIMS_FNOL_LINK template id so the signal matches the canonical email trigger.',
    ).toContain("equals: 'CLAIMS_FNOL_LINK'");

    expect(
      router,
      'FNOL_LINK_DELIVERY_FAILED must be emitted as an alert severity signal — the customer never received the intake link.',
    ).toMatch(/signals\.push\(\{\s*code:\s*'FNOL_LINK_DELIVERY_FAILED',\s*severity:\s*'alert'/);
  });

  it('renders operator-friendly copy for every backend failure-zone signal code (ABY-231)', () => {
    // The backend canonical owner is loadFailureZoneSnapshot in
    // backend/platform/behavior/http/behaviorRouter.ts.
    // Every signal code it can emit MUST have a row in the frontend
    // copy mapping, otherwise operators see engineer-speak again.
    const router = read('backend/platform/behavior/http/behaviorRouter.ts');
    const copy = read('frontend/src/modules/policies/underwriting/views/failureZoneCopy.ts');

    // Extract every signal code emitted by `signals.push({ code: '…' })` in the
    // failure-zone helper. Avoid grabbing unrelated `code: '...'` fields used by
    // HTTP error responses elsewhere in the router.
    const codeMatches = router.match(/signals\.push\(\{\s*code:\s*'([A-Z_]+)'/g) ?? [];
    const codes = Array.from(new Set(codeMatches.map((m) => {
      const inner = m.match(/code:\s*'([A-Z_]+)'/);
      return inner ? inner[1] : '';
    }).filter(Boolean)));
    expect(codes.length).toBeGreaterThan(0);

    for (const code of codes) {
      expect(copy, `failureZoneCopy.ts is missing a row for ${code}`).toContain(`'${code}':`);
    }

    // The previous fix (ABY-231) replaced a generic lede with per-signal
    // "what's happening" + "what to do next" lines. Guard the structure.
    expect(copy).toContain('whatsHappening');
    expect(copy).toContain('nextAction');
  });
});

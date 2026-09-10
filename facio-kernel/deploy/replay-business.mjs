// Executes only inside an isolated, network-disabled candidate container with a copied /data mount.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '/app/dist/src/storage/store.js';
import { AuthStore } from '/app/dist/src/storage/auth-store.js';
import { initializeRustMoney, rustMoneyStatus } from '/app/dist/src/domain/rust-money.js';
import { hash } from '/app/dist/src/domain/canonical.js';
import { scopeSchema, configurationSchema } from '/app/dist/src/contracts/configuration.js';
import { requirementsAttachmentSchema } from '/app/dist/src/contracts/control-plane.js';
import { FinanceApplication } from '/app/dist/src/application/finance.js';
import { DocumentApplication } from '/app/dist/src/application/documents.js';
import { FnolApplication } from '/app/dist/src/application/fnol.js';

assert.equal(process.env.KERNEL_ISOLATED_REPLAY, 'true');
const baseline = JSON.parse(readFileSync('/replay-baseline.json', 'utf8'));
assert(Array.isArray(baseline.records));
assert(baseline.tableCounts && typeof baseline.tableCounts === 'object');
initializeRustMoney();
let store, auth, db;
const context = (serialized) => {
  const parts = JSON.parse(serialized);
  if (Array.isArray(parts)) assert.equal(parts.length, 4);
  const scope = scopeSchema.parse(
    Array.isArray(parts)
      ? {
          workspaceId: parts[0],
          tenantId: parts[1],
          environment: parts[2],
          operatingEntityId: parts[3],
        }
      : parts,
  );
  assert(['sandbox', 'development'].includes(scope.environment));
  return {
    ...scope,
    actorId: 'isolated-recovery-check',
    correlationId: randomUUID(),
    permissions: ['finance:read', 'documents:read', 'fnol:read'],
  };
};
try {
  // Before running any auth constructor, reject a mistakenly mounted real auth DB.
  const emptyAuth = new DatabaseSync('/data/auth.sqlite', { readOnly: true });
  try {
    for (const table of ['auth_entries', 'auth_grants'])
      assert.equal(emptyAuth.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
  } finally {
    emptyAuth.close();
  }
  store = new Store('/data/kernel.sqlite');
  auth = new AuthStore('/data/auth.sqlite');
  auth.close();
  auth = null;
  db = new DatabaseSync('/data/kernel.sqlite', { readOnly: true });
  assert.deepEqual(
    db
      .prepare('PRAGMA integrity_check')
      .all()
      .map((row) => row.integrity_check),
    ['ok'],
  );
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const dataVersion = db.prepare('PRAGMA data_version').get().data_version;
  const finance = new FinanceApplication(store);
  const documents = new DocumentApplication(store);
  const fnol = new FnolApplication(store);
  const results = {
    records: [],
    documents: [],
    notices: [],
    finance: [],
    approvals: [],
    providers: [],
    releases: [],
    tenants: [],
    requirements: [],
    outbox: [],
  };
  // Every pre-existing table keeps its cardinality through this non-destructive
  // migration. New tables are allowed; silently dropping history is not.
  for (const [table, expected] of Object.entries(baseline.tableCounts)) {
    assert(Number.isSafeInteger(expected) && expected >= 0);
    const quoted = '"' + table.replaceAll('"', '""') + '"';
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM ${quoted}`).get().count,
      expected,
      `Changed original row count: ${table}`,
    );
  }
  const heads = db
    .prepare('SELECT scope,id,version,record_hash FROM insurance_records ORDER BY scope,id')
    .all();
  assert.deepEqual(
    heads.map((row) => ({
      scope: row.scope,
      id: row.id,
      version: row.version,
      recordHash: row.record_hash,
    })),
    baseline.records,
  );
  for (const row of db.prepare('SELECT scope FROM drafts ORDER BY scope').all())
    store.read(context(row.scope), 'draft');
  // Include old metadata releases, not only the currently active definition.
  for (const row of db.prepare('SELECT configuration,hash FROM releases ORDER BY id').all())
    assert.equal(hash(configurationSchema.parse(JSON.parse(row.configuration))), row.hash);
  for (const row of db.prepare('SELECT id FROM control_tenants ORDER BY id').all()) {
    const tenant = store.control.tenant(row.id);
    store.control.runtimeDraft(row.id);
    const active = store.control.release(tenant.scope);
    const pointer = db
      .prepare('SELECT release_id FROM control_active_releases WHERE tenant_id=?')
      .get(row.id);
    assert.equal(active?.id ?? null, pointer?.release_id ?? null);
    results.tenants.push({
      id: tenant.id,
      activeReleaseId: active?.id ?? null,
      activeReleaseHash: active?.hash ?? null,
    });
  }
  for (const row of db
    .prepare(
      'SELECT tenant_id,version,attachment_json,attachment_hash FROM control_requirements ORDER BY tenant_id,version',
    )
    .all()) {
    const attachment = requirementsAttachmentSchema.parse(JSON.parse(row.attachment_json));
    assert.equal(hash(attachment), row.attachment_hash);
    assert.equal(attachment.version, row.version);
    assert.equal(hash(attachment.profile), attachment.sourceProfileHash);
    results.requirements.push({
      tenantId: row.tenant_id,
      version: row.version,
      hash: row.attachment_hash,
    });
  }
  for (const row of db.prepare('SELECT id,scope FROM control_sandbox_releases ORDER BY id').all()) {
    const release = store.control.release(context(row.scope), row.id);
    assert(release);
    results.releases.push({ id: release.id, version: release.version, hash: release.hash });
  }
  for (const row of heads) {
    const scope = context(row.scope);
    const history = store.insuranceHistory(scope, row.id);
    const record = store.insuranceRead(scope, row.id);
    assert.equal(record.recordHash, row.record_hash);
    results.records.push({
      id: record.id,
      version: record.version,
      hash: record.recordHash,
      historyVersions: history.revisions.length,
    });
    const ledger = finance.execute('finance_ledger', { recordId: row.id }, scope);
    results.finance.push({
      recordId: row.id,
      ledgerHash: ledger.ledgerHash,
      journals: ledger.journals.length,
      applications: ledger.applications.length,
      receipts: ledger.receipts.length,
    });
  }
  for (const row of db
    .prepare('SELECT DISTINCT scope FROM insurance_outbox ORDER BY scope')
    .all()) {
    const scope = context(row.scope);
    for (const item of store.insuranceOutbox(scope)) {
      const retained = db
        .prepare('SELECT event_json,event_hash FROM insurance_events WHERE id=? AND scope=?')
        .get(item.eventId, row.scope);
      assert(retained);
      assert.equal(item.payload.event.id, item.eventId);
      assert.equal(hash(item.payload.event), retained.event_hash);
      assert.deepEqual(item.payload.event, JSON.parse(retained.event_json));
      assert.equal(item.createdAt, item.payload.event.createdAt);
      assert.equal(item.status, 'pending');
      results.outbox.push({ id: item.id, eventId: item.eventId, payloadHash: item.payloadHash });
    }
  }
  // Pending/declined/revoked reviews may never be referenced by a bound record.
  for (const row of db.prepare('SELECT scope,id FROM approval_heads ORDER BY scope,id').all()) {
    const scope = context(row.scope);
    const history = store.approvals.history(scope, row.id);
    const approval = history.at(-1);
    const source = store.insuranceHistory(scope, approval.target.recordId).revisions[
      approval.target.recordVersion - 1
    ];
    assert(source);
    assert.equal(source.recordHash, approval.target.recordHash);
    assert.equal(source.quoteHash, approval.target.quoteHash);
    assert.equal(source.productPolicyHash, approval.target.policyHash);
    assert.equal(source.runtimeReleaseId ?? null, approval.target.runtimeReleaseId);
    assert.equal(
      source.decision?.evaluation.definitionHash ?? null,
      approval.target.definitionHash,
    );
    assert.equal(source.decision?.evaluation.inputHash ?? null, approval.target.inputHash);
    assert.equal(source.decision?.evaluation.evaluationHash ?? null, approval.target.decisionHash);
    results.approvals.push({
      id: approval.id,
      version: approval.version,
      hash: approval.approvalHash,
      status: approval.status,
    });
  }
  for (const row of db.prepare('SELECT scope,id FROM provider_requests ORDER BY scope,id').all()) {
    const { actorId: _, correlationId: __, permissions: ___, ...scope } = context(row.scope);
    const view = store.providers.view(scope, row.id);
    const source = store.insuranceHistory(scope, view.request.recordId).revisions[
      view.request.recordVersion - 1
    ];
    assert(source);
    assert.equal(source.recordHash, view.request.recordHash);
    assert.equal(source.quoteHash, view.request.selection.quoteHash);
    assert.equal(source.decision?.evaluation.inputHash, view.request.selection.riskHash);
    results.providers.push({
      id: row.id,
      requestHash: view.request.requestHash,
      stateHash: view.state.stateHash,
      status: view.state.status,
      receipts: view.receipts.map((receipt) => receipt.receiptHash),
    });
  }
  for (const row of db.prepare('SELECT scope,id FROM document_requests ORDER BY scope,id').all()) {
    const scope = context(row.scope);
    const view = documents.execute('documents_get', { jobId: row.id }, scope);
    for (const artifact of view.artifacts) {
      const content = documents.execute('documents_content', { artifactId: artifact.id }, scope);
      assert.equal(
        createHash('sha256').update(Buffer.from(content.content, 'base64')).digest('hex'),
        artifact.contentHash,
      );
    }
    results.documents.push({
      id: row.id,
      state: view.state.status,
      stateHash: view.state.stateHash,
      artifacts: view.artifacts.map((artifact) => ({
        id: artifact.id,
        hash: artifact.contentHash,
      })),
    });
  }
  for (const row of db
    .prepare('SELECT DISTINCT scope,id FROM fnol_notices ORDER BY scope,id')
    .all()) {
    const view = fnol.execute('fnol_get', { noticeId: row.id }, context(row.scope));
    results.notices.push({
      id: row.id,
      version: view.notice.version,
      hash: view.notice.noticeHash,
      status: view.notice.status,
    });
  }
  for (const row of db
    .prepare(
      'SELECT DISTINCT scope FROM finance_receipts UNION SELECT DISTINCT scope FROM finance_applications',
    )
    .all()) {
    const scope = context(row.scope);
    store.finance.receipts(scope);
    store.finance.applications(scope);
  }
  assert.equal(
    db.prepare('PRAGMA data_version').get().data_version,
    dataVersion,
    'Replay reads unexpectedly changed business data',
  );
  console.log(
    JSON.stringify({
      passed: true,
      baselineVerified: true,
      businessSchema: db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()
        .version,
      moneyEngine: rustMoneyStatus(),
      ...results,
      authDataRowsMounted: 0,
      authSessionValuesRead: false,
      externalConnectionsAttempted: false,
    }),
  );
} finally {
  db?.close();
  auth?.close();
  store?.close();
}

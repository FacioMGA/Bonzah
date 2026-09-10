import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { PDFDocument } from 'pdf-lib';
import { Kernel } from '../src/application/kernel.js';
import { DocumentApplication } from '../src/application/documents.js';
import { Store } from '../src/storage/store.js';
import { documentBytesHash } from '../src/storage/documents.js';
import { KernelError, hash } from '../src/domain/canonical.js';
import { setupConfiguredV2 } from './fixtures/configured-v2.js';
import { multiRiskDefinition, multiRiskSubmission } from './fixtures/insurance-v2.js';
import { configuredServiceEvaluationSchema } from '../src/contracts/insurance-service.js';
import { renderDocumentPack } from '../src/domain/document-renderer.js';
import { syntheticDocumentPack } from '../src/domain/document-training.js';
import {
  documentViewSchema,
  type DocumentView,
  type DocumentOperationName,
} from '../src/contracts/documents.js';
import {
  insuranceMutationResultSchema,
  insuranceOperations,
  type InsuranceRecord,
} from '../src/contracts/insurance.js';
import type { Context } from '../src/contracts/configuration.js';
import {
  insuranceContext,
  scopedRuntimePolicy,
  externalQuote,
  testNow,
} from './fixtures/insurance.js';

const context: Context = {
  ...insuranceContext,
  permissions: [...insuranceContext.permissions, 'documents:read', 'documents:issue'],
};
const isCode = (code: string) => (error: unknown) =>
  error instanceof KernelError && error.code === code;
function fixture(path = ':memory:', summary = externalQuote.risk.summary) {
  let now = testNow();
  const store = new Store(path);
  const clock = () => new Date(now);
  const kernel = new Kernel(
    store,
    [],
    [scopedRuntimePolicy],
    clock,
    undefined,
    [],
    [syntheticDocumentPack],
  );
  const quoted = insuranceMutationResultSchema.parse(
    kernel.execute(
      'insurance_create_quote',
      {
        idempotencyKey: randomUUID(),
        productId: scopedRuntimePolicy.policy.id,
        productVersion: scopedRuntimePolicy.policy.version,
        quote: {
          ...structuredClone(externalQuote),
          risk: { summary, externalRiskReference: null },
        },
      },
      context,
    ),
  ).record;
  const bind = () =>
    insuranceMutationResultSchema.parse(
      kernel.execute(
        'insurance_bind',
        {
          idempotencyKey: randomUUID(),
          recordId: quoted.id,
          expectedVersion: quoted.version,
          quoteHash: quoted.quoteHash,
        },
        context,
      ),
    ).record;
  const execute = (name: DocumentOperationName, input: unknown, actor = context) =>
    kernel.execute(name, input, actor);
  const request = (record: InsuranceRecord, overrides = {}) => ({
    recordId: record.id,
    recordVersion: record.version,
    recordHash: record.recordHash,
    packId: syntheticDocumentPack.id,
    packVersion: syntheticDocumentPack.version,
    idempotencyKey: randomUUID(),
    ...overrides,
  });
  return {
    store,
    kernel,
    clock,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    quoted,
    bind,
    execute,
    request,
  };
}
function get(f: ReturnType<typeof fixture>, id: string) {
  return documentViewSchema.parse(f.execute('documents_get', { jobId: id }));
}
function retryInput(value: DocumentView) {
  return {
    jobId: value.request.id,
    expectedVersion: value.state.version,
    stateHash: value.state.stateHash,
    idempotencyKey: randomUUID(),
  };
}

test('canonical document generation retains exact PDF/HTML bytes and original service history across restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'document-retention-'));
  const path = join(dir, 'kernel.sqlite');
  const f = fixture(path);
  try {
    assert.throws(
      () => f.execute('documents_request', f.request(f.quoted)),
      isCode('DOCUMENT_TRANSACTION_NOT_ISSUED'),
    );
    const bound = f.bind();
    const command = f.request(bound);
    const requested = documentViewSchema.parse(f.execute('documents_request', command));
    assert.equal(requested.state.status, 'queued');
    assert.equal(requested.artifacts.length, 0);
    assert.equal(
      documentViewSchema.parse(f.execute('documents_request', command)).request.id,
      requested.request.id,
    );
    assert.equal(
      documentViewSchema.parse(f.execute('documents_request', f.request(bound))).request.id,
      requested.request.id,
    );
    assert.equal(await f.kernel.documents.runOne(), true);
    assert.equal(await f.kernel.documents.runOne(), false);
    const complete = get(f, requested.request.id);
    assert.equal(complete.state.status, 'completed');
    assert.deepEqual(
      complete.history.map((state) => state.status),
      ['queued', 'rendering', 'completed'],
    );
    assert.equal(complete.artifacts.length, 4);
    await mkdir('test-results/documents', { recursive: true });
    for (const artifact of complete.artifacts) {
      const content = f.execute('documents_content', { artifactId: artifact.id }) as {
        content: string;
      };
      const bytes = Buffer.from(content.content, 'base64');
      assert.equal(bytes.byteLength, artifact.byteLength);
      assert.equal(documentBytesHash(bytes), artifact.contentHash);
      if (artifact.format === 'pdf') {
        const parsed = await PDFDocument.load(bytes);
        assert(parsed.getPageCount() >= 2);
        assert.equal(parsed.getAuthor(), 'Facio Platform sandbox');
      } else {
        const html = bytes.toString();
        assert.match(html, /GBP 100\.01/);
        assert.match(html, /GBP 10\.00/);
        assert.match(html, /Synthetic training/);
        if (artifact.templateId === 'coverage_schedule')
          assert.match(html, /No typed coverage selection/);
        assert(html.includes(artifact.documentNumber));
        assert(html.includes(bound.recordHash));
        assert(html.includes(bound.quote.term.endDate));
      }
      await writeFile(`test-results/documents/${artifact.templateId}.${artifact.format}`, bytes);
    }
    const changed = insuranceMutationResultSchema.parse(
      f.kernel.execute(
        'insurance_service',
        {
          recordId: bound.id,
          expectedVersion: bound.version,
          recordHash: bound.recordHash,
          action: 'endorsement',
          premiumDeltaMinor: '2599',
          effectiveDate: '2026-09-10',
          reason: 'Synthetic additional premium; no changed risk is inferred',
          idempotencyKey: randomUUID(),
        },
        context,
      ),
    ).record;
    const serviceRequest = documentViewSchema.parse(
      f.execute('documents_request', f.request(changed)),
    );
    await f.kernel.documents.runOne();
    assert.notEqual(serviceRequest.request.documentNumber, complete.request.documentNumber);
    assert.equal(get(f, serviceRequest.request.id).request.snapshot.record.premiumMinor, '12600');
    assert.deepEqual(get(f, complete.request.id).artifacts, complete.artifacts);
    assert.deepEqual(get(f, complete.request.id).request.snapshot.record, bound);
    f.store.close();
    const reopened = new Store(path);
    try {
      assert.equal(reopened.documents.state(context, complete.request.id).status, 'completed');
      assert.deepEqual(
        reopened.documents.artifacts(context, complete.request.id),
        complete.artifacts,
      );
      for (const artifact of complete.artifacts)
        assert.equal(
          documentBytesHash(reopened.documents.content(context, artifact.id).bytes),
          artifact.contentHash,
        );
    } finally {
      reopened.close();
    }
  } finally {
    try {
      f.store.close();
    } catch {}
    await rm(dir, { recursive: true, force: true });
  }
});

test('permissions, full scope, exact target and registry boundaries reject untrusted document issuance or retrieval', async () => {
  const f = fixture();
  try {
    const bound = f.bind();
    const input = f.request(bound);
    assert.throws(
      () => f.execute('documents_request', input, { ...context, permissions: ['documents:read'] }),
      isCode('FORBIDDEN'),
    );
    assert.throws(
      () => f.execute('documents_request', { ...input, recordHash: '0'.repeat(64) }),
      isCode('DOCUMENT_TARGET_CHANGED'),
    );
    assert.throws(
      () => f.execute('documents_request', { ...input, packVersion: '9.9.9' }),
      isCode('DOCUMENT_PACK_NOT_REGISTERED'),
    );
    assert.throws(
      () => f.execute('documents_request', { ...input, scope: context }),
      /unrecognized/i,
    );
    const requested = documentViewSchema.parse(f.execute('documents_request', input));
    await f.kernel.documents.runOne();
    const complete = get(f, requested.request.id);
    for (const field of ['workspaceId', 'tenantId', 'environment', 'operatingEntityId'] as const) {
      const denied = {
        ...context,
        [field]: field === 'environment' ? 'sandbox' : 'another-scope',
      } as Context;
      assert.throws(
        () => f.execute('documents_get', { jobId: requested.request.id }, denied),
        isCode('NOT_FOUND'),
      );
      assert.throws(
        () => f.execute('documents_content', { artifactId: complete.artifacts[0]!.id }, denied),
        isCode('NOT_FOUND'),
      );
    }
    assert.throws(
      () => f.execute('documents_request', { ...input, recordVersion: 99 }),
      isCode('IDEMPOTENCY_CONFLICT'),
    );
    assert.throws(
      () => f.execute('documents_request', input, { ...context, actorId: 'other-actor' }),
      isCode('IDEMPOTENCY_CONFLICT'),
    );
    assert.throws(
      () => f.execute('documents_retry', retryInput(complete)),
      isCode('DOCUMENT_RETRY_UNAVAILABLE'),
    );
    const empty = new DocumentApplication(f.store);
    assert.deepEqual(
      f.store.transaction(() => empty.execute('documents_catalog', {}, context)),
      { packs: [] },
    );
  } finally {
    f.store.close();
  }
});

test('unsupported glyph failure is durable, leaves no partial artifacts and respects fixed idempotent retry budget', async () => {
  const f = fixture(':memory:', 'Synthetic unsupported glyph: 🏢');
  try {
    const bound = f.bind();
    const requested = documentViewSchema.parse(f.execute('documents_request', f.request(bound)));
    for (let attempt = 1; attempt <= 3; attempt++) {
      await f.kernel.documents.runOne();
      const failed = get(f, requested.request.id);
      assert.equal(failed.state.status, 'failed');
      assert.equal(failed.state.failureCode, 'UNSUPPORTED_GLYPH');
      assert.equal(failed.state.attempts, attempt);
      assert.deepEqual(failed.artifacts, []);
      if (attempt < 3) {
        const retry = retryInput(failed);
        const accepted = documentViewSchema.parse(f.execute('documents_retry', retry));
        assert.equal(
          documentViewSchema.parse(f.execute('documents_retry', retry)).state.stateHash,
          accepted.state.stateHash,
        );
      } else
        assert.throws(
          () => f.execute('documents_retry', retryInput(failed)),
          isCode('DOCUMENT_RETRY_UNAVAILABLE'),
        );
    }
    assert.equal(f.store.insuranceRead(context, bound.id).recordHash, bound.recordHash);
  } finally {
    f.store.close();
  }
});

test('rendering releases SQLite, claims once, recovers expired lease and ignores late renderer completion', async () => {
  const f = fixture();
  try {
    const bound = f.bind();
    const requested = documentViewSchema.parse(f.execute('documents_request', f.request(bound)));
    let complete!: (value: Awaited<ReturnType<typeof renderDocumentPack>>) => void;
    const slow = new DocumentApplication(
      f.store,
      [syntheticDocumentPack],
      f.clock,
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const first = slow.runOne();
    assert.equal(get(f, requested.request.id).state.status, 'rendering');
    assert.equal(await f.kernel.documents.runOne(), false);
    f.store.transaction(() =>
      assert.equal(f.store.insuranceRead(context, bound.id).recordHash, bound.recordHash),
    );
    f.advance(120001);
    const expired = get(f, requested.request.id);
    assert.equal(expired.canRetry, true);
    f.execute('documents_retry', retryInput(expired));
    await f.kernel.documents.runOne();
    const recovered = get(f, requested.request.id);
    complete(await renderDocumentPack(requested.request));
    await first;
    assert.equal(get(f, requested.request.id).state.stateHash, recovered.state.stateHash);
    assert.equal(recovered.state.attempts, 2);
    assert.equal(recovered.artifacts.length, 4);
  } finally {
    f.store.close();
  }
});

test('partial persistence rolls back all outputs and corrupted stored bytes fail authenticated retrieval', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'document-integrity-'));
  const path = join(dir, 'kernel.sqlite');
  const f = fixture(path);
  const db = new DatabaseSync(path);
  try {
    const bound = f.bind();
    const requested = documentViewSchema.parse(f.execute('documents_request', f.request(bound)));
    db.exec(
      "CREATE TRIGGER fail_document_html BEFORE INSERT ON document_artifacts WHEN NEW.format='html' BEGIN SELECT RAISE(ABORT,'test storage failure'); END;",
    );
    await f.kernel.documents.runOne();
    const failed = get(f, requested.request.id);
    assert.equal(failed.state.status, 'failed');
    assert.deepEqual(failed.artifacts, []);
    db.exec('DROP TRIGGER fail_document_html');
    f.execute('documents_retry', retryInput(failed));
    await f.kernel.documents.runOne();
    const complete = get(f, requested.request.id);
    assert.throws(() => db.exec("UPDATE document_artifacts SET content=X'00'"), /immutable/);
    db.exec('DROP TRIGGER document_artifacts_no_update');
    db.prepare("UPDATE document_artifacts SET content=X'00' WHERE id=?").run(
      complete.artifacts[0]!.id,
    );
    assert.throws(
      () => f.execute('documents_content', { artifactId: complete.artifacts[0]!.id }),
      isCode('INTEGRITY_ERROR'),
    );
  } finally {
    db.close();
    f.store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('configured documents retain repeated risks and explicit coverage bases from the original release, then describe the effective serviced revision', async () => {
  const f = setupConfiguredV2();
  const documentsKernel = new Kernel(
    f.store,
    [],
    [],
    testNow,
    { region: 'test', buildSha: 'a'.repeat(40) },
    [],
    [syntheticDocumentPack],
  );
  const execute = (name: DocumentOperationName, input: unknown) =>
    documentsKernel.execute(name, input, f.context);
  const generate = async (record: InsuranceRecord) => {
    const queued = documentViewSchema.parse(
      execute('documents_request', {
        recordId: record.id,
        recordVersion: record.version,
        recordHash: record.recordHash,
        packId: syntheticDocumentPack.id,
        packVersion: syntheticDocumentPack.version,
        idempotencyKey: randomUUID(),
      }),
    );
    await documentsKernel.documents.runOne();
    const result = documentViewSchema.parse(execute('documents_get', { jobId: queued.request.id }));
    assert.equal(result.state.status, 'completed');
    return result;
  };
  const html = (job: DocumentView) => {
    const artifact = job.artifacts.find(
      (item) => item.templateId === 'coverage_schedule' && item.format === 'html',
    )!;
    return f.store.documents.content(f.context, artifact.id).bytes.toString();
  };
  try {
    const bound = f.bind(f.create());
    const original = await generate(bound);
    const originalHtml = html(original);
    assert.match(originalHtml, /Example A/);
    assert.match(originalHtml, /Per Occurrence/);
    assert.match(originalHtml, /Policy Term/);
    assert.match(originalHtml, /Excess over primary/);
    assert.match(originalHtml, /GBP 1,000\.00/);
    assert.match(originalHtml, /2026-09-13/);
    assert.equal(original.request.snapshot.definition?.schemaVersion, 'insurance-product-v2');
    const changedDefinition = structuredClone(multiRiskDefinition);
    changedDefinition.coverages[0]!.name = 'Replacement active label, not historical cover';
    f.update(changedDefinition);
    f.activate();
    const submission = structuredClone(multiRiskSubmission);
    submission.version = '2';
    submission.summary = 'Synthetic six-day rental with an additional named risk';
    submission.term.endDate = '2026-09-15';
    submission.evidenceRefs = ['fixture://document-service-new-risk'];
    submission.riskGroups[0]!.rows.push({
      rowId: 'driver-b',
      answers: { name: 'Example B', age: 30, 'previous-loss': false },
    });
    submission.coverages.push({
      coverageId: 'person',
      scope: { kind: 'risk', groupId: 'drivers', rowId: 'driver-b' },
      limitMinor: '10000',
      deductibleMinor: '100',
      aggregateMinor: '100000',
    });
    const input = {
      recordId: bound.id,
      expectedVersion: bound.version,
      recordHash: bound.recordHash,
      submission,
      effectiveDate: '2026-09-11',
      reason: 'Synthetic future-effective extension and named risk',
      evidenceRefs: ['fixture://document-service-authorization'],
    };
    const preview = configuredServiceEvaluationSchema.parse(
      f.execute('insurance_evaluate_service', input),
    );
    assert.equal(preview.status, 'allowed', preview.reasons.join('; '));
    const changed = insuranceMutationResultSchema.parse(
      f.execute('insurance_service_configured', {
        ...input,
        expectedEvaluationHash: preview.evaluationHash,
        idempotencyKey: randomUUID(),
      }),
    ).record;
    const serviced = await generate(changed),
      servicedHtml = html(serviced);
    assert.equal(serviced.request.snapshot.record.runtimeReleaseId, bound.runtimeReleaseId);
    assert.equal(
      hash(serviced.request.snapshot.definition),
      bound.decision!.evaluation.definitionHash,
    );
    assert.match(servicedHtml, /Example B/);
    assert.match(servicedHtml, /drivers \/ driver-b/);
    assert.match(servicedHtml, /Per Person/);
    assert.match(servicedHtml, /2026-09-15/);
    assert.match(servicedHtml, /2026-09-11/);
    assert.match(
      servicedHtml,
      /recording a future-effective change does not make it current cover/,
    );
    assert.match(servicedHtml, /fixture:\/\/document-service-new-risk/);
    assert.match(servicedHtml, /fixture:\/\/document-service-authorization/);
    assert(!servicedHtml.includes('Replacement active label'));
    assert(servicedHtml.includes(changed.configuredService!.evaluationHash));
    assert(servicedHtml.includes('synthetic-rental / 2'));
    assert.equal(
      serviced.request.snapshot.record.premiumMinor,
      preview.calculation!.resultingPremiumMinor,
    );
    assert.deepEqual(changed.quote, bound.quote);
    assert.equal(html(original), originalHtml);
    assert(!originalHtml.includes('Example B'));
    for (const artifact of serviced.artifacts)
      await writeFile(
        `test-results/documents/configured-service-${artifact.templateId}.${artifact.format}`,
        f.store.documents.content(f.context, artifact.id).bytes,
      );
  } finally {
    f.store.close();
  }
});

test('registered pack versions pin wording at request time and HTML safely escapes retained source text', async () => {
  const f = fixture(':memory:', 'Synthetic <script>alert("source")</script> & quoted description');
  try {
    const bound = f.bind(),
      queued = documentViewSchema.parse(f.execute('documents_request', f.request(bound)));
    const altered = structuredClone(syntheticDocumentPack);
    altered.templates[0]!.wording = 'Changed wording must use a new pack version.';
    const changedKernel = new Kernel(
      f.store,
      [],
      [scopedRuntimePolicy],
      testNow,
      undefined,
      [],
      [altered],
    );
    assert.throws(
      () => changedKernel.execute('documents_request', f.request(bound), context),
      isCode('DOCUMENT_TEMPLATE_CHANGED'),
    );
    await changedKernel.documents.runOne();
    const original = get(f, queued.request.id);
    const artifact = original.artifacts.find(
      (item) => item.templateId === 'transaction_summary' && item.format === 'html',
    )!;
    const originalHtml = f.store.documents.content(context, artifact.id).bytes.toString();
    assert(originalHtml.includes(syntheticDocumentPack.templates[0]!.wording));
    assert(!originalHtml.includes(altered.templates[0]!.wording));
    assert(originalHtml.includes('&lt;script&gt;alert(&quot;source&quot;)&lt;/script&gt; &amp;'));
    assert(!originalHtml.includes('<script>'));
    altered.version = '2.0.0';
    altered.templates[0]!.version = '2.0.0';
    const nextKernel = new Kernel(
      f.store,
      [],
      [scopedRuntimePolicy],
      testNow,
      undefined,
      [],
      [altered],
    );
    const next = documentViewSchema.parse(
      nextKernel.execute('documents_request', f.request(bound, { packVersion: '2.0.0' }), context),
    );
    await nextKernel.documents.runOne();
    assert.notEqual(next.request.id, original.request.id);
    assert.notEqual(next.request.packHash, original.request.packHash);
    assert.deepEqual(get(f, original.request.id).artifacts, original.artifacts);
    assert.throws(
      () => new Kernel(f.store, [], [], testNow, undefined, [], [altered, altered]),
      /already registered/i,
    );
  } finally {
    f.store.close();
  }
});

test('cancelled and separate renewal documents retain return instructions and expiring-policy linkage without rewriting original outputs', async () => {
  const f = setupConfiguredV2();
  const documentKernel = new Kernel(
    f.store,
    [],
    [],
    testNow,
    { region: 'test', buildSha: 'a'.repeat(40) },
    [],
    [syntheticDocumentPack],
  );
  const generate = async (record: InsuranceRecord) => {
    const queued = documentViewSchema.parse(
      documentKernel.execute(
        'documents_request',
        {
          recordId: record.id,
          recordVersion: record.version,
          recordHash: record.recordHash,
          packId: syntheticDocumentPack.id,
          packVersion: syntheticDocumentPack.version,
          idempotencyKey: randomUUID(),
        },
        f.context,
      ),
    );
    await documentKernel.documents.runOne();
    return documentViewSchema.parse(
      documentKernel.execute('documents_get', { jobId: queued.request.id }, f.context),
    );
  };
  const html = (view: DocumentView) =>
    f.store.documents
      .content(
        f.context,
        view.artifacts.find(
          (item) => item.format === 'html' && item.templateId === 'coverage_schedule',
        )!.id,
      )
      .bytes.toString();
  try {
    const definition = structuredClone(multiRiskDefinition);
    definition.cancellation = {
      calculation: 'per_day_remaining',
      minimumPremiumTreatment: 'block_if_applied',
      sourceRefs: ['fixture://configured-return-rule'],
    };
    f.update(definition);
    f.activate();
    const original = f.bind(f.create()),
      originalDocuments = await generate(original);
    const input = {
      recordId: original.id,
      expectedVersion: original.version,
      recordHash: original.recordHash,
      effectiveDate: '2026-09-12',
      reason: 'Synthetic separate cancellation calculation',
      evidenceRefs: ['fixture://cancellation-request'],
    };
    const preview = insuranceOperations.insurance_evaluate_cancellation.output.parse(
      f.execute('insurance_evaluate_cancellation', input),
    );
    const cancelled = insuranceMutationResultSchema.parse(
      f.execute('insurance_cancel_configured', {
        ...input,
        expectedEvaluationHash: preview.evaluationHash,
        idempotencyKey: randomUUID(),
      }),
    ).record;
    const cancelledDocuments = await generate(cancelled),
      content = html(cancelledDocuments);
    assert.match(content, /Return premium calculated/);
    assert.match(content, /GBP 24\.00/);
    assert.match(content, /2026-09-12/);
    assert.match(content, /not request or verify a cash refund/);
    assert.match(content, /separately generated training document does not send a notice/);
    assert.match(content, /fixture:\/\/configured-return-rule/);
    assert.equal(
      cancelledDocuments.request.snapshot.record.configuredCancellation?.noticeStatus,
      'not_issued',
    );
    assert.deepEqual(
      f.store.documents.artifacts(f.context, originalDocuments.request.id),
      originalDocuments.artifacts,
    );
    const sourceSubmission = structuredClone(multiRiskSubmission);
    sourceSubmission.reference = 'synthetic-renewable-source';
    const expiring = f.bind(f.create(sourceSubmission)),
      expiringDocuments = await generate(expiring);
    const submission = structuredClone(sourceSubmission);
    submission.reference = 'synthetic-distinct-renewal';
    submission.version = 'renewal-1';
    submission.term = { startDate: '2026-09-14', endDate: '2026-09-17' };
    const renewalInput = {
      sourceRecordId: expiring.id,
      sourceVersion: expiring.version,
      sourceRecordHash: expiring.recordHash,
      productId: expiring.productId,
      productVersion: expiring.productVersion,
      submission,
    };
    const renewed = insuranceOperations.insurance_evaluate_renewal.output.parse(
      f.execute('insurance_evaluate_renewal', renewalInput),
    );
    const quoted = insuranceMutationResultSchema.parse(
      f.execute('insurance_create_renewal_quote', {
        ...renewalInput,
        participants: expiring.quote.participants,
        expectedRenewalHash: renewed.renewalHash,
        idempotencyKey: randomUUID(),
      }),
    ).record;
    const renewal = f.bind(quoted),
      renewalDocuments = await generate(renewal),
      renewalHtml = html(renewalDocuments);
    assert.notEqual(renewal.id, expiring.id);
    assert.match(renewalHtml, /Separate linked renewal term/);
    assert(renewalHtml.includes(expiring.id));
    assert(renewalHtml.includes(expiring.recordHash));
    assert.match(renewalHtml, /2026-09-17/);
    assert.deepEqual(
      f.store.documents.artifacts(f.context, expiringDocuments.request.id),
      expiringDocuments.artifacts,
    );
    for (const [name, view] of [
      ['cancellation', cancelledDocuments],
      ['renewal', renewalDocuments],
    ] as const) {
      const artifact = view.artifacts.find(
        (item) => item.format === 'pdf' && item.templateId === 'coverage_schedule',
      )!;
      await writeFile(
        `test-results/documents/${name}-coverage_schedule.pdf`,
        f.store.documents.content(f.context, artifact.id).bytes,
      );
    }
  } finally {
    f.store.close();
  }
});

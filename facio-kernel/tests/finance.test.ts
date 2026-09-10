import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Kernel } from '../src/application/kernel.js';
import { Store } from '../src/storage/store.js';
import { KernelError, canonicalJson, hash } from '../src/domain/canonical.js';
import {
  financeLedgerSchema,
  financeReceiptSchema,
  financeOperations,
} from '../src/contracts/finance.js';
import { insuranceMutationResultSchema, type InsuranceRecord } from '../src/contracts/insurance.js';
import type { Context } from '../src/contracts/configuration.js';
import {
  insuranceContext,
  scopedRuntimePolicy,
  runtimePolicy,
  externalQuote,
  testNow,
} from './fixtures/insurance.js';

const context: Context = {
  ...insuranceContext,
  permissions: [
    ...insuranceContext.permissions,
    'finance:read',
    'finance:post',
    'finance:reconcile',
  ],
};
const evidence = () => ({
  idempotencyKey: randomUUID(),
  reason: 'Explicit synthetic training recognition',
  evidenceRefs: ['fixture://finance-training'],
});
const target = (record: InsuranceRecord) => ({
  recordId: record.id,
  expectedVersion: record.version,
  recordHash: record.recordHash,
});
const code = (value: string) => (error: unknown) =>
  error instanceof KernelError && error.code === value;
function fixture(path = ':memory:') {
  const store = new Store(path),
    kernel = new Kernel(store, [], [scopedRuntimePolicy], testNow);
  const execute = (name: Parameters<Kernel['execute']>[0], input: unknown, actor = context) =>
    kernel.execute(name, input, actor);
  const create = (reference = randomUUID(), premiumMinor = '10001') =>
    insuranceMutationResultSchema.parse(
      execute('insurance_create_quote', {
        idempotencyKey: randomUUID(),
        productId: runtimePolicy.id,
        productVersion: runtimePolicy.version,
        quote: {
          ...externalQuote,
          sourceQuote: { ...externalQuote.sourceQuote, reference },
          premiumMinor,
        },
      }),
    ).record;
  const bind = (record: InsuranceRecord) =>
    insuranceMutationResultSchema.parse(
      execute('insurance_bind', {
        idempotencyKey: randomUUID(),
        recordId: record.id,
        expectedVersion: record.version,
        quoteHash: record.quoteHash,
      }),
    ).record;
  const post = (record: InsuranceRecord) =>
    financeLedgerSchema.parse(
      execute('finance_post', {
        ...evidence(),
        ...target(record),
        accountingBasis: 'synthetic_external_custody_commission_v1',
      }),
    );
  const ledger = (record: InsuranceRecord) =>
    financeLedgerSchema.parse(execute('finance_ledger', { recordId: record.id }));
  const receive = (amountMinor = '600', payerId = 'settlement', sourceReference = randomUUID()) =>
    financeReceiptSchema.parse(
      execute('finance_record_receipt', {
        ...evidence(),
        amountMinor,
        payerId,
        sourceReference,
        currency: 'GBP',
        receivedAt: '2026-09-10T11:00:00.000Z',
        provenance: 'synthetic_training',
      }),
    );
  return { store, kernel, execute, create, bind, post, ledger, receive };
}

test('bound and service journals balance independently and retain external custody and exact cumulative rounding', () => {
  const f = fixture();
  try {
    const record = f.bind(f.create());
    const first = f.post(record);
    assert.deepEqual(first.totals, {
      externalPremiumMinor: '10001',
      commissionAccruedMinor: '1000',
      commissionReceivedMinor: '0',
      commissionOutstandingMinor: '1000',
      recordedUnappliedReceiptMinor: '0',
    });
    assert.equal(first.journals.length, 1);
    assert.equal(
      first.capacity.reduce((sum, item) => sum + BigInt(item.premiumMinor), 0n),
      10001n,
    );
    const service = insuranceMutationResultSchema.parse(
      f.execute('insurance_service', {
        idempotencyKey: randomUUID(),
        reason: 'Synthetic manual endorsement',
        ...target(record),
        action: 'endorsement',
        premiumDeltaMinor: '4',
        effectiveDate: '2026-09-10',
      }),
    ).record;
    const posted = f.post(service);
    assert.equal(posted.totals.commissionAccruedMinor, '1001');
    assert.equal(posted.totals.externalPremiumMinor, '10005');
    assert.deepEqual(posted.journals[0], first.journals[0]);
    assert.equal(posted.journals[1]!.previousJournalHash, first.journals[0]!.journalHash);
    for (const journal of posted.journals)
      for (const book of ['financial', 'external_premium_control'])
        assert.equal(
          journal.lines
            .filter((line) => line.book === book)
            .reduce((sum, line) => sum + BigInt(line.debitMinor) - BigInt(line.creditMinor), 0n),
          0n,
        );
    assert.equal(f.post(service).journals.length, 2);
  } finally {
    f.store.close();
  }
});

test('partial receipt, unmatched remainder and reversal reconcile without mutating the insurance record', () => {
  const f = fixture();
  try {
    const record = f.bind(f.create());
    f.post(record);
    const receipt = f.receive('800');
    const current = f.ledger(record);
    const request = {
      ...evidence(),
      ...target(record),
      expectedLedgerHash: current.ledgerHash,
      receiptId: receipt.id,
      amountMinor: '500',
    };
    const applied = financeLedgerSchema.parse(f.execute('finance_apply_receipt', request));
    assert.equal(applied.totals.commissionOutstandingMinor, '500');
    assert.equal(applied.totals.recordedUnappliedReceiptMinor, '300');
    assert.deepEqual(f.execute('finance_apply_receipt', request), applied);
    assert.equal(f.ledger(record).applications.length, 1);
    const reversed = financeLedgerSchema.parse(
      f.execute('finance_reverse_application', {
        ...evidence(),
        ...target(record),
        expectedLedgerHash: applied.ledgerHash,
        applicationId: applied.applications[0]!.id,
      }),
    );
    assert.equal(reversed.totals.commissionReceivedMinor, '0');
    assert.equal(reversed.totals.commissionOutstandingMinor, '1000');
    assert.equal(reversed.totals.recordedUnappliedReceiptMinor, '800');
    assert.equal(reversed.applications.length, 2);
    assert.deepEqual(f.store.insuranceRead(context, record.id), record);
    assert.throws(
      () =>
        f.execute('finance_reverse_application', {
          ...evidence(),
          ...target(record),
          expectedLedgerHash: reversed.ledgerHash,
          applicationId: applied.applications[0]!.id,
        }),
      code('APPLICATION_ALREADY_REVERSED'),
    );
  } finally {
    f.store.close();
  }
});

test('receipt natural identity deduplicates across actors and rejects altered source evidence', () => {
  const f = fixture();
  try {
    const request = {
      ...evidence(),
      amountMinor: '300',
      payerId: 'settlement',
      sourceReference: 'stable-bank-row',
      currency: 'GBP',
      receivedAt: '2026-09-10T11:00:00.000Z',
      provenance: 'synthetic_training',
    };
    const first = f.execute('finance_record_receipt', request);
    const retry = f.execute(
      'finance_record_receipt',
      { ...request, idempotencyKey: randomUUID() },
      { ...context, actorId: 'another-admin' },
    );
    assert.deepEqual(first, retry);
    assert.equal(f.store.finance.receipts(context).length, 1);
    assert.throws(
      () =>
        f.execute('finance_record_receipt', {
          ...request,
          idempotencyKey: randomUUID(),
          amountMinor: '301',
        }),
      code('RECEIPT_REFERENCE_CONFLICT'),
    );
  } finally {
    f.store.close();
  }
});

test('wrong payer, over-allocation, stale ledger, unposted and unbound records fail without partial postings', () => {
  const f = fixture();
  try {
    const quote = f.create();
    assert.throws(() => f.post(quote), code('FINANCE_NOT_BOUND'));
    const record = f.bind(quote),
      receipt = f.receive('2000');
    const apply = (
      amountMinor: string,
      ledgerHash = f.ledger(record).ledgerHash,
      receiptId = receipt.id,
    ) =>
      f.execute('finance_apply_receipt', {
        ...evidence(),
        ...target(record),
        expectedLedgerHash: ledgerHash,
        receiptId,
        amountMinor,
      });
    assert.throws(() => apply('100'), code('FINANCE_UNPOSTED_TRANSACTIONS'));
    f.post(record);
    assert.throws(() => apply('1001'), code('RECEIPT_OVERALLOCATION'));
    const wrong = f.receive('100', 'wrong-payer');
    assert.throws(
      () => apply('100', f.ledger(record).ledgerHash, wrong.id),
      code('RECEIPT_PAYER_MISMATCH'),
    );
    const stale = f.ledger(record).ledgerHash;
    f.receive('1');
    assert.throws(() => apply('100', stale), code('FINANCE_VERSION_CONFLICT'));
    assert.equal(f.ledger(record).applications.length, 0);
  } finally {
    f.store.close();
  }
});

test('same receipt cannot be over-applied across two insurance records', () => {
  const f = fixture();
  try {
    const one = f.bind(f.create()),
      two = f.bind(f.create());
    f.post(one);
    f.post(two);
    const receipt = f.receive('700');
    f.execute('finance_apply_receipt', {
      ...evidence(),
      ...target(one),
      expectedLedgerHash: f.ledger(one).ledgerHash,
      receiptId: receipt.id,
      amountMinor: '500',
    });
    assert.equal(f.ledger(two).receipts[0]!.unappliedMinor, '200');
    assert.throws(
      () =>
        f.execute('finance_apply_receipt', {
          ...evidence(),
          ...target(two),
          expectedLedgerHash: f.ledger(two).ledgerHash,
          receiptId: receipt.id,
          amountMinor: '201',
        }),
      code('RECEIPT_OVERALLOCATION'),
    );
  } finally {
    f.store.close();
  }
});

test('returns reduce commission accrual and expose a credit instead of inventing a refund payment', () => {
  const f = fixture();
  try {
    const record = f.bind(f.create());
    f.post(record);
    const receipt = f.receive('1000');
    f.execute('finance_apply_receipt', {
      ...evidence(),
      ...target(record),
      expectedLedgerHash: f.ledger(record).ledgerHash,
      receiptId: receipt.id,
      amountMinor: '1000',
    });
    const cancelled = insuranceMutationResultSchema.parse(
      f.execute('insurance_service', {
        idempotencyKey: randomUUID(),
        reason: 'Synthetic manual cancellation',
        ...target(record),
        action: 'cancellation',
        premiumDeltaMinor: '-5000',
        effectiveDate: '2026-09-10',
      }),
    ).record;
    const report = f.post(cancelled);
    assert.equal(report.totals.externalPremiumMinor, '5001');
    assert.equal(report.totals.commissionAccruedMinor, '500');
    assert.equal(report.totals.commissionReceivedMinor, '1000');
    assert.equal(report.totals.commissionOutstandingMinor, '-500');
  } finally {
    f.store.close();
  }
});

test('finance authorization and tenant scope hold; synthetic receipt cannot masquerade as bank verification', () => {
  const f = fixture();
  try {
    const record = f.bind(f.create());
    f.post(record);
    assert.throws(
      () => f.execute('finance_ledger', { recordId: record.id }, insuranceContext),
      code('FORBIDDEN'),
    );
    assert.throws(
      () =>
        f.execute(
          'finance_ledger',
          { recordId: record.id },
          { ...context, tenantId: 'another-tenant' },
        ),
      code('NOT_FOUND'),
    );
    assert.throws(
      () =>
        f.execute(
          'finance_ledger',
          { recordId: record.id },
          { ...context, environment: 'production' },
        ),
      code('FINANCE_ENVIRONMENT_UNSUPPORTED'),
    );
    assert.throws(
      () =>
        f.execute('finance_record_receipt', {
          ...evidence(),
          amountMinor: 'bad',
          currency: 'GBP',
          payerId: 'settlement',
          sourceReference: 'bad',
          receivedAt: testNow().toISOString(),
          provenance: 'synthetic_training',
        }),
      code('VALIDATION_ERROR'),
    );
    assert.throws(
      () =>
        f.execute('finance_record_receipt', {
          ...evidence(),
          amountMinor: '100',
          currency: 'GBP',
          payerId: 'settlement',
          sourceReference: 'forged',
          receivedAt: testNow().toISOString(),
          provenance: 'bank_verified',
        }),
      code('VALIDATION_ERROR'),
    );
  } finally {
    f.store.close();
  }
});

test('journal export preserves exact totals, hashes and escaped source lineage', () => {
  const f = fixture();
  try {
    const record = f.bind(f.create());
    const ledger = f.post(record);
    const result = financeOperations.finance_export.output.parse(
      f.execute('finance_export', { recordId: record.id }),
    );
    assert.equal(result.ledgerHash, ledger.ledgerHash);
    assert.deepEqual(result.totals, ledger.totals);
    assert.equal(result.contentHash, createHash('sha256').update(result.content).digest('hex'));
    assert.ok(result.content.includes(record.recordHash));
    assert.ok(result.content.includes('external_premium_control'));
    assert.equal(
      result.content.trim().split('\r\n').length,
      1 + ledger.journals.reduce((sum, journal) => sum + journal.lines.length, 0),
    );
  } finally {
    f.store.close();
  }
});

test('financial journals survive restart and stored evidence tampering is rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kernel-finance-'));
  const path = join(dir, 'test.sqlite');
  try {
    const f = fixture(path);
    const record = f.bind(f.create());
    const expected = f.post(record);
    f.store.close();
    const resumed = fixture(path);
    assert.deepEqual(resumed.ledger(record), expected);
    resumed.store.close();
    const db = new DatabaseSync(path);
    assert.throws(() => db.exec('UPDATE finance_journals SET hash=hash'));
    db.exec("DROP TRIGGER finance_journals_no_update; UPDATE finance_journals SET hash='tampered'");
    db.close();
    const corrupted = fixture(path);
    assert.throws(() => corrupted.ledger(record), code('FINANCE_INTEGRITY_ERROR'));
    corrupted.store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('journal index metadata and receipt intent hashes are verified independently of valid JSON hashes', async () => {
  for (const mode of ['sequence', 'receipt-intent']) {
    const dir = await mkdtemp(join(tmpdir(), 'finance-index-integrity-'));
    const path = join(dir, 'test.sqlite');
    try {
      const f = fixture(path),
        record = f.bind(f.create());
      f.post(record);
      const receipt = f.receive();
      f.store.close();
      const db = new DatabaseSync(path);
      if (mode === 'sequence') {
        db.exec(
          'DROP TRIGGER finance_journals_no_update; UPDATE finance_journals SET sequence=sequence+100',
        );
      } else {
        db.exec('DROP TRIGGER finance_receipts_no_update');
        const changed = { ...receipt, amountMinor: '601' };
        const { receiptHash: _, ...content } = changed;
        changed.receiptHash = hash(content);
        db.prepare('UPDATE finance_receipts SET json=?,hash=? WHERE id=?').run(
          canonicalJson(changed),
          changed.receiptHash,
          changed.id,
        );
      }
      db.close();
      const corrupted = fixture(path);
      assert.throws(() => corrupted.ledger(record), code('FINANCE_INTEGRITY_ERROR'));
      corrupted.store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test('cross-record available receipts reject a coherently rehashed application journal with a false insurance source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'finance-cross-record-integrity-')),
    path = join(dir, 'test.sqlite');
  try {
    const f = fixture(path),
      one = f.bind(f.create()),
      two = f.bind(f.create());
    f.post(one);
    f.post(two);
    const receipt = f.receive('700');
    const applied = financeLedgerSchema.parse(
      f.execute('finance_apply_receipt', {
        ...evidence(),
        ...target(one),
        expectedLedgerHash: f.ledger(one).ledgerHash,
        receiptId: receipt.id,
        amountMinor: '500',
      }),
    );
    const journal = { ...applied.journals.at(-1)!, insuranceHash: 'f'.repeat(64) };
    const { journalHash: _, ...journalContent } = journal;
    journal.journalHash = hash(journalContent);
    const application = { ...applied.applications[0]!, journalHash: journal.journalHash };
    const { applicationHash: _old, ...applicationContent } = application;
    application.applicationHash = hash(applicationContent);
    f.store.close();
    const db = new DatabaseSync(path);
    db.exec('DROP TRIGGER finance_journals_no_update; DROP TRIGGER finance_applications_no_update');
    db.prepare('UPDATE finance_journals SET json=?,hash=? WHERE id=?').run(
      canonicalJson(journal),
      journal.journalHash,
      journal.id,
    );
    db.prepare('UPDATE finance_applications SET json=?,hash=? WHERE id=?').run(
      canonicalJson(application),
      application.applicationHash,
      application.id,
    );
    db.close();
    const corrupted = fixture(path);
    assert.throws(() => corrupted.ledger(two), code('FINANCE_INTEGRITY_ERROR'));
    corrupted.store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failed receipt application insert rolls its journal back and the exact command can retry once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'finance-atomicity-')),
    path = join(dir, 'test.sqlite');
  try {
    const f = fixture(path),
      record = f.bind(f.create());
    f.post(record);
    const receipt = f.receive();
    const before = f.ledger(record);
    const request = {
      ...evidence(),
      ...target(record),
      expectedLedgerHash: before.ledgerHash,
      receiptId: receipt.id,
      amountMinor: '500',
    };
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TRIGGER fail_application BEFORE INSERT ON finance_applications BEGIN SELECT RAISE(ABORT,'injected test failure'); END;",
    );
    assert.throws(() => f.execute('finance_apply_receipt', request));
    assert.deepEqual(f.ledger(record), before);
    db.exec('DROP TRIGGER fail_application');
    db.close();
    const applied = financeLedgerSchema.parse(f.execute('finance_apply_receipt', request));
    assert.equal(applied.applications.length, 1);
    assert.equal(applied.journals.length, 2);
    assert.deepEqual(f.execute('finance_apply_receipt', request), applied);
    f.store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

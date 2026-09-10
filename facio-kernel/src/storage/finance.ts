import type { DatabaseSync } from 'node:sqlite';
import type { Scope } from '../contracts/configuration.js';
import {
  financeJournalSchema,
  financeReceiptSchema,
  financeApplicationSchema,
  type FinanceJournal,
  type FinanceReceipt,
  type FinanceApplication,
} from '../contracts/finance.js';
import { canonicalJson, hash, KernelError } from '../domain/canonical.js';

const key = (s: Scope) =>
  canonicalJson([s.workspaceId, s.tenantId, s.environment, s.operatingEntityId]);
const integrity = () =>
  new KernelError(
    'FINANCE_INTEGRITY_ERROR',
    'Retained financial evidence failed integrity validation',
    500,
  );
export class FinanceRepository {
  constructor(private readonly db: DatabaseSync) {}
  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS finance_journals(scope TEXT NOT NULL,record_id TEXT NOT NULL,id TEXT NOT NULL,sequence INTEGER NOT NULL,origin_key TEXT NOT NULL,json TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(scope,id),UNIQUE(scope,record_id,sequence),UNIQUE(scope,origin_key));
      CREATE TABLE IF NOT EXISTS finance_receipts(scope TEXT NOT NULL,id TEXT NOT NULL,source_reference TEXT NOT NULL,json TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(scope,id),UNIQUE(scope,source_reference));
      CREATE TABLE IF NOT EXISTS finance_applications(scope TEXT NOT NULL,id TEXT NOT NULL,record_id TEXT NOT NULL,receipt_id TEXT NOT NULL,reverses_id TEXT,json TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(scope,id),UNIQUE(scope,reverses_id));
    `);
    for (const table of ['finance_journals', 'finance_receipts', 'finance_applications'])
      for (const action of ['UPDATE', 'DELETE'])
        this.db.exec(
          `CREATE TRIGGER IF NOT EXISTS ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'immutable financial evidence'); END;`,
        );
  }
  journals(scope: Scope, recordId: string): FinanceJournal[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM finance_journals WHERE scope=? AND record_id=? ORDER BY sequence LIMIT 1001',
      )
      .all(key(scope), recordId);
    if (rows.length > 1000)
      throw new KernelError(
        'FINANCE_REPORT_LIMIT',
        'This ledger requires a paginated reporting capability',
        422,
      );
    try {
      let previous: string | null = null;
      return rows.map((row, index) => {
        const value = financeJournalSchema.parse(JSON.parse(String(row.json)));
        const { journalHash, ...content } = value;
        if (
          key(value.scope) !== key(scope) ||
          value.recordId !== recordId ||
          value.id !== row.id ||
          value.sequence !== row.sequence ||
          value.sequence !== index + 1 ||
          value.previousJournalHash !== previous ||
          journalHash !== row.hash ||
          hash(content) !== journalHash ||
          value.originKey !== row.origin_key
        )
          throw integrity();
        previous = journalHash;
        return value;
      });
    } catch {
      throw integrity();
    }
  }
  appendJournal(value: FinanceJournal) {
    financeJournalSchema.parse(value);
    this.db
      .prepare('INSERT INTO finance_journals VALUES(?,?,?,?,?,?,?)')
      .run(
        key(value.scope),
        value.recordId,
        value.id,
        value.sequence,
        value.originKey,
        canonicalJson(value),
        value.journalHash,
      );
  }
  receipts(scope: Scope): FinanceReceipt[] {
    const rows = this.db
      .prepare('SELECT * FROM finance_receipts WHERE scope=? ORDER BY rowid LIMIT 1001')
      .all(key(scope));
    if (rows.length > 1000)
      throw new KernelError(
        'FINANCE_REPORT_LIMIT',
        'This receipt register requires paginated reporting',
        422,
      );
    try {
      return rows.map((row) => {
        const value = financeReceiptSchema.parse(JSON.parse(String(row.json)));
        const { receiptHash, ...content } = value;
        const {
          id: _id,
          scope: _scope,
          intentHash,
          occurredAt: _occurredAt,
          actorId: _actorId,
          correlationId: _correlationId,
          ...intent
        } = content;
        if (
          hash(intent) !== intentHash ||
          Date.parse(value.receivedAt) > Date.parse(value.occurredAt)
        )
          throw integrity();
        if (
          key(value.scope) !== key(scope) ||
          value.id !== row.id ||
          value.sourceReference !== row.source_reference ||
          receiptHash !== row.hash ||
          hash(content) !== receiptHash
        )
          throw integrity();
        return value;
      });
    } catch {
      throw integrity();
    }
  }
  appendReceipt(value: FinanceReceipt) {
    financeReceiptSchema.parse(value);
    this.db
      .prepare('INSERT INTO finance_receipts VALUES(?,?,?,?,?)')
      .run(
        key(value.scope),
        value.id,
        value.sourceReference,
        canonicalJson(value),
        value.receiptHash,
      );
  }
  applications(scope: Scope): FinanceApplication[] {
    const rows = this.db
      .prepare('SELECT * FROM finance_applications WHERE scope=? ORDER BY rowid LIMIT 1001')
      .all(key(scope));
    if (rows.length > 1000)
      throw new KernelError(
        'FINANCE_REPORT_LIMIT',
        'This reconciliation register requires paginated reporting',
        422,
      );
    try {
      return rows.map((row) => {
        const value = financeApplicationSchema.parse(JSON.parse(String(row.json)));
        const { applicationHash, ...content } = value;
        if (
          key(value.scope) !== key(scope) ||
          value.id !== row.id ||
          value.recordId !== row.record_id ||
          value.receiptId !== row.receipt_id ||
          value.reversesId !== row.reverses_id ||
          applicationHash !== row.hash ||
          hash(content) !== applicationHash
        )
          throw integrity();
        return value;
      });
    } catch {
      throw integrity();
    }
  }
  appendApplication(value: FinanceApplication) {
    financeApplicationSchema.parse(value);
    this.db
      .prepare('INSERT INTO finance_applications VALUES(?,?,?,?,?,?,?)')
      .run(
        key(value.scope),
        value.id,
        value.recordId,
        value.receiptId,
        value.reversesId,
        canonicalJson(value),
        value.applicationHash,
      );
  }
}

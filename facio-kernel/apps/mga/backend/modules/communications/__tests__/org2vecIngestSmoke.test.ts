/**
 * org2vecIngestSmoke — demo ingestion-contract smoke test (ADR-0044).
 *
 * Exercises the deterministic front of the claims hero path without a DB:
 * the bundled sample corpus parses into valid normalized messages, groups
 * into one conversation, and yields the identifiers the resolver needs to
 * land on the CY-MTR-017 claim. The DB-backed refresh→projection→read tail
 * is covered by the full integration gate (Docker/Postgres/Neo4j).
 */

import { describe, expect, it } from 'vitest';
import { loadSampleInbox, listSampleConversations } from '../infra/ingest/sampleInboxAdapter.js';
import { isNormalizedOutlookMessage } from '../domain/providers/outlookMessage.js';
import { extractEmailIdentifiers } from '../domain/providers/identifierExtraction.js';

describe('org2vec demo ingestion smoke', () => {
  it('loads the CY-MTR-017 hero thread as valid normalized messages', async () => {
    const messages = await loadSampleInbox('cy-mtr-017');
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every(isNormalizedOutlookMessage)).toBe(true);
    expect(new Set(messages.map((m) => m.conversationId))).toEqual(new Set(['CY-MTR-017']));
  });

  it('carries deterministic link hints on the FNOL message', async () => {
    const messages = await loadSampleInbox('cy-mtr-017');
    const fnol = messages.find((m) => m.subject.includes('FNOL'));
    expect(fnol?.linkHints?.claimReference).toBe('CY-MTR-017');
    expect(fnol?.linkHints?.policyReference).toBe('ABMTR-100417');
  });

  it('extracts the claim reference from the thread body as a regex fallback', async () => {
    const messages = await loadSampleInbox('cy-mtr-017');
    const combined = messages.map((m) => `${m.subject}\n${m.bodyText}`).join('\n\n');
    expect(extractEmailIdentifiers(combined).claimReference).toBe('CY-MTR-017');
  });

  it('exposes both demo conversations (claim + broker submission)', async () => {
    const conversations = await listSampleConversations();
    expect(conversations).toContain('CY-MTR-017');
    expect(conversations).toContain('SUB-ABFLEET-2210');
  });
});

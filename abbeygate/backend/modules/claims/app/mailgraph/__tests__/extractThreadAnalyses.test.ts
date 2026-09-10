/**
 * extractThreadAnalyses.test — Week 1 deterministic extraction coverage
 * (ADR-0041 §5/§6).
 *
 * Pins the deterministic regex layer.  The LLM-extraction layer added in
 * Week 2 must keep these outputs intact (additive only).
 */

import { describe, expect, it } from 'vitest';
import { extractThreadAnalyses } from '../extractThreadAnalyses.js';
import type { RedactedThread } from '../redactPii.js';

function buildRedactedThread(messages: Array<{ id: string; body: string }>): RedactedThread {
  return {
    threadId: 'thread-1',
    entityType: 'CLAIM',
    entityId: 'claim-1',
    firstActivityAt: '2026-05-01T00:00:00Z',
    lastActivityAt: '2026-05-02T00:00:00Z',
    messages: messages.map((m) => ({
      threadId: 'thread-1',
      messageId: m.id,
      sentAt: '2026-05-01T10:00:00Z',
      direction: 'inbound',
      senderDomain: 'broker.example',
      senderRole: 'broker',
      subject: null,
      bodyText: m.body,
      attachments: [],
      redactedBodyText: m.body,
      redactedSubject: null,
      piiTokens: [],
    })),
  };
}

describe('extractThreadAnalyses', () => {
  // Week 1 tests run with the LLM layer disabled — they pin the
  // deterministic regex layer only.  The LLM layer is exercised by
  // contract tests against a mocked `extractFromThreadWithLlm` (Week 2+).
  const REGEX_ONLY = { enableLlm: false } as const;

  it('extracts estimate_received with amount + currency', async () => {
    const [analysis] = await extractThreadAnalyses({
      ...REGEX_ONLY,
      threads: [
        buildRedactedThread([
          { id: 'm1', body: 'Please find attached estimate of EUR 30,000 for the repair.' },
        ]),
      ],
    });
    const estimate = analysis.events.find((e) => e.type === 'estimate_received');
    expect(estimate).toBeDefined();
    expect(estimate?.amount).toBe(30000);
    expect(estimate?.currency).toBe('EUR');
    expect(estimate?.citation).toBeDefined();
    expect(estimate?.derivedFrom).toBe('regex');
  });

  it('extracts doc_request and doc_received events', async () => {
    const [analysis] = await extractThreadAnalyses({ ...REGEX_ONLY,
      threads: [
        buildRedactedThread([
          { id: 'm1', body: 'Please provide the police report and photographs ASAP.' },
          { id: 'm2', body: 'Attached the police report you requested.' },
        ]),
      ],
    });
    const docRequests = analysis.events.filter((e) => e.type === 'doc_request');
    expect(docRequests.map((e) => e.documentType).sort()).toEqual(['photographs', 'police_report']);
    const docReceived = analysis.events.filter((e) => e.type === 'doc_received');
    expect(docReceived[0].documentType).toBe('police_report');
  });

  it('detects liability positions (accepted / denied / reserved)', async () => {
    const [analysis] = await extractThreadAnalyses({ ...REGEX_ONLY,
      threads: [
        buildRedactedThread([
          { id: 'm1', body: 'We reserve our position on liability pending further investigation.' },
          { id: 'm2', body: 'We hereby accept liability for the incident.' },
        ]),
      ],
    });
    const liability = analysis.events.filter((e) => e.type === 'liability_position');
    expect(liability.map((e) => e.position)).toEqual(['reserved', 'accepted']);
  });

  it('flags bodily injury as an escalation event', async () => {
    const [analysis] = await extractThreadAnalyses({ ...REGEX_ONLY,
      threads: [
        buildRedactedThread([
          { id: 'm1', body: 'The claimant sustained bodily injury including whiplash; hospital admission noted.' },
        ]),
      ],
    });
    const escalation = analysis.events.find((e) => e.reasonCode === 'BODILY_INJURY_PRESENT');
    expect(escalation).toBeDefined();
    expect(escalation?.type).toBe('escalation');
  });

  it('flags authority-exceeding language as an escalation event', async () => {
    const [analysis] = await extractThreadAnalyses({ ...REGEX_ONLY,
      threads: [
        buildRedactedThread([
          { id: 'm1', body: 'This claim exceeds our binder authority and must be referred to Lloyds.' },
        ]),
      ],
    });
    const escalation = analysis.events.find((e) => e.reasonCode === 'EXCEEDS_AUTHORITY');
    expect(escalation).toBeDefined();
  });

  it('returns the broker domain as a repairer/broker entity when sender role matches', async () => {
    const thread = buildRedactedThread([{ id: 'm1', body: 'Initial communication from broker.' }]);
    // Force the senderRole to repairer for one message.
    thread.messages[0] = { ...thread.messages[0], senderRole: 'repairer', senderDomain: 'big-garage.example' };
    const [analysis] = await extractThreadAnalyses({ ...REGEX_ONLY, threads: [thread] });
    expect(analysis.entities[0]?.type).toBe('repairer');
    expect(analysis.entities[0]?.normalizedName).toBe('big-garage.example');
  });

  it('produces no events for an empty body', async () => {
    const [analysis] = await extractThreadAnalyses({ ...REGEX_ONLY,
      threads: [buildRedactedThread([{ id: 'm1', body: '' }])],
    });
    expect(analysis.events).toEqual([]);
  });
});

/**
 * redactPii.test — Week 1 deterministic redaction coverage (ADR-0041 §4).
 *
 * The redaction map is intentionally aggressive (over-redact rather than
 * leak).  These tests pin the pseudonym shape (`[TYPE_##]`) and the
 * stable-within-thread property — the same raw token gets the same
 * pseudonym across messages in a thread so the LLM can reason about
 * "the same person across multiple emails".
 */

import { describe, expect, it } from 'vitest';
import { redactThreads } from '../redactPii.js';
import type { NormalizedThread } from '../normalizeThreads.js';

function buildThread(messages: Array<{ id: string; body: string; subject?: string }>): NormalizedThread {
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
      subject: m.subject ?? null,
      bodyText: m.body,
      attachments: [],
    })),
  };
}

describe('redactThreads', () => {
  it('replaces email addresses with stable [EMAIL_##] pseudonyms', () => {
    const [redacted] = redactThreads([
      buildThread([
        { id: 'm1', body: 'Please contact peter@abbeygate.cy regarding claim.' },
        { id: 'm2', body: 'Cc peter@abbeygate.cy and john.doe@broker.example for response.' },
      ]),
    ]);
    expect(redacted.messages[0].redactedBodyText).toContain('[EMAIL_01]');
    expect(redacted.messages[0].redactedBodyText).not.toContain('peter@abbeygate.cy');
    expect(redacted.messages[1].redactedBodyText).toContain('[EMAIL_01]');
    expect(redacted.messages[1].redactedBodyText).toContain('[EMAIL_02]');
  });

  it('replaces vehicle registrations with [VEHICLE_REG_##]', () => {
    const [redacted] = redactThreads([
      buildThread([{ id: 'm1', body: 'Vehicle reg ABC123 was involved in the collision.' }]),
    ]);
    expect(redacted.messages[0].redactedBodyText).toContain('[VEHICLE_REG_01]');
    expect(redacted.messages[0].redactedBodyText).not.toContain('ABC123');
  });

  it('replaces IBANs with [IBAN_##]', () => {
    const [redacted] = redactThreads([
      buildThread([{ id: 'm1', body: 'Please send payment to GB29NWBK60161331926819 for the repair.' }]),
    ]);
    expect(redacted.messages[0].redactedBodyText).toContain('[IBAN_01]');
    expect(redacted.messages[0].redactedBodyText).not.toContain('GB29NWBK60161331926819');
  });

  it('replaces person names with [PERSON_##] AFTER emails are pseudonymised', () => {
    const [redacted] = redactThreads([
      buildThread([{ id: 'm1', body: 'John Smith reported the loss to Mary Jones on Monday.' }]),
    ]);
    // John Smith / Mary Jones should be pseudonymised
    expect(redacted.messages[0].redactedBodyText).toMatch(/\[PERSON_01\]/);
    expect(redacted.messages[0].redactedBodyText).toMatch(/\[PERSON_02\]/);
    expect(redacted.messages[0].redactedBodyText).not.toContain('John Smith');
    expect(redacted.messages[0].redactedBodyText).not.toContain('Mary Jones');
  });

  it('preserves pseudonym stability across messages in the same thread', () => {
    const [redacted] = redactThreads([
      buildThread([
        { id: 'm1', body: 'John Smith is the policyholder.' },
        { id: 'm2', body: 'Please respond to John Smith directly.' },
      ]),
    ]);
    const firstBody = redacted.messages[0].redactedBodyText;
    const secondBody = redacted.messages[1].redactedBodyText;
    const johnTokenMatch1 = firstBody.match(/\[PERSON_\d{2}\]/);
    const johnTokenMatch2 = secondBody.match(/\[PERSON_\d{2}\]/);
    expect(johnTokenMatch1?.[0]).toEqual(johnTokenMatch2?.[0]);
  });

  it('does not re-pseudonymise tokens that already look like pseudonyms', () => {
    const [redacted] = redactThreads([
      buildThread([{ id: 'm1', body: 'Token [EMAIL_01] is referenced again.' }]),
    ]);
    expect(redacted.messages[0].redactedBodyText).toBe('Token [EMAIL_01] is referenced again.');
  });

  it('retains a reversible piiTokens map alongside each message', () => {
    const [redacted] = redactThreads([
      buildThread([{ id: 'm1', body: 'Contact peter@abbeygate.cy or +357 99 123456.' }]),
    ]);
    const tokens = redacted.messages[0].piiTokens;
    const emailToken = tokens.find((t) => t.type === 'EMAIL');
    expect(emailToken?.original.toLowerCase()).toBe('peter@abbeygate.cy');
  });
});

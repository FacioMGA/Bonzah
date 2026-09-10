/* @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import {
  describeFailureZoneTiming,
  getFailureZoneSignalCopy,
  getSimilarEvidenceCopy,
  summarizeFailureZone,
} from '../failureZoneCopy';
import type { FailureZoneSignal } from '../UnderwritingTab.types';

// Codes mirrored from the canonical owner:
// `loadFailureZoneSnapshot` in `backend/platform/behavior/http/behaviorRouter.ts`.
// Every code emitted by the spine MUST resolve to operator-friendly copy here.
// ABY-263 — `BEHAVIOR_TRAJECTORY_MISSING` was removed from the operator
// failure zone (diagnostic-only signal that previously fired
// "Operational watch" with copy that explicitly said "Customer is
// unaffected. No customer-facing action needed.").
const KNOWN_SIGNAL_CODES = [
  'PAID_WITHOUT_INCEPTION',
  'INCEPTION_PENDING_DOCS_SLA',
  'ISSUED_DOCS_MISSING_SLA',
  'ISSUED_PACK_MISSING_DOC_TYPES',
  'WELCOME_EMAIL_FAILED',
  'WELCOME_EMAIL_PENDING_SLA',
  'UNHEALTHY_BEHAVIOR_TRAJECTORY',
  // ABY-268 — `FNOL_LINK_DELIVERY_FAILED` is emitted by
  // `loadFailureZoneSnapshot` when any claim on this policy has a
  // FAILED FNOL intake link `CommunicationMessage`. Mirrors the
  // `WELCOME_EMAIL_FAILED` shape (alert severity, operator copy
  // points at the claim case page + email provider).
  'FNOL_LINK_DELIVERY_FAILED',
] as const;

describe('failureZoneCopy.getFailureZoneSignalCopy', () => {
  it.each(KNOWN_SIGNAL_CODES)(
    'returns operator-friendly copy for %s',
    (code) => {
      const copy = getFailureZoneSignalCopy({ code, severity: 'alert', message: 'tech message' });
      expect(copy.whatsHappening.length).toBeGreaterThan(20);
      expect(copy.nextAction.length).toBeGreaterThan(20);
      // Operator copy must NOT echo the raw code or be identical to the
      // technical message — that's the bug ABY-231 is fixing.
      expect(copy.whatsHappening.toUpperCase()).not.toContain(code);
      expect(copy.nextAction.toUpperCase()).not.toContain(code);
      expect(copy.whatsHappening).not.toBe('tech message');
      expect(copy.nextAction).not.toBe('tech message');
    },
  );

  it('returns a fallback (still useful) for an unknown signal code', () => {
    const copy = getFailureZoneSignalCopy({ code: 'NEW_FUTURE_SIGNAL', severity: 'watch' });
    expect(copy.whatsHappening).toBeTruthy();
    expect(copy.nextAction).toMatch(/platform-eng/i);
  });

  it('payment + welcome-email signals point at the Communications tab so the operator knows where to act', () => {
    const welcome = getFailureZoneSignalCopy({ code: 'WELCOME_EMAIL_FAILED', severity: 'alert' });
    expect(welcome.nextAction.toLowerCase()).toContain('communications');
    const pending = getFailureZoneSignalCopy({ code: 'WELCOME_EMAIL_PENDING_SLA', severity: 'watch' });
    expect(pending.nextAction.toLowerCase()).toContain('communications');
  });

  it('FNOL_LINK_DELIVERY_FAILED points at the Claim case page + Resend FNOL link (ABY-268)', () => {
    // ABY-268 — when the customer-email worker exhausts retries the
    // operator surface needs a concrete next step. The copy must
    // direct them to the claim view (not the policy communications
    // tab — the FNOL link is a claim concern) and explicitly mention
    // the Resend affordance.
    const copy = getFailureZoneSignalCopy({ code: 'FNOL_LINK_DELIVERY_FAILED', severity: 'alert' });
    expect(copy.whatsHappening.toLowerCase()).toMatch(/fnol|intake link/);
    expect(copy.nextAction.toLowerCase()).toMatch(/claim/);
    expect(copy.nextAction.toLowerCase()).toMatch(/resend/);
  });

  it('BEHAVIOR_TRAJECTORY_MISSING falls through to the generic fallback (ABY-263)', () => {
    // ABY-263 — the diagnostic-only `BEHAVIOR_TRAJECTORY_MISSING` signal
    // is no longer emitted by `loadFailureZoneSnapshot`, so we no
    // longer carry a dedicated copy row for it. If something ever
    // re-emits the code it now resolves to the unknown-signal
    // fallback (which directs the operator to platform-eng), instead
    // of a custom row that lived solely to tell operators "no
    // customer-facing action needed".
    const copy = getFailureZoneSignalCopy({ code: 'BEHAVIOR_TRAJECTORY_MISSING', severity: 'watch' });
    expect(copy.nextAction.toLowerCase()).toMatch(/platform-eng/i);
    expect(copy.whatsHappening.toLowerCase()).not.toContain('diagnostic');
  });
});

describe('failureZoneCopy.describeFailureZoneTiming', () => {
  it('formats paid + SLA window when both are present', () => {
    const signal: FailureZoneSignal = {
      code: 'WELCOME_EMAIL_PENDING_SLA',
      severity: 'watch',
      details: { paidAtMinutes: 27, slaMinutes: 15, issuedDocCount: 3 },
    };
    expect(describeFailureZoneTiming(signal)).toBe('Paid 27 min ago — SLA 15 min');
  });

  it('formats inception age when paidAt is not present', () => {
    const signal: FailureZoneSignal = {
      code: 'INCEPTION_PENDING_DOCS_SLA',
      severity: 'alert',
      details: { inceptionAgeMinutes: 90, slaMinutes: 15 },
    };
    expect(describeFailureZoneTiming(signal)).toBe('Inception aged 1h 30m — SLA 15 min');
  });

  it('returns null when no useful timing details exist', () => {
    const signal: FailureZoneSignal = { code: 'WELCOME_EMAIL_FAILED', severity: 'alert' };
    expect(describeFailureZoneTiming(signal)).toBeNull();
  });

  it('formats long durations as days', () => {
    const signal: FailureZoneSignal = {
      code: 'PAID_WITHOUT_INCEPTION',
      severity: 'alert',
      details: { paidAtMinutes: 60 * 24 * 2 + 30, slaMinutes: 15 },
    };
    expect(describeFailureZoneTiming(signal)).toMatch(/Paid 2d/);
  });
});

describe('failureZoneCopy.summarizeFailureZone', () => {
  it('uses the highest-severity signal copy as the lede', () => {
    const summary = summarizeFailureZone({
      severity: 'alert',
      signals: [
        { code: 'UNHEALTHY_BEHAVIOR_TRAJECTORY', severity: 'watch' },
        { code: 'WELCOME_EMAIL_FAILED', severity: 'alert' },
      ],
      hasSimilarEvidence: false,
    });
    expect(summary.toLowerCase()).toContain('welcome email');
  });

  it('falls back to a watch sentence when there are only similar-evidence cases', () => {
    const summary = summarizeFailureZone({
      severity: 'watch',
      signals: [],
      hasSimilarEvidence: true,
    });
    expect(summary.toLowerCase()).toContain('similar');
  });

  it('falls back to a generic alert sentence with no signals or evidence', () => {
    const summary = summarizeFailureZone({
      severity: 'alert',
      signals: [],
      hasSimilarEvidence: false,
    });
    expect(summary).toBeTruthy();
    expect(summary.toLowerCase()).toContain('failure signals');
  });
});

describe('failureZoneCopy.getSimilarEvidenceCopy', () => {
  // ABY-231 follow-up: when the banner fires only because past similar
  // policies needed follow-up, operators must still see a concrete
  // "what to do next" — not just a vague "operational follow-up needed"
  // header with no actionable guidance.
  it.each(['alert', 'watch'] as const)(
    'returns concrete what-happened + next-action copy for %s severity',
    (severity) => {
      const copy = getSimilarEvidenceCopy(severity);
      expect(copy.whatsHappening.length).toBeGreaterThan(40);
      expect(copy.nextAction.length).toBeGreaterThan(40);
      // Must clearly state this is similarity-based, not a hard failure on
      // the policy — so the operator does not panic.
      expect(copy.whatsHappening.toLowerCase()).toMatch(/no (hard )?failure|early-warning|past polic/);
      // Must point at concrete operator surfaces (feed / communications /
      // outreach) rather than only abstract language.
      expect(copy.nextAction.toLowerCase()).toMatch(/feed|communications|outreach|customer/);
    },
  );

  it('alert tone reads more urgent than watch tone', () => {
    const alert = getSimilarEvidenceCopy('alert');
    const watch = getSimilarEvidenceCopy('watch');
    expect(alert.nextAction).not.toBe(watch.nextAction);
    expect(alert.nextAction.toLowerCase()).toMatch(/now|proactive|before the customer/);
  });
});

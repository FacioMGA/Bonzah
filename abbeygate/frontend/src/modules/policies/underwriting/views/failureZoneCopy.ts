// Operator-facing copy for behavior failure-zone signals.
//
// The canonical owner of failure-zone signals is the backend
// `loadFailureZoneSnapshot` in `backend/platform/behavior/http/behaviorRouter.ts`,
// which emits `{ code, severity, message, details }` per signal.
// That projection is the single source of truth for *what fired*.
//
// This module is **derived UI state**: it converts each canonical `code` into
// two operator-friendly lines that explain (a) why this needs follow-up in
// plain English and (b) the concrete next step. It does not recompute
// severity, decide eligibility, or shadow any business rule — it only renders
// guidance for a signal that already exists.
//
// New signal codes added on the backend should get a row here. The fallback
// keeps the UI useful but unhelpful, so missing rows are easy to spot.

import type { FailureZoneSignal } from './UnderwritingTab.types';

export type FailureZoneSignalCopy = {
  whatsHappening: string;
  nextAction: string;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatMinutes(minutes: number | null): string | null {
  if (minutes === null || minutes < 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours === 0 ? `${days}d` : `${days}d ${remHours}h`;
}

/**
 * Optional one-line timing context derived from `signal.details`.
 *
 * Returns a short, operator-friendly hint such as
 * "Paid 27 min ago — SLA 15 min" so the operator can see at a glance
 * how far past the SLA window the policy is. Returns `null` when the
 * signal has no useful timing details.
 */
export function describeFailureZoneTiming(signal: FailureZoneSignal): string | null {
  const details = asRecord(signal.details);
  const sla = readNumber(details.slaMinutes);
  const slaText = sla !== null ? `SLA ${formatMinutes(sla)}` : null;

  const paidAt = readNumber(details.paidAtMinutes);
  if (paidAt !== null) {
    const paid = formatMinutes(paidAt);
    if (paid) return [`Paid ${paid} ago`, slaText].filter(Boolean).join(' — ');
  }

  const inceptionAge = readNumber(details.inceptionAgeMinutes);
  if (inceptionAge !== null) {
    const aged = formatMinutes(inceptionAge);
    if (aged) return [`Inception aged ${aged}`, slaText].filter(Boolean).join(' — ');
  }

  return null;
}

const ISSUANCE_STUCK_HINT =
  'Open #ops-issuance with the policy number and re-trigger the issued-pack worker (or run a behavior replay). Manual issuance is the fallback.';

/**
 * Map a failure-zone signal `code` to operator-facing copy.
 *
 * The technical message from the backend is preserved by the caller
 * as supporting detail; this mapping is the *plain-English* layer.
 */
export function getFailureZoneSignalCopy(signal: FailureZoneSignal): FailureZoneSignalCopy {
  const code = String(signal.code || '').trim().toUpperCase();
  switch (code) {
    case 'PAID_WITHOUT_INCEPTION':
      return {
        whatsHappening:
          'The customer has paid, but the inception (binding) transaction never landed. The policy is not yet legally bound.',
        nextAction:
          'Verify the payment in the billing tab, then trigger inception manually or escalate to platform-eng. Do not refund without confirming binding state.',
      };
    case 'INCEPTION_PENDING_DOCS_SLA':
      return {
        whatsHappening:
          'Inception is bound but stuck waiting for the issued-pack documents. The customer is paid and bound, but has nothing to show for it.',
        nextAction: ISSUANCE_STUCK_HINT,
      };
    case 'ISSUED_DOCS_MISSING_SLA':
      return {
        whatsHappening:
          'The customer has paid but no policy documents were generated. They likely cannot find proof of cover.',
        nextAction: ISSUANCE_STUCK_HINT,
      };
    case 'ISSUED_PACK_MISSING_DOC_TYPES':
      return {
        whatsHappening:
          'The issued-pack worker ran but the resulting document set is incomplete (e.g. missing certificate or schedule).',
        nextAction:
          'Open the policy documents tab to check what is missing, then re-run the issued-pack worker. Confirm the binder template is configured for this product.',
      };
    case 'WELCOME_EMAIL_FAILED':
      return {
        whatsHappening:
          'The customer paid and the policy was issued, but the welcome email did not deliver — they likely have not received their documents.',
        nextAction:
          'Resend the welcome email from the Communications tab. If it fails again, verify the email address with the customer and check the email provider for bounces.',
      };
    case 'WELCOME_EMAIL_PENDING_SLA':
      return {
        whatsHappening:
          'Documents are issued but no welcome email has been recorded. The customer may not know their policy is active.',
        nextAction:
          'Trigger the welcome email manually from the Communications tab and confirm the customer receives it.',
      };
    case 'FNOL_LINK_DELIVERY_FAILED':
      return {
        whatsHappening:
          'The FNOL intake link email failed to deliver after the worker retry budget. The customer never received the link, so the claim is silently stuck waiting on a response that cannot arrive.',
        nextAction:
          'Open the Claim case page and verify the policyholder email, then use Resend FNOL link. If it fails again, check the email provider for bounces and reach out via an alternate channel.',
      };
    case 'UNHEALTHY_BEHAVIOR_TRAJECTORY':
      return {
        whatsHappening:
          'The recent activity pattern on this policy is similar to policies that later cancelled or escalated. This is an early-warning signal, not a hard failure.',
        nextAction:
          'Review the recent communications and feed for unanswered customer questions or repeated friction. Consider a proactive outreach.',
      };
    default:
      return {
        whatsHappening:
          'A behavior signal fired on this policy that does not yet have an operator playbook.',
        nextAction:
          'Forward the signal code below to platform-eng so a runbook entry can be added.',
      };
  }
}

/**
 * Lede sentence shown directly under the banner title.
 *
 * Picks the most actionable signal (alert beats watch, then preserves
 * canonical order) and returns the operator-friendly summary for it.
 * Falls back to a generic line when there are no signals (e.g. when the
 * banner is only being shown because of similar-failure evidence).
 */
export function summarizeFailureZone(args: {
  severity: 'alert' | 'watch';
  signals: FailureZoneSignal[];
  hasSimilarEvidence: boolean;
}): string {
  const { severity, signals, hasSimilarEvidence } = args;
  const ranked = [...signals].sort((a, b) => {
    const rank = (s: FailureZoneSignal) => (s.severity === 'alert' ? 2 : s.severity === 'watch' ? 1 : 0);
    return rank(b) - rank(a);
  });
  const primary = ranked[0];
  if (primary) return getFailureZoneSignalCopy(primary).whatsHappening;
  if (hasSimilarEvidence) return getSimilarEvidenceCopy(severity).whatsHappening;
  return severity === 'alert'
    ? 'This policy has one or more failure signals that need a manual check before the customer notices.'
    : 'This policy shows early-warning signals worth checking before they become customer-facing.';
}

/**
 * Copy for the similar-evidence-only branch of the banner — fired when the
 * backend has no hard failure signal on *this* policy but flagged it because
 * past policies with the same activity pattern needed manual follow-up.
 *
 * Without this, the operator sees "Operational follow-up needed" with no
 * concrete reason and no next step — the original ABY-231 complaint. This
 * mirrors the per-signal `{ whatsHappening, nextAction }` shape so the
 * banner can render the same guidance card layout in both branches.
 */
export function getSimilarEvidenceCopy(severity: 'alert' | 'watch'): FailureZoneSignalCopy {
  if (severity === 'alert') {
    return {
      whatsHappening:
        'No hard failure marker on this policy yet, but past policies with the same activity pattern needed manual follow-up before the customer noticed. This banner is a heads-up, not a confirmed failure.',
      nextAction:
        'Open the policy feed and Communications tab and scan for unanswered customer questions, missing documents, or repeated friction. If everything looks healthy, dismiss the banner. Otherwise reach out proactively before the customer notices.',
    };
  }
  return {
    whatsHappening:
      'Past policies with a similar activity pattern needed operational follow-up. No failure has happened on this policy yet — this is an early-warning pattern, not a confirmed problem.',
    nextAction:
      'Spot-check the recent activity feed and any open customer messages. Usually nothing, but worth 30 seconds — if anything looks off, treat it as a regular follow-up before it escalates.',
  };
}

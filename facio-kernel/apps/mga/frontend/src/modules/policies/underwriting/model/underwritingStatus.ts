export type UnderwritingDisplayState =
  | 'NOT_STARTED'
  | 'CUSTOMER_STARTED'
  | 'UW_STARTED'
  | 'QUESTIONNAIRE_SENT'
  | 'FOLLOWUPS_OPEN'
  | 'QUOTE_READY'
  | 'COMPLETE'
  | 'PARTIALLY_COMPLETED';

type LastSavedBy = 'customer' | 'underwriter' | 'system' | '';

export function buildUnderwritingStatusLines(args: {
  state: UnderwritingDisplayState;
  questionnaireSentAtText?: string;
  followUpsSentAtText?: string;
  customerStartedAtText?: string;
  uwStartedAtText?: string;
  lastSavedBy?: LastSavedBy;
  lastSavedByName?: string;
  lastSavedAtText?: string;
  completedCount?: number;
  emptyCount?: number;
}): string[] {
  const state = args.state;
  const questionnaireSentAtText = String(args.questionnaireSentAtText || '').trim();
  const followUpsSentAtText = String(args.followUpsSentAtText || '').trim();
  const customerStartedAtText = String(args.customerStartedAtText || '').trim();
  const uwStartedAtText = String(args.uwStartedAtText || '').trim();
  const lastSavedAtText = String(args.lastSavedAtText || '').trim();
  const lastSavedBy = (args.lastSavedBy || '').trim() as LastSavedBy;
  const lastSavedByName = String(args.lastSavedByName || '').trim();
  const completedCount = Number(args.completedCount || 0);
  const emptyCount = Number(args.emptyCount || 0);
  const completionLine = completedCount > 0 || emptyCount > 0
    ? `${completedCount} completed field${completedCount === 1 ? '' : 's'} · ${emptyCount} empty field${emptyCount === 1 ? '' : 's'}.`
    : 'Not yet complete.';

  if (state === 'FOLLOWUPS_OPEN') {
    return [
      `Follow-up questions sent to customer${followUpsSentAtText ? ` on ${followUpsSentAtText}` : ''}.`,
      'Waiting for customer response.',
    ];
  }

  if (state === 'QUESTIONNAIRE_SENT') {
    const lines = [
      `Questionnaire sent to customer${questionnaireSentAtText ? ` on ${questionnaireSentAtText}` : ''}.`,
      'Waiting for customer completion.',
    ];
    // Show UW actor line only when underwriting tab work actually started.
    if (uwStartedAtText && lastSavedByName) {
      lines.push(`${lastSavedByName} started entering underwriting information on ${uwStartedAtText}.`);
    } else if (lastSavedAtText && lastSavedBy === 'customer') {
      lines.push(`Last update by Customer on ${lastSavedAtText}.`);
    }
    return lines;
  }

  if (state === 'CUSTOMER_STARTED') {
    return [
      `Customer started the questionnaire${customerStartedAtText ? ` on ${customerStartedAtText}` : ''}.`,
      'Not yet submitted.',
    ];
  }

  if (state === 'UW_STARTED' || state === 'PARTIALLY_COMPLETED') {
    const actorName = lastSavedByName.trim();
    return [
      `${actorName || 'Underwriter'} started entering underwriting information${uwStartedAtText ? ` on ${uwStartedAtText}` : ''}.`,
      completionLine,
    ];
  }

  return ['Underwriting has not started yet.'];
}

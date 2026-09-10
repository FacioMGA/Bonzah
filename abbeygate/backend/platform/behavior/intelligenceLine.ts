/**
 * Intelligence line — the *single sentence* that surfaces at the top of the
 * Policy Behavior view.
 *
 * Two design constraints:
 *   1. Deterministic. Same direction + score → same sentence. The user must
 *      be able to spot-check it without reading the full timeline.
 *   2. Human, not metricky. The line answers "what is this policy doing now?"
 *      not "what is its drift score?".
 */

export type IntelligenceLineInput = {
  direction: string;
  driftScore: number;
  eventCount: number;
};

function intensityWord(score: number): string {
  if (score >= 0.85) return 'sharply';
  if (score >= 0.65) return 'clearly';
  if (score >= 0.4) return 'noticeably';
  return 'mildly';
}

export function buildIntelligenceLine(input: IntelligenceLineInput): string {
  const score = Math.max(0, Math.min(1, Number(input.driftScore || 0)));

  if (input.eventCount === 0) {
    return 'No behavior recorded yet for this policy.';
  }

  switch (input.direction) {
    case 'DRIFT_TO_CANCELLATION':
      return `This policy is ${intensityWord(score)} drifting toward cancellation based on recent behavior.`;
    case 'DRIFT_TO_RENEWAL':
      return `This policy is ${intensityWord(score)} trending toward renewal based on recent behavior.`;
    case 'DRIFT_TO_FRAUD_FLAG':
      return `This policy is ${intensityWord(score)} showing patterns associated with fraud risk.`;
    case 'HEALTHY':
    default:
      return 'This policy is moving along a healthy trajectory.';
  }
}

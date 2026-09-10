/**
 * Synthetic email recipient allowlist (ADR-0067 follow-up — email safety rails).
 *
 * A SYNTHETIC email (issuance-proof canary, Email Preview & Testing Centre
 * "send test", or any other automated/test message) must ONLY ever be
 * deliverable to an explicitly allowlisted test mailbox. This is the last-line
 * guardrail: even if some future caller forgets to point a synthetic run at a
 * sink, the transport refuses to deliver it to a real customer or staff address.
 *
 * The allowlist is intentionally CLOSED by default — an unknown recipient on a
 * synthetic message is blocked, never delivered. This is the same fail-closed
 * stance the sanctions gate takes: when in doubt, do not send.
 */

/** Normalise an email for comparison (trim + lowercase). */
function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolve the configured allowlist from the environment. Entries are
 * comma-separated and may be either:
 *  - a full address (`qa+proof@facio.io`), matched case-insensitively, or
 *  - a domain suffix beginning with `@` (`@facio.io`), matching any mailbox at
 *    that domain.
 *
 * Only the issuance-proof WELCOME sink is auto-included: it is the non-human
 * sub-address reserved for routine synthetic mail (docs/operate/monitoring.md).
 * `ISSUANCE_PROOF_ALERT_TO` is deliberately NOT auto-included — it is a HUMAN
 * inbox that must only ever receive real failure alerts, never a synthetic
 * "policy issued" welcome. If the welcome sink is misconfigured and the proof
 * script falls back to the alert address, this guard then fail-closes and
 * blocks the synthetic welcome rather than delivering a fake policy to a person.
 */
/**
 * Non-human mailbox that must receive every synthetic issuance-proof welcome
 * email. Required whenever `source === 'ISSUANCE_PROOF'` dispatches customer
 * mail — the orchestrator routes there instead of the policy contact so a
 * missing or misconfigured sink fails loudly instead of falling back to a
 * human alert inbox (which the transport allowlist blocks).
 */
export function resolveIssuanceProofWelcomeTo(env: NodeJS.ProcessEnv = process.env): string {
  const sink = String(env.ISSUANCE_PROOF_WELCOME_TO || '').trim();
  if (!sink) {
    throw new Error('ISSUANCE_PROOF_WELCOME_TO is required for issuance-proof welcome email dispatch');
  }
  return sink;
}

export function getSyntheticAllowlistFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = String(env.SYNTHETIC_EMAIL_ALLOWLIST || '');
  const configured = raw
    .split(',')
    .map((entry) => normalizeEmail(entry))
    .filter((entry) => entry.length > 0);

  const proofSinks = [env.ISSUANCE_PROOF_WELCOME_TO]
    .map((entry) => normalizeEmail(String(entry || '')))
    .filter((entry) => entry.length > 0);

  return Array.from(new Set([...configured, ...proofSinks]));
}

/** Pure allowlist check: exact address match or `@domain` suffix match. */
export function isRecipientAllowedForSynthetic(email: string, allowlist: string[]): boolean {
  const candidate = normalizeEmail(email);
  if (!candidate) return false;
  const atIndex = candidate.lastIndexOf('@');
  const domain = atIndex >= 0 ? candidate.slice(atIndex) : '';
  for (const entry of allowlist) {
    if (entry.startsWith('@')) {
      if (domain && domain === entry) return true;
    } else if (entry === candidate) {
      return true;
    }
  }
  return false;
}

export interface SyntheticRecipientCheck {
  ok: boolean;
  /** Recipients that are NOT on the allowlist (empty when ok). */
  blocked: string[];
  /** The allowlist that was applied (for diagnostics). */
  allowlist: string[];
}

/**
 * Assert every recipient of a synthetic message is allowlisted. Fail-closed:
 * an empty recipient set or an empty allowlist yields `ok: false` so a
 * synthetic message can never slip out to a non-test address.
 */
export function assertSyntheticRecipientsAllowed(
  recipients: string[],
  env: NodeJS.ProcessEnv = process.env,
): SyntheticRecipientCheck {
  const allowlist = getSyntheticAllowlistFromEnv(env);
  const blocked = recipients.filter((r) => !isRecipientAllowedForSynthetic(r, allowlist));
  return { ok: recipients.length > 0 && blocked.length === 0, blocked, allowlist };
}

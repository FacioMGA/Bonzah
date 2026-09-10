import { describe, expect, it } from 'vitest';
import {
  assertSyntheticRecipientsAllowed,
  getSyntheticAllowlistFromEnv,
  isRecipientAllowedForSynthetic,
  resolveIssuanceProofWelcomeTo,
} from '../syntheticRecipientAllowlist.js';

describe('syntheticRecipientAllowlist', () => {
  describe('getSyntheticAllowlistFromEnv', () => {
    it('parses the comma-separated list and auto-includes only the WELCOME sink', () => {
      const env: NodeJS.ProcessEnv = {
        SYNTHETIC_EMAIL_ALLOWLIST: 'qa+one@facio.io, @test.abbeygate.cy ',
        ISSUANCE_PROOF_WELCOME_TO: 'FacioMGA+issuanceproof@facio.io',
        ISSUANCE_PROOF_ALERT_TO: 'alerts@facio.io',
      };
      const list = getSyntheticAllowlistFromEnv(env);
      expect(list).toEqual(
        expect.arrayContaining([
          'qa+one@facio.io',
          '@test.abbeygate.cy',
          'faciomga+issuanceproof@facio.io',
        ]),
      );
    });

    it('never auto-includes the human ALERT inbox (synthetic welcome must not reach a person)', () => {
      const env: NodeJS.ProcessEnv = {
        ISSUANCE_PROOF_WELCOME_TO: 'FacioMGA+issuanceproof@facio.io',
        ISSUANCE_PROOF_ALERT_TO: 'alerts@facio.io',
      };
      const list = getSyntheticAllowlistFromEnv(env);
      expect(list).not.toContain('alerts@facio.io');
      expect(isRecipientAllowedForSynthetic('alerts@facio.io', list)).toBe(false);
    });

    it('resolveIssuanceProofWelcomeTo returns the configured non-human sink', () => {
      expect(resolveIssuanceProofWelcomeTo({
        ISSUANCE_PROOF_WELCOME_TO: 'FacioMGA+issuanceproof@facio.io',
      })).toBe('FacioMGA+issuanceproof@facio.io');
    });

    it('resolveIssuanceProofWelcomeTo fails closed when the sink is missing', () => {
      expect(() => resolveIssuanceProofWelcomeTo({})).toThrow(/ISSUANCE_PROOF_WELCOME_TO is required/);
    });

    it('returns an empty list when nothing is configured', () => {
      const emptyEnv: NodeJS.ProcessEnv = {};
      expect(getSyntheticAllowlistFromEnv(emptyEnv)).toEqual([]);
    });
  });

  describe('isRecipientAllowedForSynthetic', () => {
    const allowlist = ['qa@facio.io', '@sink.facio.io'];

    it('matches an exact address case-insensitively', () => {
      expect(isRecipientAllowedForSynthetic('QA@Facio.io', allowlist)).toBe(true);
    });

    it('matches a domain-suffix entry', () => {
      expect(isRecipientAllowedForSynthetic('anything@sink.facio.io', allowlist)).toBe(true);
    });

    it('does not treat a domain entry as a substring match', () => {
      // `@sink.facio.io` must NOT match `x@evil-sink.facio.io.attacker.com`
      expect(isRecipientAllowedForSynthetic('x@evil-sink.facio.io.attacker.com', allowlist)).toBe(false);
    });

    it('blocks a real customer / staff address', () => {
      expect(isRecipientAllowedForSynthetic('theo@abbeygate.cy', allowlist)).toBe(false);
      expect(isRecipientAllowedForSynthetic('customer@gmail.com', allowlist)).toBe(false);
    });

    it('blocks empty / malformed input', () => {
      expect(isRecipientAllowedForSynthetic('', allowlist)).toBe(false);
      expect(isRecipientAllowedForSynthetic('   ', allowlist)).toBe(false);
    });
  });

  describe('assertSyntheticRecipientsAllowed (fail-closed)', () => {
    const env: NodeJS.ProcessEnv = { SYNTHETIC_EMAIL_ALLOWLIST: 'qa@facio.io' };

    it('passes only when every recipient is allowlisted', () => {
      const ok = assertSyntheticRecipientsAllowed(['qa@facio.io'], env);
      expect(ok.ok).toBe(true);
      expect(ok.blocked).toEqual([]);
    });

    it('reports the blocked recipients and fails when any is not allowlisted', () => {
      const res = assertSyntheticRecipientsAllowed(['qa@facio.io', 'theo@abbeygate.cy'], env);
      expect(res.ok).toBe(false);
      expect(res.blocked).toEqual(['theo@abbeygate.cy']);
    });

    it('fails closed for an empty recipient list', () => {
      expect(assertSyntheticRecipientsAllowed([], env).ok).toBe(false);
    });

    it('fails closed when the allowlist itself is empty', () => {
      const noEnv: NodeJS.ProcessEnv = {};
      const res = assertSyntheticRecipientsAllowed(['qa@facio.io'], noEnv);
      expect(res.ok).toBe(false);
    });
  });
});

/**
 * Pins the disambiguation envelope shape returned by Operator MCP
 * tools when free-text entity resolution finds 2+ candidates
 * (ADR-0036 amendment #2 §5, spec §2A).
 */
import { describe, expect, it } from 'vitest';
import { extractEmailFromContact, maskEmail } from '../domain/operatorEnvelope.js';
import type {
    OperatorCandidate,
    OperatorDisambiguationEnvelope,
} from '../domain/operatorEnvelope.js';

describe('OperatorDisambiguationEnvelope shape', () => {
    it('carries ok=false, the structured status, summary, and candidates[]', () => {
        const env: OperatorDisambiguationEnvelope = {
            ok: false,
            status: 'needs_disambiguation',
            summary: 'Multiple matching customers found.',
            candidates: [
                {
                    id: 'ph-1',
                    kind: 'customer',
                    label: 'Hellen Catherine',
                    emailMasked: 'he******@example.com',
                    annotations: { active_policies: 2 },
                },
                {
                    id: 'ph-2',
                    kind: 'customer',
                    label: 'Hellen Catherine',
                    emailMasked: 'h.******@elsewhere.com',
                    annotations: { active_policies: 0 },
                },
            ],
        };
        expect(env.ok).toBe(false);
        expect(env.status).toBe('needs_disambiguation');
        expect(env.candidates).toHaveLength(2);
        expect(env.candidates.every((c: OperatorCandidate) => c.kind === 'customer')).toBe(true);
    });
});

describe('maskEmail', () => {
    it('reveals the first two characters of the local part', () => {
        expect(maskEmail('uriel.aharony@gmail.com')).toBe('ur***********@gmail.com');
    });

    it('handles short local parts gracefully (reveals 1 char when local length ≤ 2)', () => {
        expect(maskEmail('a@example.com')).toBe('a*@example.com');
        expect(maskEmail('ab@example.com')).toBe('a*@example.com');
    });

    it('returns undefined for missing / malformed input', () => {
        expect(maskEmail(undefined)).toBeUndefined();
        expect(maskEmail(null)).toBeUndefined();
        expect(maskEmail('')).toBeUndefined();
        expect(maskEmail('no-at-sign')).toBeUndefined();
    });

    it('rejects JSON-blob input rather than partially masking it (PII fail-closed)', () => {
        // Regression: 2026-05-28 incident — `PolicyHolder.contact`
        // rows carrying a JSON-stringified blob were being fed verbatim
        // to maskEmail, which masked only the leading characters and
        // leaked passport numbers, DOBs, phones, and addresses in the
        // trailing JSON. Strict RFC-ish regex now fail-closes.
        const jsonBlob = '{"email":"victim@example.com","phone":"+972502440556","idnumber":"13515315","dateofbirth":"1987-04-18"}';
        expect(maskEmail(jsonBlob)).toBeUndefined();
    });
});

describe('extractEmailFromContact (PolicyHolder.contact normaliser)', () => {
    it('passes through a bare email unchanged', () => {
        expect(extractEmailFromContact('foo@example.com')).toBe('foo@example.com');
    });

    it('lowercases the bare email', () => {
        expect(extractEmailFromContact('Foo.Bar@Example.com')).toBe('foo.bar@example.com');
    });

    it('extracts email from a JSON-blob contact', () => {
        const blob = '{"email":"target@example.com","phone":"+972...","idnumber":"X"}';
        expect(extractEmailFromContact(blob)).toBe('target@example.com');
    });

    it('handles capitalised JSON keys (Email)', () => {
        const blob = '{"Email":"target@example.com","phone":"+972..."}';
        expect(extractEmailFromContact(blob)).toBe('target@example.com');
    });

    it('falls back to regex when JSON parse fails but an email is embedded', () => {
        // Real-world: comma-separated, truncated, or otherwise malformed
        // contacts that still contain a valid email substring.
        const garbage = 'name=Foo, email=needle@example.com, phone=+972...';
        expect(extractEmailFromContact(garbage)).toBe('needle@example.com');
    });

    it('returns null when no email shape is present', () => {
        expect(extractEmailFromContact('not-an-email')).toBeNull();
        expect(extractEmailFromContact('{"phone":"+972..."}')).toBeNull();
        expect(extractEmailFromContact('')).toBeNull();
        expect(extractEmailFromContact(null)).toBeNull();
        expect(extractEmailFromContact(undefined)).toBeNull();
    });

    it('composed with maskEmail: blob → extract → mask never leaks the blob', () => {
        const blob = '{"email":"victim@example.com","phone":"+972502440556","idnumber":"13515315"}';
        const masked = maskEmail(extractEmailFromContact(blob));
        expect(masked).toBe('vi****@example.com');
        // Critical: the masked output MUST NOT contain any of the
        // sensitive trailing fields.
        expect(masked).not.toContain('phone');
        expect(masked).not.toContain('idnumber');
        expect(masked).not.toContain('502440556');
    });
});

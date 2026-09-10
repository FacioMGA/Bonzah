import { describe, expect, it } from 'vitest';
import { redactUrl } from '../logger.js';

// Regression: Sentry ABBEYGATE-R — external scanners POST to routes with
// malformed percent-encoding in the query string (e.g. a bare `%`). The URL
// redaction helper decoded query keys with raw `decodeURIComponent`, which
// throws `URIError: URI malformed`, escaping the request logger middleware and
// failing the request at the Express boundary (43 prod events, handled:no).
describe('redactUrl', () => {
    it('does not throw on malformed percent-encoding in a query key (ABBEYGATE-R)', () => {
        // Pre-fix this threw `URIError: URI malformed`.
        expect(() => redactUrl('/hello.world?%=1')).not.toThrow();
        expect(() => redactUrl('/x?%zz=1&bad%=2')).not.toThrow();
    });

    it('still redacts secret-ish keys for well-formed query strings', () => {
        expect(redactUrl('/api/thing?token=abc&foo=bar')).toBe('/api/thing?token=***&foo=bar');
        expect(redactUrl('/p?auth=x&session=y&signature=z&secret=w&keep=1')).toBe(
            '/p?auth=***&session=***&signature=***&secret=***&keep=1',
        );
    });

    it('recognises secret-ish keys even when percent-encoded, without throwing', () => {
        // `%74oken` decodes to `token`; the safe decoder returns the decoded key
        // so the secret match still fires.
        expect(redactUrl('/p?%74oken=abc')).toBe('/p?%74oken=***');
    });

    it('leaves URLs without a query string untouched', () => {
        expect(redactUrl('/health')).toBe('/health');
        expect(redactUrl('')).toBe('');
    });

    it('preserves the raw key token in output (redaction never re-encodes)', () => {
        // A malformed key that cannot be decoded is treated as a normal,
        // non-secret key and echoed back verbatim rather than crashing.
        expect(redactUrl('/x?%=1')).toBe('/x?%=1');
    });
});

import { Request, Response, NextFunction } from 'express';
import { ensureCorrelationId, runWithCorrelationId } from '../../platform/observability/context.js';
import { logger } from '../../platform/utils/logger.js';
const isProd = () => String(process.env.NODE_ENV || '').toLowerCase() === 'production';

const shouldLogBodies = () => {
    // Safe-by-default: never log request bodies in production unless explicitly enabled.
    // Request bodies can contain PII (email/phone/DOB/address) and payment/session secrets.
    const v = String(process.env.DEBUG_REQUEST_BODIES || '').trim().toLowerCase();
    return !isProd() || v === '1' || v === 'true' || v === 'yes';
};

const shouldNeverLogBodyForUrl = (url: string) => {
    // Explicitly avoid logging bodies for auth, OTP, public sessions, and payments.
    // These frequently contain secrets/PII even in non-prod.
    const u = String(url || '');
    return (
        u.startsWith('/api/auth') ||
        u.includes('/email-otp/') ||
        u.startsWith('/api/public/motor/session') ||
        u.startsWith('/api/public/payments') ||
        u.includes('/payments/cardcorp') ||
        u.includes('/checkout') ||
        u.includes('/webhook')
    );
};

// Query keys arrive from untrusted, attacker-controlled traffic — scanners
// probe us with malformed percent-encoding (a bare `%`, `%zz`). Raw
// `decodeURIComponent` throws `URIError: URI malformed` on those, which
// previously escaped the request logger and failed the request at the Express
// boundary (Sentry ABBEYGATE-R, 43 prod events). Redaction only needs a
// best-effort lowercased key to spot secret-ish names, so when a token cannot
// be decoded we use it verbatim rather than letting logging crash the request.
const safeDecodeURIComponent = (value: string): string => {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
};

export const redactUrl = (url: string): string => {
    const input = String(url || '');
    const qIdx = input.indexOf('?');
    if (qIdx < 0) return input;
    const path = input.slice(0, qIdx);
    const qs = input.slice(qIdx + 1);
    const redacted = qs
        .split('&')
        .filter(Boolean)
        .map((pair) => {
            const [keyRaw, valueRaw = ''] = pair.split('=');
            const key = safeDecodeURIComponent(String(keyRaw || '')).toLowerCase();
            if (
                key.includes('token') ||
                key.includes('auth') ||
                key.includes('signature') ||
                key.includes('secret') ||
                key.includes('session')
            ) {
                return `${keyRaw}=***`;
            }
            return `${keyRaw}=${valueRaw}`;
        })
        .join('&');
    return redacted ? `${path}?${redacted}` : path;
};

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const { method } = req;
    const url = redactUrl(req.url);

    const correlationId = ensureCorrelationId(
        req.headers['x-correlation-id'] ||
        req.headers['x-request-id'] ||
        req.headers['traceparent']
    );
    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    res.setHeader('X-Correlation-Id', correlationId);
    res.setHeader('x-request-id', correlationId);
    res.setHeader('X-Request-Id', correlationId);

    // Log Request (structured + correlation-aware)
    logger.info({ event: 'http.request', method, url }, 'http.request');
    const contentLength = Number(req.headers['content-length'] || 0);
    const shouldLogBodyMeta =
        shouldLogBodies() &&
        !shouldNeverLogBodyForUrl(url) &&
        Number.isFinite(contentLength) &&
        contentLength > 0;
    if (shouldLogBodyMeta) {
        // Keep body observability without reading unvalidated payloads.
        logger.debug({ event: 'http.request.body_meta', method, url, contentLength }, 'http.request.body_meta');
    }

    // Capture Response
    const originalSend = res.send;
    res.send = function (data): Response {
        const duration = Date.now() - start;
        res.setHeader('X-Response-Time', `${duration}ms`);
        logger.info({ event: 'http.response', method, url, status: res.statusCode, durationMs: duration }, 'http.response');
        // Optional: Log response data for debugging (careful with size)
        // logger.info(`[DATA]`, data.substring(0, 200)); 
        return originalSend.call(this, data);
    };

    return runWithCorrelationId(correlationId, () => next());
};

export const errorLogger = (err: unknown, req: Request, _res: Response, next: NextFunction) => {
    logger.error({ event: 'http.error', method: req.method, url: req.url, err }, 'http.error');
    next(err);
};

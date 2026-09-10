import pino from 'pino';
import { getCorrelationId } from '../observability/context.js';

/**
 * Structured Logger using Pino
 * 
 * CRITICAL: Always use this logger instead of console.log for production code.
 * 
 * Features:
 * - JSON structured output in production (parseable by log aggregators)
 * - Pretty colored output in development
 * - Automatic timestamps and log levels
 * - Context-aware logging (add request IDs, user IDs, etc.)
 * 
 * Usage:
 *   logger.info({ policyId: '123', premium: 456.78 }, 'Quote created');
 *   logger.error({ err }, 'Failed to create quote');
 *   logger.warn({ userId, ipAddress }, 'Suspicious activity detected');
 */

const isProd = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');
const service = process.env.SERVICE_NAME || 'facio-api';
const redactPaths = [
    'authorization',
    'cookie',
    'password',
    'token',
    'apiKey',
    'secret',
    'session',
    'cardNumber',
    'cvv',
    'iban',
    'req.headers.authorization',
    'req.headers.cookie',
    'headers.authorization',
    'headers.cookie',
    '*.authorization',
    '*.cookie',
    '*.password',
    '*.token',
    '*.apiKey',
    '*.secret',
    '*.session',
    '*.cardNumber',
    '*.cvv',
    '*.iban',
];

export const logger = pino({
    level: logLevel,
    // In development: use pino-pretty for human-readable output
    // In production: output raw JSON for log aggregators
    transport: isProd ? undefined : {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
        },
    },
    // Add base fields to all logs
    base: {
        service,
        env: process.env.NODE_ENV || 'development',
    },
    redact: {
        paths: redactPaths,
        remove: false,
        censor: '***',
    },
    mixin() {
        const cid = getCorrelationId();
        return cid ? { cid } : {};
    },
});

/**
 * Create a child logger with additional context
 * Useful for adding request-specific information
 * 
 * Example:
 *   const reqLogger = logger.child({ requestId: req.id, userId: req.user?.id });
 *   reqLogger.info('Processing quote');
 */
export function createChildLogger(context: Record<string, unknown>) {
    return logger.child(context);
}

/**
 * Log levels (from lowest to highest priority):
 * - trace: Very detailed debugging (rarely used)
 * - debug: Debugging information
 * - info: Informational messages (default)
 * - warn: Warning messages
 * - error: Error messages
 * - fatal: Fatal errors (app crash)
 */

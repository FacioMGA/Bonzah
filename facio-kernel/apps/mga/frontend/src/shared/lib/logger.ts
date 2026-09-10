import pino from 'pino';
import type { Logger } from 'pino';

const isProd = import.meta.env.PROD;
const level = (import.meta.env.VITE_LOG_LEVEL || (isProd ? 'info' : 'debug')) as pino.LevelWithSilent;

const rawLogger: Logger = pino({
  level,
  redact: {
    paths: [
      '*.password',
      '*.token',
      '*.authorization',
      '*.Authorization',
      '*.apiKey',
      '*.secret',
      '*.refreshToken',
      '*.accessToken',
    ],
    censor: '[REDACTED]',
    remove: false,
  },
  browser: {
    asObject: true,
  },
  base: {
    env: import.meta.env.MODE || 'development',
    surface: 'frontend',
  },
});

function makeLogFn(level: 'trace' | 'debug' | 'info' | 'warn' | 'error') {
  return (...args: unknown[]) => {
    const log = (rawLogger[level] as (...inner: unknown[]) => void).bind(rawLogger);
    try {
      if (args.length === 0) {
        log('');
        return;
      }
      const [first, ...rest] = args;
      if (typeof first === 'string') {
        if (rest.length > 0) {
          log(first, ...rest);
        } else {
          log(first);
        }
        return;
      }
      if (first !== null && typeof first === 'object') {
        if (typeof rest[0] === 'string') {
          const [msg, ...tail] = rest;
          log(first, msg, ...tail);
          return;
        }
        if (rest.length > 0) {
          log(first, ...rest);
        } else {
          log(first);
        }
        return;
      }
      log(String(first), ...rest);
    } catch {
      // Logging must never crash the app UI.
      return;
    }
  };
}

export const logger = {
  trace: makeLogFn('trace'),
  debug: makeLogFn('debug'),
  info: makeLogFn('info'),
  warn: makeLogFn('warn'),
  error: makeLogFn('error'),
};


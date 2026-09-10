import type { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';

type PerfBucket = {
  name: string;
  durMs: number;
  desc?: string;
};

export type PerfTimings = {
  add: (name: string, durMs: number, desc?: string) => void;
  start: (name: string, desc?: string) => () => void;
  snapshot: () => PerfBucket[];
};

type RequestWithPerf = Request & { requestId?: string; perf?: PerfTimings };

function nowMs() {
  // High-resolution, monotonic.
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function normalizeName(name: string) {
  // Server-Timing token: letters/digits/_/-
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .slice(0, 64) || 'metric';
}

function fmtServerTiming(buckets: PerfBucket[]) {
  // Example: db;dur=12.3, cache;dur=0.8;desc="redis"
  return (buckets || [])
    .filter((b) => b && b.durMs > 0)
    .map((b) => {
      const token = normalizeName(b.name);
      const dur = Math.round(b.durMs * 10) / 10; // 0.1ms precision
      const desc = b.desc ? `;desc="${String(b.desc).replace(/"/g, '')}"` : '';
      return `${token};dur=${dur}${desc}`;
    })
    .join(', ');
}

export function perfTimingMiddleware(req: Request, res: Response, next: NextFunction) {
  const request = req as RequestWithPerf;
  const start = nowMs();

  // Reuse correlation id if already set by logger middleware, otherwise create.
  const existing =
    String(req.headers['x-correlation-id'] || req.headers['x-request-id'] || '').trim();
  const requestId = existing || crypto.randomUUID();
  request.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  res.setHeader('X-Request-Id', requestId);

  const totals = new Map<string, PerfBucket>();

  const perf: PerfTimings = {
    add: (name, durMs, desc) => {
      const key = normalizeName(name);
      const prev = totals.get(key);
      if (prev) {
        prev.durMs += Math.max(0, Number(durMs) || 0);
        // Keep first description (stable)
        if (!prev.desc && desc) prev.desc = desc;
        return;
      }
      totals.set(key, { name: key, durMs: Math.max(0, Number(durMs) || 0), desc });
    },
    start: (name, desc) => {
      const s = nowMs();
      return () => {
        const e = nowMs();
        perf.add(name, e - s, desc);
      };
    },
    snapshot: () => Array.from(totals.values()),
  };

  request.perf = perf;

  const originalEnd = res.end.bind(res);
  const patchedEnd: Response['end'] = (chunk?: unknown, encodingOrCb?: unknown, cb?: unknown) => {
    try {
      // Only set if headers not already sent
      if (!res.headersSent) {
        const totalMs = nowMs() - start;
        perf.add('app', totalMs);
        const value = fmtServerTiming(perf.snapshot());
        if (value) {
          res.setHeader('Server-Timing', value);
        }
      }
    } catch {
      // never block response on perf
    }
    if (typeof encodingOrCb === 'function') {
      return originalEnd(chunk as never, encodingOrCb as () => void);
    }
    if (typeof cb === 'function') {
      return originalEnd(chunk as never, encodingOrCb as BufferEncoding, cb as () => void);
    }
    return originalEnd(chunk as never, encodingOrCb as BufferEncoding);
  };
  res.end = patchedEnd;

  next();
}


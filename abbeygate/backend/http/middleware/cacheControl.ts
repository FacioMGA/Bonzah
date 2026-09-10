import type { RequestHandler } from 'express';

type CacheProfile = 'none' | 'short' | 'medium' | 'long' | 'immutable';

const CACHE_HEADERS: Record<CacheProfile, string> = {
  none: 'no-store, no-cache, must-revalidate',
  short: 'public, max-age=60, stale-while-revalidate=30',
  medium: 'public, max-age=300, stale-while-revalidate=60',
  long: 'public, max-age=3600, stale-while-revalidate=300',
  immutable: 'public, max-age=31536000, immutable',
};

export function cacheControl(profile: CacheProfile): RequestHandler {
  const value = CACHE_HEADERS[profile];
  return (_req, res, next) => {
    res.setHeader('Cache-Control', value);
    next();
  };
}

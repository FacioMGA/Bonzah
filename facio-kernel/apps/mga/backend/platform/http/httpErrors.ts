import type { Response } from 'express';

/**
 * Canonical error-message extractor used by every HTTP route handler.
 * Per canonical-ownership: a single implementation, no per-router copies.
 *
 * Returns the `Error.message` if available, otherwise the supplied fallback.
 * Callers MUST always supply a fallback so unknown errors never reach the
 * client as `undefined`.
 */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Canonical structured error responder. Every HTTP route uses this instead of
 * hand-rolling `res.status(...).json(...)` shapes so the contract is uniform:
 *
 *   { error: { code, message } }
 *
 * Optional `details` is allowed but discouraged unless the route already has
 * a typed error contract.
 */
export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}

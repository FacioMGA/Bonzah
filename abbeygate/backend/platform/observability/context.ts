import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

type ObservabilityStore = {
  correlationId: string;
};

const als = new AsyncLocalStorage<ObservabilityStore>();

export function ensureCorrelationId(raw?: unknown): string {
  const v = typeof raw === 'string' ? raw.trim() : '';
  return v || crypto.randomUUID();
}

export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return als.run({ correlationId }, fn);
}

export function getCorrelationId(): string | null {
  return als.getStore()?.correlationId || null;
}


import { createHash } from 'node:crypto';
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item))
        .join(',') +
      '}'
    );
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('Canonical values must be JSON');
  return result;
}
export const hash = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
export class KernelError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

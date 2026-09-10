/**
 * Canonical text renderer.
 *
 * Turns a manifest template + event context into the *one human-readable
 * sentence* that:
 *   1. Drives the embedding (so the vector encodes meaning, not raw IDs)
 *   2. Renders directly in the Behavior Console timeline
 *
 * Discipline: keep it short, keep it neutral, keep it the same shape across
 * runs. If two events would produce identical canonical text, that is a
 * feature, not a bug — they are the same behavior.
 */
import type { ManifestEntry } from './loadManifest.js';

export type CanonicalContext = {
  policyId: string;
  policyNumber?: string | null;
};

const TOKEN_RE = /\{(\w+)\}/g;

/**
 * Render a manifest template against an event context.
 *
 * Supported tokens:
 *   - {policyShort}: short policy reference, prefer policyNumber, else first
 *     8 chars of the policy id. Never the full UUID — embeddings are noisy
 *     enough without dragging UUIDs into the vector.
 */
export function renderCanonicalText(
  entry: Pick<ManifestEntry, 'template'>,
  ctx: CanonicalContext,
): string {
  const policyShort = (ctx.policyNumber && ctx.policyNumber.trim()) ||
    String(ctx.policyId || '').slice(0, 8);
  const tokens: Record<string, string> = {
    policyShort,
  };
  return entry.template.replace(TOKEN_RE, (_match, key: string) => {
    return tokens[key] ?? '';
  }).trim();
}

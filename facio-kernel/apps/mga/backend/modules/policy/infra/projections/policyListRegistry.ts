import fs from 'fs';
import path from 'path';
import { z } from 'zod';

export type PolicyListRegistry = {
  registryVersion: number;
  viewSchemaVersion: number;
  entity: string;
  filters: Record<string, {
    field?: string;
    type?: string;
    operators?: string[];
    requiredIndexes?: string[];
    attentionThreshold?: number;
    options?: string[];
    urlKey?: string;
    label?: string;
  }>;
  sortFields: Record<string, { location: 'index' | 'policy'; type: 'date' | 'string' | 'number'; cheap?: boolean; requiredIndexes?: string[] }>;
  defaultSort: Array<{ field: string; direction: 'asc' | 'desc' }>;
  defaultSavedViews?: Array<{
    id: string;
    name: string;
    query: {
      search: string;
      filters: Record<string, string>;
      sorts: Array<{ field: string; direction: 'asc' | 'desc' }>;
    };
  }>;
};

let cached: PolicyListRegistry | null = null;

const policyListRegistrySchema = z.object({
  registryVersion: z.number().int().positive(),
  viewSchemaVersion: z.number().int().positive(),
  entity: z.string().min(1),
  filters: z.record(z.string(), z.object({
    field: z.string().min(1),
    type: z.string().min(1),
    operators: z.array(z.string().min(1)).min(1),
    requiredIndexes: z.array(z.string().min(1)).min(1),
    attentionThreshold: z.number().optional(),
    options: z.array(z.string()).optional(),
    urlKey: z.string().optional(),
    label: z.string().optional(),
  })),
  sortFields: z.record(z.string(), z.object({
    location: z.enum(['index', 'policy']),
    type: z.enum(['date', 'string', 'number']),
    cheap: z.boolean().optional(),
    requiredIndexes: z.array(z.string().min(1)).min(1),
  })),
  defaultSort: z.array(z.object({
    field: z.string().min(1),
    direction: z.enum(['asc', 'desc']),
  })).min(1),
  defaultSavedViews: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    query: z.object({
      search: z.string(),
      filters: z.record(z.string(), z.string()),
      sorts: z.array(z.object({
        field: z.string().min(1),
        direction: z.enum(['asc', 'desc']),
      })),
    }),
  })).optional(),
});

/**
 * Resolve the canonical policy-list registry from disk.
 *
 * Per ADR-0019, this throws when the JSON file is missing — the legacy
 * embedded-constant fallback and its silent warn-and-degrade branch are
 * gone. Startup validation (`backend/platform/config/startupValidation.ts`)
 * calls this loader at boot, so a missing file fails the pod's health
 * check rather than degrading per-request behaviour later. The deleted
 * identifier is pinned by `tools/quality/deleted-identifiers.json`.
 *
 * Canonical file: `frontend/src/modules/policies/list/registry.json`.
 * The Dockerfile (`infrastructure/docker/Dockerfile.{api,worker}`) copies
 * this directory into the production image; the same path also resolves
 * during local dev and unit tests because vitest / tsx run from the repo
 * root.
 */
export function getPolicyListRegistry(): PolicyListRegistry {
  if (cached) return cached;
  const candidates = [
    path.join(process.cwd(), 'frontend', 'src', 'modules', 'policies', 'list', 'registry.json'),
  ];

  let raw: unknown = null;
  let lastError: unknown = null;
  for (const file of candidates) {
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!raw) {
    throw new Error(
      `[policy-list-registry] No registry file found at any of: ${candidates.join(', ')}. ` +
        `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}. ` +
        'Per ADR-0019 there is no embedded fallback; ship the canonical JSON in the build artefact.',
    );
  }
  const parsed = policyListRegistrySchema.parse(raw);
  cached = parsed as PolicyListRegistry;
  return cached!;
}


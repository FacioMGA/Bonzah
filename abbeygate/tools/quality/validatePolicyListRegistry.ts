import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  registryVersion: z.number().int().positive(),
  viewSchemaVersion: z.number().int().positive(),
  entity: z.literal('policies'),
  filters: z.record(z.string(), z.object({
    field: z.string().min(1),
    type: z.enum(['enum', 'boolean', 'number', 'date', 'string']),
    operators: z.array(z.enum(['eq', 'in', 'gte', 'lte', 'between', 'contains', 'prefix'])).min(1),
    requiredIndexes: z.array(z.string().min(1)).min(1),
    urlKey: z.string().min(1),
    label: z.string().optional(),
    attentionThreshold: z.number().optional(),
    options: z.array(z.string()).optional(),
  })),
  sortFields: z.record(z.string(), z.object({
    location: z.enum(['index', 'policy']),
    type: z.enum(['date', 'string', 'number']),
    cheap: z.boolean(),
    requiredIndexes: z.array(z.string().min(1)).min(1),
  })),
  defaultSort: z.array(z.object({
    field: z.string().min(1),
    direction: z.enum(['asc', 'desc']),
  })).min(1).max(3),
  defaultSavedViews: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    query: z.object({
      search: z.string(),
      filters: z.record(z.string(), z.string()),
      sorts: z.array(z.object({
        field: z.string().min(1),
        direction: z.enum(['asc', 'desc']),
      })).max(3),
    }),
  })),
});

function main() {
  const target = path.join(process.cwd(), 'frontend', 'src', 'modules', 'policies', 'list', 'registry.json');
  const prismaSchemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
  const raw = JSON.parse(fs.readFileSync(target, 'utf8'));
  const parsed = schema.parse(raw);
  const prismaSchema = fs.readFileSync(prismaSchemaPath, 'utf8');

  const missingRefs: string[] = [];
  const collectRefs = [
    ...Object.values(parsed.filters).flatMap((f) => f.requiredIndexes || []),
    ...Object.values(parsed.sortFields).flatMap((s) => s.requiredIndexes || []),
  ];
  for (const ref of collectRefs) {
    const marker = String(ref || '').trim();
    if (!marker) continue;
    const indexSpec = marker.split('@@index(')[1]?.replace(/\)$/, '');
    if (!indexSpec) {
      missingRefs.push(marker);
      continue;
    }
    if (!prismaSchema.includes(`@@index(${indexSpec})`)) {
      missingRefs.push(marker);
    }
  }
  if (missingRefs.length) {
    throw new Error(`policy-list-registry requiredIndexes missing from prisma schema: ${Array.from(new Set(missingRefs)).join(', ')}`);
  }
  // eslint-disable-next-line no-console
  console.log(`[policy-list-registry] valid (registryVersion=${parsed.registryVersion}, viewSchemaVersion=${parsed.viewSchemaVersion})`);
}

main();

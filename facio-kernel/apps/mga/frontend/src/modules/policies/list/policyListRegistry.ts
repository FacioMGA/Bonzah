import raw from './registry.json';
import { z } from 'zod';

export type PolicyListRegistry = {
  registryVersion: number;
  viewSchemaVersion: number;
  entity: string;
  filters: Record<string, {
    field: string;
    type: 'enum' | 'boolean' | 'number' | 'date' | 'string';
    operators: string[];
    requiredIndexes: string[];
    urlKey: string;
    label?: string;
    attentionThreshold?: number;
    options?: string[];
  }>;
  sortFields: Record<string, { location: 'index' | 'policy'; type: 'date' | 'string' | 'number'; cheap: boolean; requiredIndexes: string[] }>;
  defaultSort: Array<{ field: string; direction: 'asc' | 'desc' }>;
  defaultSavedViews: Array<{
    id: string;
    name: string;
    query: {
      search: string;
      filters: Record<string, string>;
      sorts: Array<{ field: string; direction: 'asc' | 'desc' }>;
    };
  }>;
};

const policyListRegistrySchema = z.object({
  registryVersion: z.number().int().positive(),
  viewSchemaVersion: z.number().int().positive(),
  entity: z.string().min(1),
  filters: z.record(z.string(), z.object({
    field: z.string().min(1),
    type: z.enum(['enum', 'boolean', 'number', 'date', 'string']),
    operators: z.array(z.string().min(1)).min(1),
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
  })).default([]),
});

export const policyListRegistry = policyListRegistrySchema.parse(raw) as PolicyListRegistry;


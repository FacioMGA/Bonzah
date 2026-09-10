import { z } from 'zod';

const functionSchema = z.custom<(...args: never[]) => unknown>((v) => typeof v === 'function');

export const listSortSchema = z.object({
  field: z.string().min(1),
  direction: z.enum(['asc', 'desc']),
});

export const recordListFilterOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export const recordListFilterDefSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['select', 'text', 'date-range', 'number-range']),
  options: z.array(recordListFilterOptionSchema).optional(),
  placeholder: z.string().optional(),
  defaultValue: z.string().optional(),
  urlKey: z.string().optional(),
});

export const recordListColumnSchema = z.object({
  id: z.string().min(1),
  // Allow empty header for "actions" / icon-only columns.
  header: z.string(),
  widthClass: z.string().optional(),
  sortable: z.boolean().optional(),
  sortField: z.string().optional(),
  resizable: z.boolean().optional(),
  hideable: z.boolean().optional(),
  defaultHidden: z.boolean().optional(),
  priority: z.number().int().optional(),
  render: functionSchema,
});

export const recordListConfigSchema = z.object({
  id: z.string().min(1),
  entityLabel: z.string().min(1),
  getRowId: functionSchema,
  columns: z.array(recordListColumnSchema).min(1),
  filters: z.array(recordListFilterDefSchema).optional(),
  searchPlaceholder: z.string().optional(),
  searchHint: z.string().optional(),
  rowHref: functionSchema.optional(),
  onRowClick: functionSchema.optional(),
  mobileCardSlot: functionSchema.optional(),
});

export type RecordListConfigInput = z.input<typeof recordListConfigSchema>;

export function validateRecordListConfig<T extends RecordListConfigInput>(input: T): T {
  return recordListConfigSchema.parse(input) as T;
}


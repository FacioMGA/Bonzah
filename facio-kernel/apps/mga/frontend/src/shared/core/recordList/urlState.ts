import type { ListQueryState, RecordListConfig, RecordListFilterDef, RecordListFilterType } from './types';

const SEARCH_KEY = 'q';
const SORT_FIELD_KEY = 'sort';
const SORT_DIR_KEY = 'dir';
const SORT_FIELD_KEY_2 = 'sort2';
const SORT_DIR_KEY_2 = 'dir2';
const SORT_FIELD_KEY_3 = 'sort3';
const SORT_DIR_KEY_3 = 'dir3';

function allowedSortFields<TItem>(config: RecordListConfig<TItem>): Set<string> {
  return new Set(
    (config.columns || [])
      .filter((c) => Boolean(c.sortable && c.sortField))
      .map((c) => String(c.sortField || '').trim())
      .filter(Boolean)
  );
}

function filterParamKey(f: RecordListFilterDef): string {
  return String(f.urlKey || f.id);
}

function readFilterValue(sp: URLSearchParams, f: RecordListFilterDef): string {
  const key = filterParamKey(f);
  const v = sp.get(key);
  if (v === null || v === undefined || v === '') return String(f.defaultValue || '');
  return v;
}

function shouldWriteFilter(type: RecordListFilterType, value: string): boolean {
  // Keep v1 simple: for all supported types, empty string removes the param
  void type;
  return value.trim().length > 0;
}

export function parseListQueryStateFromUrl<TItem>(config: RecordListConfig<TItem>, sp: URLSearchParams): ListQueryState {
  const search = sp.get(SEARCH_KEY) || '';
  const allowedSorts = allowedSortFields(config);

  const parseSort = (fieldKey: string, dirKey: string) => {
    const field = sp.get(fieldKey);
    if (!field) return null;
    if (!allowedSorts.has(field)) return null;
    const dir = sp.get(dirKey) === 'asc' ? 'asc' : 'desc';
    return { field, direction: dir as 'asc' | 'desc' };
  };
  const parsedSorts = [
    parseSort(SORT_FIELD_KEY, SORT_DIR_KEY),
    parseSort(SORT_FIELD_KEY_2, SORT_DIR_KEY_2),
    parseSort(SORT_FIELD_KEY_3, SORT_DIR_KEY_3),
  ].filter(Boolean) as Array<{ field: string; direction: 'asc' | 'desc' }>;
  const dedupedSorts: Array<{ field: string; direction: 'asc' | 'desc' }> = [];
  const seen = new Set<string>();
  for (const s of parsedSorts) {
    if (!s.field || seen.has(s.field)) continue;
    seen.add(s.field);
    dedupedSorts.push(s);
    if (dedupedSorts.length >= 3) break;
  }
  const sort = dedupedSorts[0] || null;

  const filters: Record<string, unknown> = {};
  for (const f of (config.filters || [])) {
    const v = readFilterValue(sp, f);
    filters[f.id] = v;
  }

  return { search, filters, sorts: dedupedSorts, sort };
}

export function writeListQueryStateToUrl<TItem>(
  config: RecordListConfig<TItem>,
  next: ListQueryState,
  sp: URLSearchParams
): URLSearchParams {
  const out = new URLSearchParams(sp);
  const allowedSorts = allowedSortFields(config);

  // search
  if (next.search.trim()) out.set(SEARCH_KEY, next.search);
  else out.delete(SEARCH_KEY);

  // sort
  const rawSorts = Array.isArray(next.sorts) ? next.sorts.slice(0, 3) : (next.sort?.field ? [next.sort] : []);
  const dedupedSorts: Array<{ field: string; direction: 'asc' | 'desc' }> = [];
  const seen = new Set<string>();
  for (const s of rawSorts) {
    const field = String(s?.field || '').trim();
    if (!field || seen.has(field)) continue;
    if (!allowedSorts.has(field)) continue;
    seen.add(field);
    dedupedSorts.push({ field, direction: s.direction === 'asc' ? 'asc' : 'desc' });
    if (dedupedSorts.length >= 3) break;
  }
  const sorts = dedupedSorts;
  const writeSort = (idx: number, sort: { field: string; direction: 'asc' | 'desc' } | undefined) => {
    const fKey = idx === 0 ? SORT_FIELD_KEY : idx === 1 ? SORT_FIELD_KEY_2 : SORT_FIELD_KEY_3;
    const dKey = idx === 0 ? SORT_DIR_KEY : idx === 1 ? SORT_DIR_KEY_2 : SORT_DIR_KEY_3;
    if (sort?.field) {
      out.set(fKey, sort.field);
      out.set(dKey, sort.direction);
    } else {
      out.delete(fKey);
      out.delete(dKey);
    }
  };
  writeSort(0, sorts[0]);
  writeSort(1, sorts[1]);
  writeSort(2, sorts[2]);

  // filters
  for (const f of (config.filters || [])) {
    const key = filterParamKey(f);
    const vRaw = next.filters?.[f.id];
    const v = typeof vRaw === 'string' ? vRaw : (vRaw === null || vRaw === undefined ? '' : String(vRaw));
    if (shouldWriteFilter(f.type, v)) out.set(key, v);
    else out.delete(key);
  }

  return out;
}


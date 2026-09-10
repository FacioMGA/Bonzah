import { useQuery } from '@tanstack/react-query';
import { http } from '@/src/shared/api/http';

type ProgramRow = { id: string; name?: string; status?: string };
type BinderRow = {
  id: string;
  umr?: string;
  agreementNumber?: string;
  coverholderName?: string;
  startDate?: string;
  endDate?: string;
  config?: unknown;
};

export type FilterOption = { label: string; value: string };

function programLabel(row: ProgramRow): string {
  const name = String(row?.name || '').trim();
  return name || String(row?.id || '');
}

export function buildProgramFilterOptions(rows: ProgramRow[]): FilterOption[] {
  const byLabel = new Map<string, { label: string; ids: string[] }>();
  for (const row of rows) {
    const status = String(row?.status || '').toUpperCase();
    const id = String(row?.id || '').trim();
    if (!id || status === 'ARCHIVED') continue;
    const label = programLabel(row).trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const existing = byLabel.get(key) || { label, ids: [] };
    if (!existing.ids.includes(id)) existing.ids.push(id);
    byLabel.set(key, existing);
  }
  return Array.from(byLabel.values()).map((entry) => ({
    label: entry.label,
    value: entry.ids.join(','),
  }));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function yearFromBinder(row: BinderRow): string {
  const fromDate = String(row.startDate || '').trim();
  const parsed = fromDate ? new Date(fromDate) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return String(parsed.getFullYear());
  const agreement = String(row.agreementNumber || '').trim();
  const fourDigit = agreement.match(/20\d{2}/);
  if (fourDigit) return fourDigit[0];
  const twoDigit = agreement.match(/^(\d{2})/);
  return twoDigit ? `20${twoDigit[1]}` : '';
}

function binderLeader(row: BinderRow): string {
  const config = asRecord(row.config);
  const agreement = asRecord(config.agreement);
  const markets = Array.isArray(agreement.markets) ? agreement.markets.map(asRecord) : [];
  const leader = String(
    row.coverholderName ||
      agreement.leader ||
      agreement.leadInsurer ||
      agreement.insurer ||
      markets.find((market) => String(market.role || '').toLowerCase().includes('leader'))?.name ||
      markets[0]?.name ||
      '',
  ).trim();
  return leader;
}

function binderLabel(row: BinderRow): string {
  const umr = String(row?.umr || '').trim();
  const leader = binderLeader(row);
  const year = yearFromBinder(row);
  const parts = [leader, umr, year].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return String(row?.agreementNumber || row?.id || '');
}

export function buildBinderFilterOptions(rows: BinderRow[]): FilterOption[] {
  return rows.map((row) => ({ value: String(row.id), label: binderLabel(row) }));
}

/**
 * Loads program + binder reference data so the policies list can render labels
 * (instead of raw UUIDs) in the active-filter chips, the filters modal, and
 * any future filter-display surface. Cached for 5 minutes — these change rarely.
 *
 * Why this exists: the active-filters chip in `RecordListView` reads
 * `filter.options` to map a value → label. Until programs/binders were loaded
 * the chip fell back to the raw UUID, surfacing strings like
 * `Program EQ 33333333-3333-4333-8333-333333333333` to admins.
 */
export function usePolicyFilterOptions(): {
  programOptions: FilterOption[];
  binderOptions: FilterOption[];
  isLoading: boolean;
} {
  const programs = useQuery<FilterOption[]>({
    queryKey: ['policies', 'filterOptions', 'programs'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const resp = await http.request<ProgramRow[]>('programs');
      const data = (resp as { data?: unknown }).data;
      const list = Array.isArray(data) ? (data as ProgramRow[]) : [];
      return buildProgramFilterOptions(list);
    },
  });

  const binders = useQuery<FilterOption[]>({
    queryKey: ['policies', 'filterOptions', 'binders'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const resp = await http.request<BinderRow[]>('binders');
      const data = (resp as { data?: unknown }).data;
      const list = Array.isArray(data) ? (data as BinderRow[]) : [];
      return buildBinderFilterOptions(list);
    },
  });

  return {
    programOptions: programs.data || [],
    binderOptions: binders.data || [],
    isLoading: programs.isLoading || binders.isLoading,
  };
}

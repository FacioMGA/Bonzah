import type { MouseEvent, ReactNode } from 'react';

export type MobileCardSlotOpts = {
  hasMore: boolean;
  isFetching: boolean;
  isFetchingMore: boolean;
  loadMore: () => Promise<void>;
};

export type ListSortDirection = 'asc' | 'desc';

export type ListSort = {
  field: string;
  direction: ListSortDirection;
};

export type ListQueryState = {
  search: string;
  filters: Record<string, unknown>;
  sorts: ListSort[];
  sort: ListSort | null;
};

export type RecordListColumn<TItem> = {
  id: string;
  header: string;
  widthClass?: string;
  sortable?: boolean;
  sortField?: string;
  resizable?: boolean;
  hideable?: boolean;
  defaultHidden?: boolean;
  priority?: number;
  render: (item: TItem) => ReactNode;
};

export type RecordListFilterType = 'select' | 'text' | 'date-range' | 'number-range';

export type RecordListFilterOption = { label: string; value: string };

export type RecordListFilterDef = {
  id: string;
  label: string;
  type: RecordListFilterType;
  options?: RecordListFilterOption[];
  placeholder?: string;
  defaultValue?: string;
  urlKey?: string;
};

export type RecordListConfig<TItem> = {
  id: string;
  entityLabel: string;
  getRowId: (item: TItem) => string;
  columns: Array<RecordListColumn<TItem>>;
  filters?: Array<RecordListFilterDef>;
  getSmartSortFallback?: () => ListSort[];
  searchPlaceholder?: string;
  searchHint?: string;
  rowHref?: (item: TItem) => string | undefined;
  onRowClick?: (item: TItem, evt: MouseEvent | null) => void;
  /** When provided, mobile viewports show this slot instead of the data table,
   *  and the toolbar switches to the compact inline layout. */
  mobileCardSlot?: (rows: TItem[], opts: MobileCardSlotOpts) => ReactNode;
};

export type RecordListFetchParams = {
  query: ListQueryState;
  cursor: string | null;
  limit: number;
  signal?: AbortSignal;
  /** Adapters MAY ask the backend for a total count. Page-load fetches set this
   *  to `false` for cache-friendliness; count-only calls (e.g. filter preview)
   *  set it to `true`. */
  wantsTotal?: boolean;
};

export type RecordListFetchResult<TItem> = {
  items: TItem[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
};

export type RecordListAdapterCapabilities = {
  totalCount?: boolean;
  serverSort?: boolean;
};

export type RecordListAdapter<TItem> = {
  fetchPage: (params: RecordListFetchParams) => Promise<RecordListFetchResult<TItem>>;
  capabilities?: RecordListAdapterCapabilities;
};


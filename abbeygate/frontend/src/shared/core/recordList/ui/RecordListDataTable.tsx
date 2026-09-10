import React from 'react';
import type { ListSort, RecordListColumn, RecordListConfig } from '@/src/shared/core/recordList/types';
import { RecordListTableSkeleton } from './RecordListTableSkeleton';

function safeRenderCell<TItem>(col: RecordListColumn<TItem>, item: TItem): React.ReactNode {
  try {
    const v = col.render(item);
    return v === null || v === undefined ? '—' : v;
  } catch {
    return '—';
  }
}

type RecordListDataTableProps<TItem> = {
  config: RecordListConfig<TItem>;
  columns: Array<RecordListColumn<TItem>>;
  rows: TItem[];
  sorts: ListSort[];
  isFetching: boolean;
  activeRowIdx: number;
  onCycleSort: (field: string) => void;
  onOpenRow: (idx: number, opts?: { newTab?: boolean }) => void;
  isInteractiveTarget: (target: EventTarget | null, currentTarget: EventTarget | null) => boolean;
};

export function RecordListDataTable<TItem>(props: RecordListDataTableProps<TItem>) {
  const {
    config,
    columns,
    rows,
    sorts,
    isFetching,
    activeRowIdx,
    onCycleSort,
    onOpenRow,
    isInteractiveTarget,
  } = props;
  const preserveHeaderCase = config.id === 'access-control-roles';

  return (
    <div className="ui-table-wrap overflow-x-auto">
      <div>
        <table className="ui-table min-w-full table-fixed">
          <thead className={`ui-thead ${preserveHeaderCase ? 'normal-case tracking-normal' : ''}`}>
            <tr>
              {columns.map((c, idx) => {
                const isFirst = idx === 0;
                const isLast = idx === columns.length - 1;
                const pad = isFirst ? 'px-5 py-5 pl-6' : isLast ? 'px-5 py-5 pr-6' : 'px-5 py-5';
                const sortField = c.sortField ? String(c.sortField) : '';
                const isSortable = Boolean(c.sortable && sortField);
                const primarySort = (sorts || [])[0];
                const isSorted = isSortable && primarySort?.field === sortField;
                return (
                  <th key={c.id} className={`${pad} ${c.widthClass || ''}`}>
                    {isSortable ? (
                      <button
                        type="button"
                        className="inline-flex items-center font-inherit text-inherit hover:text-slate-900 transition-colors"
                        onClick={() => onCycleSort(sortField)}
                        title={isSorted ? `Sorted ${primarySort?.direction}. Click to cycle.` : 'Click to sort'}
                      >
                        <span>{c.header}</span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="ui-tbody text-sm">
            {rows.length === 0 && isFetching ? (
              <RecordListTableSkeleton columns={columns} rowCount={8} />
            ) : rows.length === 0 && !isFetching ? (
              <tr>
                <td colSpan={columns.length} className="px-10 py-16 text-center text-slate-400 font-semibold">
                  No results.
                </td>
              </tr>
            ) : (
              rows.map((item, idx) => {
                const rowId = config.getRowId(item);
                const href = config.rowHref?.(item);
                const isActive = idx === activeRowIdx;
                const isClickable = Boolean(href || config.onRowClick);
                return (
                  <tr
                    key={rowId}
                    className={`ui-row group ${isClickable ? 'cursor-pointer' : ''} ${isActive ? 'bg-brand-primary/5' : ''}`}
                    onClick={(e) => {
                      if (e.defaultPrevented) return;
                      if (isInteractiveTarget(e.target, e.currentTarget)) return;
                      if (!href && !config.onRowClick) return;
                      const newTab = Boolean(e.metaKey || e.ctrlKey);
                      onOpenRow(idx, { newTab });
                    }}
                    onDoubleClick={() => onOpenRow(idx)}
                  >
                    {columns.map((c, idx2) => {
                      const isFirst = idx2 === 0;
                      const isLast = idx2 === columns.length - 1;
                      const pad = isFirst ? 'px-5 py-5 pl-6' : isLast ? 'px-5 py-5 pr-6' : 'px-5 py-5';
                      return (
                        <td key={c.id} className={`${pad} ${c.widthClass || ''} relative`}>
                          <div className="relative">
                            {safeRenderCell(c, item)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

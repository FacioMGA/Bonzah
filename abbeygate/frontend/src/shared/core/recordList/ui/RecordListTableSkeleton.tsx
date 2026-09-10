import React from 'react';
import type { RecordListColumn } from '@/src/shared/core/recordList/types';

type RecordListTableSkeletonProps<TItem> = {
  columns: Array<RecordListColumn<TItem>>;
  rowCount?: number;
};

export function RecordListTableSkeleton<TItem>(props: RecordListTableSkeletonProps<TItem>) {
  const { columns, rowCount = 8 } = props;
  const rows = Array.from({ length: Math.max(1, rowCount) }, (_, i) => i);

  return (
    <>
      {rows.map((rowIdx) => (
        <tr
          key={`skeleton-row-${rowIdx}`}
          className="ui-row"
          aria-hidden="true"
          data-testid="record-list-skeleton-row"
        >
          {columns.map((c, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === columns.length - 1;
            const pad = isFirst ? 'px-5 py-5 pl-6' : isLast ? 'px-5 py-5 pr-6' : 'px-5 py-5';
            return (
              <td key={c.id} className={`${pad} ${c.widthClass || ''}`}>
                <div className="h-4 w-3/4 max-w-[12rem] rounded-md bg-slate-100 animate-pulse" />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

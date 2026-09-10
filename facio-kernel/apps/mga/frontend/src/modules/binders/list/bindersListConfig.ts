import React from 'react';
import type { RecordListConfig } from '@/src/shared/core/recordList/types';
import { validateRecordListConfig } from '@/src/shared/core/recordList/schema';
import type { BinderIndexRow } from '../model/readModels';
import { createBinderColumns } from './binderColumns';
import { BinderCardList } from './BinderCardList';


export function createBindersListConfig(): RecordListConfig<BinderIndexRow> {
  return validateRecordListConfig({
    id: 'binders',
    entityLabel: 'Binders',
    getRowId: (row: BinderIndexRow) => String(row.id),
    searchPlaceholder: 'Search binders by coverholder, UMR, or agreement…',
    searchHint: 'Binder agreements and status overview.',
    rowHref: (row: BinderIndexRow) => (row?.id ? `/configure/binders/${encodeURIComponent(String(row.id))}/overview` : undefined),
    columns: createBinderColumns(),
    filters: [
      {
        id: 'status',
        label: 'Status',
        type: 'select',
        placeholder: 'All statuses',
        defaultValue: '',
        urlKey: 'status',
        options: ['ACTIVE', 'DRAFT', 'PENDING', 'SUSPENDED', 'EXPIRED', 'ARCHIVED'].map((value) => ({ label: value, value })),
      },
      {
        id: 'lloydsReportingVer',
        label: 'Reporting version',
        type: 'select',
        placeholder: 'All versions',
        defaultValue: '',
        urlKey: 'reportingVersion',
        options: ['V5.2', 'V5.1', 'V5.0'].map((value) => ({ label: value, value })),
      },
      {
        id: 'currency',
        label: 'Currency',
        type: 'select',
        placeholder: 'All currencies',
        defaultValue: '',
        urlKey: 'currency',
        options: ['EUR', 'USD', 'GBP'].map((value) => ({ label: value, value })),
      },
      {
        id: 'lifecycle',
        label: 'Lifecycle',
        type: 'select',
        placeholder: 'All',
        defaultValue: '',
        urlKey: 'lifecycle',
        options: [
          { label: 'Active', value: 'active' },
          { label: 'Expired', value: 'expired' },
          { label: 'Draft', value: 'draft' },
        ],
      },
    ],
    mobileCardSlot: (rows, opts) =>
      React.createElement(BinderCardList, { rows: rows as BinderIndexRow[], ...opts }),
  }) as RecordListConfig<BinderIndexRow>;
}

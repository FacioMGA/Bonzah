import React from 'react';
import type { RecordListConfig } from '../../../../shared/core/recordList/types';
import { validateRecordListConfig } from '../../../../shared/core/recordList/schema';
import type { BoClaimListItem } from './claimsAdapter';
import { createClaimColumns } from './claimColumns';
import { ClaimCardList } from './ClaimCardList';
import { getClaimStatusLabel } from '../../model/claimDisplayLabels';


const CLAIM_STATUSES = [
  'OPEN',
  'REOPENED',
  'CLOSED_THIS_MONTH',
  'CLOSED',
  'WITHDRAWN',
  'PENDING',
];

export function createClaimsListConfig(): RecordListConfig<BoClaimListItem> {
  return validateRecordListConfig({
    id: 'claims',
    entityLabel: 'Claims',
    getRowId: (c: BoClaimListItem) => String(c.id),
    searchPlaceholder: 'Search claims by number, policy, holder, or status…',
    searchHint: 'Open and monitor claims across the full worksheet lifecycle.',
    rowHref: (c: BoClaimListItem) => (c?.id ? `/claims/${String(c.id)}#overview` : undefined),
    columns: createClaimColumns(),
    filters: [
      {
        id: 'status',
        label: 'Status',
        type: 'select',
        placeholder: 'All statuses',
        defaultValue: '',
        urlKey: 'status',
        options: CLAIM_STATUSES.map((status) => ({ label: getClaimStatusLabel(status), value: status })),
      },
    ],
    mobileCardSlot: (rows, opts) =>
      React.createElement(ClaimCardList, { rows: rows as BoClaimListItem[], ...opts }),
  }) as RecordListConfig<BoClaimListItem>;
}

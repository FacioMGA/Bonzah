import React from 'react';
import type { RecordListConfig } from '@/src/shared/core/recordList/types';
import { validateRecordListConfig } from '@/src/shared/core/recordList/schema';
import type { BoAccountListItem } from './accountsAdapter';
import { createAccountColumns } from './accountColumns';
import { AccountCardList } from './AccountCardList';

export function createAccountsListConfig(): RecordListConfig<BoAccountListItem> {
  return validateRecordListConfig({
    id: 'accounts',
    entityLabel: 'Accounts',
    getRowId: (a: BoAccountListItem) => String(a.accountId),
    searchPlaceholder: 'Search by name, phone, policy number, or registration…',
    searchHint: 'Operational intelligence across policies, claims, and billing.',
    rowHref: (a: BoAccountListItem) => (a?.accountId ? `/accounts/${String(a.accountId)}#overview` : undefined),
    columns: createAccountColumns(),
    mobileCardSlot: (rows, opts) =>
      React.createElement(AccountCardList, { rows: rows as BoAccountListItem[], ...opts }),
  }) as RecordListConfig<BoAccountListItem>;
}


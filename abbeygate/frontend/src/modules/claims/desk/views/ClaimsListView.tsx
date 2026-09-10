import React from 'react';
import { Button } from '@/src/shared/ui';
import { useRecordListController } from '../../../../shared/core/recordList/useRecordListController';
import { RecordListView } from '@/src/shared/core/recordList/ui/RecordListView';
import { claimsAdapter, type BoClaimListItem } from '../list/claimsAdapter';
import { createClaimsListConfig } from '../list/claimsListConfig';
import type { RecordListConfig } from '../../../../shared/core/recordList/types';

export type ClaimsListViewProps = {
  onCreateNewCase?: () => void;
};

export function ClaimsListView(props: ClaimsListViewProps) {
  const config = React.useMemo<RecordListConfig<BoClaimListItem>>(
    () => createClaimsListConfig(),
    []
  );
  const controller = useRecordListController<BoClaimListItem>({ adapter: claimsAdapter, config, limit: 12 });

  return (
    <div className="ui-page max-w-none pt-8">
      <RecordListView<BoClaimListItem>
        controller={controller}
        actions={(
          <Button onClick={() => props.onCreateNewCase?.()} size="lg">
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New case
          </Button>
        )}
      />
    </div>
  );
}


import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/src/shared/ui';
import { useRecordListController } from '@/src/shared/core/recordList/useRecordListController';
import { RecordListView } from '@/src/shared/core/recordList/ui/RecordListView';
import type { RecordListConfig } from '@/src/shared/core/recordList/types';
import type { BinderIndexRow } from '../model/readModels';
import { bindersAdapter } from '../list/bindersAdapter';
import { createBindersListConfig } from '../list/bindersListConfig';

export function BindersListView() {
  const navigate = useNavigate();
  const config = React.useMemo<RecordListConfig<BinderIndexRow>>(
    () => createBindersListConfig(),
    []
  );
  const controller = useRecordListController<BinderIndexRow>({
    adapter: bindersAdapter,
    config,
    limit: 12,
  });

  return (
    <div className="ui-page max-w-none pt-8">
      <RecordListView<BinderIndexRow>
        controller={controller}
        actions={(
          <Button onClick={() => navigate('/configure/binders/new')} size="lg">
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create binder
          </Button>
        )}
      />
    </div>
  );
}

/* @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FollowUpBatch } from './FollowUpBatch';

describe('FollowUpBatch', () => {
  it('hides the batch action when follow-ups are not yet enabled', () => {
    render(
      <FollowUpBatch
        followUpEnabled={false}
        lockQuestionnaireOps={false}
        requests={[{ question: 'VIN', note: 'Please clarify', type: 'Ask for more detail', fieldKey: 'vin' }]}
        showBatchModal={false}
        onOpenBatchModal={vi.fn()}
        onCloseBatchModal={vi.fn()}
        onSendBatch={vi.fn()}
        onRemoveRequest={vi.fn()}
      />
    );

    expect(screen.queryByText('Your Batch')).not.toBeInTheDocument();
  });

  it('shows the batch action when follow-ups are enabled and requests exist', () => {
    render(
      <FollowUpBatch
        followUpEnabled={true}
        lockQuestionnaireOps={false}
        requests={[{ question: 'VIN', note: 'Please clarify', type: 'Ask for more detail', fieldKey: 'vin' }]}
        showBatchModal={false}
        onOpenBatchModal={vi.fn()}
        onCloseBatchModal={vi.fn()}
        onSendBatch={vi.fn()}
        onRemoveRequest={vi.fn()}
      />
    );

    expect(screen.getByText('Your Batch')).toBeInTheDocument();
  });
});

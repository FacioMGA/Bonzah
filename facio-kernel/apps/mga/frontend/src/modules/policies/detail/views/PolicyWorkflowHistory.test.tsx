/* @vitest-environment happy-dom */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { feedMock } = vi.hoisted(() => ({
  feedMock: vi.fn(({ policyId }: { policyId?: string }) => (
    <div data-testid="canonical-policy-feed">{policyId}</div>
  )),
}));

vi.mock('../../feed/views/FeedTab', () => ({ Feed: feedMock }));

import { PolicyWorkflowHistory } from './PolicyWorkflowHistory';

describe('PolicyWorkflowHistory', () => {
  it('renders the canonical policy audit feed for the selected policy', () => {
    render(<PolicyWorkflowHistory policyId="policy-123" />);

    expect(screen.getByTestId('canonical-policy-feed')).toHaveTextContent('policy-123');
    expect(feedMock).toHaveBeenCalledWith(
      expect.objectContaining({ policyId: 'policy-123' }),
      undefined,
    );
  });
});

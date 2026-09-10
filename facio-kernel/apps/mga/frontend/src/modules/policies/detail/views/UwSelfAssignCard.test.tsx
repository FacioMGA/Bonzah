/* @vitest-environment happy-dom */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UwSelfAssignCard } from './UwSelfAssignCard';

describe('UwSelfAssignCard', () => {
  it('describes jurisdiction-aware referral routing without a Cyprus-only claim', () => {
    render(
      <UwSelfAssignCard
        visible
        currentAssigneeLabel=""
        assignmentError={null}
        assignmentMessage={null}
        assigning={false}
        onAssign={vi.fn()}
      />,
    );

    expect(screen.getByText(/routed to the team for this policy’s jurisdiction/i)).toBeInTheDocument();
    expect(screen.queryByText(/CY referral emails still go to Danny only/i)).not.toBeInTheDocument();
  });
});

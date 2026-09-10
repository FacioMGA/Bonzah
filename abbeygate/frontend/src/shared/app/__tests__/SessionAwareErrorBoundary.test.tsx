/* @vitest-environment happy-dom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionAwareErrorBoundary } from '../SessionAwareErrorBoundary';

const { attemptStaleChunkRecovery, captureFrontendException } = vi.hoisted(() => ({
  attemptStaleChunkRecovery: vi.fn(() => false),
  captureFrontendException: vi.fn(),
}));

vi.mock('../staleChunkRecovery', () => ({ attemptStaleChunkRecovery }));
vi.mock('@/src/shared/lib/observability/sentry', () => ({ captureFrontendException }));
vi.mock('@/src/shared/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

function BrokenView(): React.ReactNode {
  throw new Error('Failed to fetch dynamically imported module: stale.js');
}

describe('SessionAwareErrorBoundary stale-chunk exhaustion', () => {
  beforeEach(() => {
    attemptStaleChunkRecovery.mockReset();
    attemptStaleChunkRecovery.mockReturnValue(false);
    captureFrontendException.mockReset();
  });

  it('captures a stale-chunk failure when automatic recovery is exhausted', () => {
    render(
      <SessionAwareErrorBoundary>
        <BrokenView />
      </SessionAwareErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(attemptStaleChunkRecovery).toHaveBeenCalledTimes(1);
    expect(captureFrontendException).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('stale.js') }),
      expect.objectContaining({ route: '/' }),
    );
  });
});

/**
 * The producer-side eventType is pinned by
 * `backend/modules/communications/app/__tests__/communications.test.ts`.
 * This test pins the matching handler registration and confirms the
 * retired short name is no longer executable.
 */
import { describe, expect, it, vi } from 'vitest';

// Side-effect import only: pulling the handler module in registers its
// names with the central handler registry. We do NOT need to mock the
// platform layer because we never invoke the handler — only the
// registry-side effect matters for the parity contract.
vi.mock('../../../platform/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getHandler } from '../../index.js';

describe('communications outbound handler — canonical event-name parity', () => {
  it('registers only the canonical COMM.OUTBOUND_QUEUED job name', async () => {
    // Importing the handler module triggers its registerHandler() side effects.
    await import('../COMMUNICATION_OUTBOUND.js');

    const canonicalHandler = getHandler('COMM.OUTBOUND_QUEUED');

    expect(canonicalHandler).toBeDefined();
    expect(getHandler('COMMUNICATION_OUTBOUND')).toBeUndefined();
  });
});

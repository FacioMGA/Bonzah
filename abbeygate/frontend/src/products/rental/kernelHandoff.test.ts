import { describe, expect, it } from 'vitest';
import { BONZAH_WORKSPACE_SLUG, buildKernelRentalEntryUrl } from './kernelHandoff';

describe('Bonzah kernel handoff', () => {
  it('opens the workspace-scoped rental-car entry and preserves the intake values', () => {
    const parameters = new URLSearchParams({
      pickupState: 'Colorado',
      tripStart: '2026-09-18',
      tripEnd: '2026-09-22',
      driverAge: '35',
    });

    const url = new URL(buildKernelRentalEntryUrl(parameters));
    expect(url.origin + url.pathname).toBe('https://platform.facio.io/quote/rental-car/new');
    expect(url.searchParams.get('workspace')).toBe(BONZAH_WORKSPACE_SLUG);
    expect(url.searchParams.get('pickupState')).toBe('Colorado');
    expect(url.searchParams.get('driverAge')).toBe('35');
  });
});

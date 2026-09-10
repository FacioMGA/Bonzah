// @vitest-environment happy-dom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { PlatformEntry } from './PlatformEntry';

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });

it.each(['/studio?tenant=legacy-id&view=insurance', '/studio/'])('redirects legacy bookmark %s to workspace selection without selecting a tenant', async (path) => {
  window.history.replaceState({}, '', path);
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
  const fetch = vi.spyOn(window, 'fetch');
  render(<PlatformEntry />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/workspaces'));
  expect(fetch).not.toHaveBeenCalled();
});

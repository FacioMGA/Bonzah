/* @vitest-environment happy-dom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { request, createProgram } = vi.hoisted(() => ({
  request: vi.fn(),
  createProgram: vi.fn(),
}));

vi.mock('@/src/surfaces/bo/api/boClient', () => ({
  boClient: { request, createProgram },
}));

import { CreateProgramModal } from './CreateProgramModal';

describe('CreateProgramModal', () => {
  afterEach(() => {
    cleanup();
    request.mockReset();
    createProgram.mockReset();
  });

  it('persists the selected canonical product type when creating a program', async () => {
    request.mockResolvedValue({
      success: true,
      data: [{ code: 'HOME', displayName: 'Home Insurance' }],
    });
    createProgram.mockResolvedValue({
      success: true,
      data: { id: 'program-1', name: 'Home 2026', productType: 'HOME' },
    });
    const onCreated = vi.fn();

    render(<CreateProgramModal onClose={vi.fn()} onCreated={onCreated} />);

    await screen.findByRole('option', { name: 'Home Insurance (HOME)' });
    fireEvent.change(screen.getByPlaceholderText('e.g. Motor 2026'), { target: { value: 'Home 2026' } });
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'HOME' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Program' }));

    await waitFor(() => {
      expect(createProgram).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Home 2026',
        productType: 'HOME',
      }));
    });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ productType: 'HOME' }));
  });
});

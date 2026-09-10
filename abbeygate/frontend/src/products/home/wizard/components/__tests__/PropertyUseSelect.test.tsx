/* @vitest-environment happy-dom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PropertyUseSelect } from '../PropertyUseSelect';

describe('PropertyUseSelect', () => {
  it('renders permanent and holiday home options', () => {
    render(<PropertyUseSelect value={undefined} onChange={() => {}} />);
    expect(screen.getByRole('option', { name: 'Permanent home' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Holiday home' })).toBeInTheDocument();
  });

  it('maps permanent selection to true', () => {
    const onChange = vi.fn();
    render(<PropertyUseSelect value={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'permanent' } });
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('maps holiday selection to false', () => {
    const onChange = vi.fn();
    render(<PropertyUseSelect value={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'holiday' } });
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('reflects the current boolean value', () => {
    const { rerender } = render(<PropertyUseSelect value={true} onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveValue('permanent');
    rerender(<PropertyUseSelect value={false} onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveValue('holiday');
  });
});

/* @vitest-environment happy-dom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select';

const OPTIONS = [
  { value: '', label: 'Please Select' },
  { value: 'Petrol', label: 'Petrol' },
  { value: 'Diesel', label: 'Diesel' },
];

describe('Wizard Select', () => {
  it('updates immediately when controlled value changes programmatically', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Select value="" onChange={onChange} options={OPTIONS} />,
    );

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('');

    rerender(<Select value="Petrol" onChange={onChange} options={OPTIONS} />);
    expect(select.value).toBe('Petrol');
  });

  it('still supports uncontrolled usage', () => {
    const onChange = vi.fn();
    render(<Select defaultValue="" onChange={onChange} options={OPTIONS} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Diesel' } });

    expect(select.value).toBe('Diesel');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('forwards the select ref for react-hook-form registration', () => {
    const ref = React.createRef<HTMLSelectElement>();
    render(<Select ref={ref} defaultValue="Petrol" options={OPTIONS} />);

    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
    expect(ref.current?.value).toBe('Petrol');
  });
});

/* @vitest-environment happy-dom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Input } from '../Input';

describe('Input date entry', () => {
  it('formats compact DDMMYYYY typing and emits ISO date values', () => {
    const emittedValues: string[] = [];
    const onValueChange = vi.fn((next: string) => {
      emittedValues.push(next);
    });
    render(<Input type="date" aria-label="Date of birth" value="" onValueChange={onValueChange} />);

    const input = screen.getByLabelText('Date of birth') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '01051967' } });

    expect(input.value).toBe('01/05/1967');
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(emittedValues).toEqual(['1967-05-01']);
  });

  it('forwards DateInput values through the DOM-style onChange used by reporting pages', () => {
    const onChange = vi.fn();
    render(<Input type="date" aria-label="Start date" value="" onChange={onChange} />);

    const input = screen.getByLabelText('Start date') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '11082026' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].target.value).toBe('2026-08-11');
  });
});

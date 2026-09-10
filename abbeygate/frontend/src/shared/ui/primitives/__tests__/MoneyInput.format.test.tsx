/* @vitest-environment happy-dom */
/**
 * ABY-91 — MoneyInput must format with thousands separators DURING
 * typing, not only on blur. The displayed text becomes `1,000`,
 * `1,000,000`, etc. as the user types, while the raw normalized value
 * (no separators) is what's emitted to the consumer's `onValueChange`
 * so existing zod / RHF schemas keep working unchanged.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MoneyInput } from '../MoneyInput';

describe('MoneyInput — live formatting (ABY-91)', () => {
  it('renders thousands separators while focused as the user types', () => {
    const onValueChange = vi.fn();
    render(<MoneyInput aria-label="amount" value="" onValueChange={onValueChange} maxDecimals={0} />);
    const input = screen.getByLabelText('amount') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1000' } });
    expect(input.value).toBe('1,000');
    fireEvent.change(input, { target: { value: '1000000' } });
    expect(input.value).toBe('1,000,000');
  });

  it('emits the raw (unseparated) numeric string to the consumer onValueChange', () => {
    const onValueChange = vi.fn();
    render(<MoneyInput aria-label="amount" value="" onValueChange={onValueChange} maxDecimals={0} />);
    const input = screen.getByLabelText('amount') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1000000' } });
    // The consumer receives the canonical `1000000` so positiveMoney /
    // Number(...) checks continue to pass.
    expect(onValueChange).toHaveBeenLastCalledWith('1000000');
  });

  it('keeps the formatted value visible after blur', () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <MoneyInput aria-label="amount" value="" onValueChange={onValueChange} maxDecimals={0} />,
    );
    const input = screen.getByLabelText('amount') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '500000' } });
    fireEvent.blur(input);
    // Re-render with the value the consumer would have stored.
    rerender(<MoneyInput aria-label="amount" value="500000" onValueChange={onValueChange} maxDecimals={0} />);
    expect(input.value).toBe('500,000');
  });

  it('preserves typed decimal point for currencies that allow decimals', () => {
    const onValueChange = vi.fn();
    render(<MoneyInput aria-label="amount" value="" onValueChange={onValueChange} maxDecimals={2} />);
    const input = screen.getByLabelText('amount') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1234.5' } });
    expect(input.value).toBe('1,234.5');
    expect(onValueChange).toHaveBeenLastCalledWith('1234.5');
  });
});

/* @vitest-environment happy-dom */
/**
 * ABY-94 — `DateInput` must ALWAYS surface a DD/MM/YYYY display
 * (the agreed Cyprus + UK format) regardless of the value shape RHF
 * passes in. Previously a server-side ISO datetime that had been
 * coerced through `new Date(...)` produced `Date.toString()` like
 * "Sat Apr 04 2026 00:00:00 GMT+0000 …" because `displayDateText`
 * only handled the literal `YYYY-MM-DD` shape.
 *
 * Peter's calendar requirement — a date field opens a readable calendar
 * panel with direct month/year navigation, rather than browser-specific
 * native picker UI.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DateInput } from '../DateInput';

describe('DateInput — display formatting (ABY-94)', () => {
  it('renders a YYYY-MM-DD ISO string as DD/MM/YYYY', () => {
    render(<DateInput value="2026-05-10" onChange={() => {}} aria-label="dob" />);
    const input = screen.getByLabelText('dob') as HTMLInputElement;
    expect(input.value).toBe('10/05/2026');
  });

  it('renders a full ISO datetime as DD/MM/YYYY (strips the time portion)', () => {
    render(<DateInput value="2026-05-10T00:00:00.000Z" onChange={() => {}} aria-label="dob" />);
    const input = screen.getByLabelText('dob') as HTMLInputElement;
    expect(input.value).toBe('10/05/2026');
  });

  it('renders a Date.toString() value as DD/MM/YYYY (never the raw "Sat …" string)', () => {
    // Reproduces the ABY-94 hot path: a parent step `String(...)`s a
    // Date object that came back from the server hydrator, so the
    // value handed to DateInput is e.g. `Sat Apr 04 2026 00:00:00 GMT+0000 …`.
    const dateString = new Date(Date.UTC(2026, 3, 4)).toString();
    render(<DateInput value={dateString} onChange={() => {}} aria-label="start" />);
    const input = screen.getByLabelText('start') as HTMLInputElement;
    expect(input.value).toBe('04/04/2026');
  });

  it('renders a Date instance as DD/MM/YYYY', () => {
    const date = new Date(Date.UTC(2026, 11, 31));
    // The component's `value` prop is typed as `string`, but the test
    // models a real-world hydration bug where a parent hands a Date
    // through. An `unknown`-annotated intermediate hands the value to
    // the component without bridging through a contiguous double-cast.
    const valueFromBuggyParent: unknown = date;
    render(<DateInput value={valueFromBuggyParent as string} onChange={() => {}} aria-label="end" />);
    const input = screen.getByLabelText('end') as HTMLInputElement;
    expect(input.value).toBe('31/12/2026');
  });

  it('clears to empty placeholder when the value is empty', () => {
    render(<DateInput value="" onChange={() => {}} aria-label="empty" />);
    const input = screen.getByLabelText('empty') as HTMLInputElement;
    expect(input.value).toBe('');
  });
});

describe('DateInput — calendar panel', () => {
  it('opens a readable calendar with month and year controls', () => {
    render(<DateInput value="2026-08-28" onChange={() => {}} aria-label="Start date" variant="ui" />);
    const picker = screen.getByRole('button', { name: /open start date picker/i });
    expect(picker).toHaveAttribute('data-date-picker-overlay', 'true');
    fireEvent.click(picker);

    const dialog = screen.getByRole('dialog', { name: /start date calendar/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('August 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous year' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next year' })).toBeInTheDocument();
    expect(dialog.style.maxHeight).not.toBe('');
  });

  it('moves the displayed month and emits the selected canonical date', () => {
    const onChange = vi.fn();
    render(<DateInput value="2026-08-10" onChange={onChange} aria-label="dob" />);
    fireEvent.click(screen.getByRole('button', { name: /open dob picker/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('September 2026')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Wednesday, 9 September 2026' }));
    expect(onChange).toHaveBeenCalledWith('2026-09-09');
    expect(screen.queryByRole('dialog', { name: /dob calendar/i })).not.toBeInTheDocument();
  });

  it('prevents selecting dates outside the supplied range', () => {
    render(<DateInput value="2026-08-20" onChange={() => {}} aria-label="start" min="2026-08-18" max="2026-08-22" />);
    fireEvent.click(screen.getByRole('button', { name: /open start picker/i }));
    expect(screen.getByRole('button', { name: 'Monday, 17 August 2026' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Friday, 21 August 2026' })).toBeEnabled();
  });

  it('does not emit a typed date outside the supplied range', () => {
    const onChange = vi.fn();
    render(<DateInput value="" onChange={onChange} aria-label="start" min="2026-08-18" max="2026-08-22" />);

    fireEvent.change(screen.getByLabelText('start'), { target: { value: '17082026' } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('emits a typed date inside the supplied range', () => {
    const onChange = vi.fn();
    render(<DateInput value="" onChange={onChange} aria-label="start" min="2026-08-18" max="2026-08-22" />);

    fireEvent.change(screen.getByLabelText('start'), { target: { value: '21082026' } });

    expect(onChange).toHaveBeenCalledWith('2026-08-21');
  });
});

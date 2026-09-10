/* @vitest-environment happy-dom */
/**
 * ABY-90 / ABY-92 / ABY-93 — wizard Yes/No questions render as
 * `BooleanRadio` (two side-by-side RadioGroup tiles) and emit a
 * `boolean | undefined` value to the consumer. The boolean wire
 * format is the contract that all RHF + zod schemas across the home
 * questionnaire (and beyond) depend on.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BooleanRadio } from '../BooleanRadio';

describe('BooleanRadio (ABY-90 / ABY-92 / ABY-93)', () => {
  it('renders Yes and No tiles in radio role', () => {
    render(<BooleanRadio name="permanentHome" value={undefined} onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Yes' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'No' })).toBeTruthy();
  });

  it('emits true when Yes is picked', () => {
    const onChange = vi.fn();
    render(<BooleanRadio name="permanentHome" value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('emits false when No is picked', () => {
    const onChange = vi.fn();
    render(<BooleanRadio name="permanentHome" value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'No' }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('reflects controlled value: shows Yes selected when value=true', () => {
    render(<BooleanRadio name="permanentHome" value={true} onChange={() => {}} />);
    const yes = screen.getByRole('radio', { name: 'Yes' }) as HTMLInputElement;
    const no = screen.getByRole('radio', { name: 'No' }) as HTMLInputElement;
    expect(yes.checked).toBe(true);
    expect(no.checked).toBe(false);
  });

  it('reflects controlled value: shows No selected when value=false', () => {
    render(<BooleanRadio name="permanentHome" value={false} onChange={() => {}} />);
    const yes = screen.getByRole('radio', { name: 'Yes' }) as HTMLInputElement;
    const no = screen.getByRole('radio', { name: 'No' }) as HTMLInputElement;
    expect(yes.checked).toBe(false);
    expect(no.checked).toBe(true);
  });
});

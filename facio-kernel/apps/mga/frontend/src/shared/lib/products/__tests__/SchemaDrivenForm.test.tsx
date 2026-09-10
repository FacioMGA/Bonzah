/* @vitest-environment happy-dom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UwConfigSchemaDef } from '@facio/products';
import { SchemaDrivenForm } from '../SchemaDrivenForm';

const schema: UwConfigSchemaDef = {
  groups: [{
    id: 'period',
    title: 'Period',
    fields: [{ path: 'period.inceptionDate', label: 'Inception date', type: 'date' }],
  }],
};

describe('SchemaDrivenForm date fields', () => {
  it('uses the shared navigable DateInput and emits canonical ISO values', () => {
    const onChange = vi.fn();
    render(<SchemaDrivenForm schema={schema} value={{ 'period.inceptionDate': '' }} onChange={onChange} />);

    const input = screen.getByLabelText('Inception date') as HTMLInputElement;
    expect(input).toHaveAttribute('data-date-input', 'true');
    fireEvent.change(input, { target: { value: '15082026' } });
    expect(onChange).toHaveBeenCalledWith('period.inceptionDate', '2026-08-15');

    fireEvent.click(screen.getByRole('button', { name: /open inception date picker/i }));
    expect(screen.getByRole('dialog', { name: /inception date calendar/i })).toBeInTheDocument();
  });
});

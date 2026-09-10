/* @vitest-environment happy-dom */
import { fireEvent, render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Step7Acceptance } from '../Step7Acceptance';
import { initialHomeQuoteData } from '../../../quoteWizard.constants';

function Harness({ children }: { children: ReactNode }) {
  const form = useForm({
    defaultValues: initialHomeQuoteData,
    mode: 'onChange',
  });
  return (
    <FormProvider {...form}>
      {children}
      <output aria-label="policy-start-date-value">{String(form.watch('policy.startDate') ?? '')}</output>
    </FormProvider>
  );
}

describe('Home Step7Acceptance', () => {
  it('starts with a blank policy start date and stores ISO after user entry', () => {
    render(
      <Harness>
        <Step7Acceptance />
      </Harness>,
    );

    const input = screen.getByLabelText('Policy start date') as HTMLInputElement;
    expect(input.value).toBe('');
    const picker = screen.getByRole('button', { name: /open policy start date picker/i });
    fireEvent.click(picker);
    const yesterday = new Date();
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setDate(yesterday.getDate() - 1);
    expect(screen.getByRole('button', { name: yesterday.toLocaleDateString('en-GB', { dateStyle: 'full' }) })).toBeDisabled();

    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const day = String(tomorrow.getDate()).padStart(2, '0');
    const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const year = String(tomorrow.getFullYear());
    const isoDate = `${year}-${month}-${day}`;

    fireEvent.change(input, { target: { value: `${day}${month}${year}` } });

    expect(input.value).toBe(`${day}/${month}/${year}`);
    expect(screen.getByLabelText('policy-start-date-value')).toHaveTextContent(isoDate);
  });

  it('renders optional passport / tax ID after quote acceptance (ABY-481)', () => {
    const { container } = render(
      <Harness>
        <Step7Acceptance />
      </Harness>,
    );

    expect(container.querySelector('input[name="proposer.nif"]')).not.toBeNull();
    expect(screen.getByText(/optional for now/i)).toBeInTheDocument();
  });

  it('captures mortgage lender details when bank interest is declared', () => {
    render(
      <Harness>
        <Step7Acceptance />
      </Harness>,
    );

    fireEvent.click(screen.getByLabelText(/bank, lender, or mortgage interest/i));

    expect(screen.getByPlaceholderText('Enter bank or lender name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter the bank or lender address')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter reference if known')).toBeInTheDocument();
  });
});

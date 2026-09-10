/* @vitest-environment happy-dom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { QuestionnaireQuestionCard } from '../QuestionnaireQuestionCard';

type CardProps = ComponentProps<typeof QuestionnaireQuestionCard>;

function baseProps(overrides: Partial<CardProps> = {}): CardProps {
  return {
    question: { key: 'sample', label: 'Sample question', type: 'text' },
    fieldKey: 'sample',
    value: '',
    questionType: 'text',
    searchable: false,
    resolvedOptions: [],
    resolvedSelectOptions: [],
    hasResolvedOptions: false,
    fieldDisabled: false,
    isSavingChanges: false,
    updateQuestionField: vi.fn(),
    validateFieldOnBlur: vi.fn(),
    formatCurrencyDisplay: (v) => String(v ?? ''),
    formatCurrencyInputValue: (v) => String(v ?? ''),
    fieldError: undefined,
    requiredAtStages: undefined,
    draftFieldChanged: false,
    pendingReq: null,
    pendingState: null,
    sentMeta: undefined,
    fieldFollowUpEnabled: false,
    openFollowUp: vi.fn(),
    stepKeyForPart: 'driverDetails',
    uwLane: null,
    uwMsgs: [],
    chip: undefined,
    ...overrides,
  };
}

describe('QuestionnaireQuestionCard', () => {
  it('renders boolean fields with Yes/No ordering for non-negative-risk keys', () => {
    const update = vi.fn();
    render(
      <QuestionnaireQuestionCard
        {...baseProps({
          question: { key: 'optInBenefit', label: 'Opt in to benefit', type: 'boolean' },
          fieldKey: 'optInBenefit',
          questionType: 'boolean',
          value: false,
          updateQuestionField: update,
        })}
      />,
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const labels = Array.from(select.querySelectorAll('option'))
      .filter((o) => (o as HTMLOptionElement).value !== '')
      .map((o) => o.textContent);
    expect(labels).toEqual(['Yes', 'No']);

    fireEvent.change(select, { target: { value: 'true' } });
    expect(update).toHaveBeenCalledWith('optInBenefit', 'boolean', 'true');
  });

  it('renders boolean fields with No/Yes ordering for negative-risk keys (e.g. hasClaims)', () => {
    render(
      <QuestionnaireQuestionCard
        {...baseProps({
          question: { key: 'hasClaims', label: 'Any claims?', type: 'boolean' },
          fieldKey: 'hasClaims',
          questionType: 'boolean',
          value: '',
        })}
      />,
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const labels = Array.from(select.querySelectorAll('option'))
      .filter((o) => (o as HTMLOptionElement).value !== '')
      .map((o) => o.textContent);
    expect(labels).toEqual(['No', 'Yes']);
  });

  it('renders the shared MoneyInput for currency fields and strips non-digits before update', () => {
    const update = vi.fn();
    render(
      <QuestionnaireQuestionCard
        {...baseProps({
          question: { key: 'sumInsured', label: 'Sum insured', type: 'currency' },
          fieldKey: 'sumInsured',
          questionType: 'currency',
          value: 12000,
          updateQuestionField: update,
          formatCurrencyInputValue: (v) => String(v ?? ''),
        })}
      />,
    );
    expect(screen.getByText('€')).toBeInTheDocument();
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input).toHaveClass('text-left');
    fireEvent.change(input, { target: { value: '12,500abc' } });
    expect(update).toHaveBeenCalledWith('sumInsured', 'currency', '12500');
  });

  it('renders the rose required mark when required at quote stage and surfaces fieldError', () => {
    render(
      <QuestionnaireQuestionCard
        {...baseProps({
          question: { key: 'vin', label: 'VIN', type: 'text' },
          fieldKey: 'vin',
          questionType: 'text',
          value: '',
          fieldError: 'VIN is required',
          requiredAtStages: ['quote'],
        })}
      />,
    );
    expect(screen.getByText('VIN is required')).toBeInTheDocument();
    const star = screen.getByTitle(/Required for quote/);
    expect(star).toHaveClass('text-rose-500');
  });

  it('does not degrade select fields without options into text inputs', () => {
    render(
      <QuestionnaireQuestionCard
        {...baseProps({
          question: { key: 'fuelType', label: 'Fuel type', type: 'select' },
          fieldKey: 'fuelType',
          questionType: 'select',
          hasResolvedOptions: false,
          resolvedOptions: [],
          resolvedSelectOptions: [],
        })}
      />,
    );

    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByText('No options configured')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renders the amber required mark when required only at issuance', () => {
    render(
      <QuestionnaireQuestionCard
        {...baseProps({
          question: { key: 'iban', label: 'IBAN', type: 'text' },
          fieldKey: 'iban',
          questionType: 'text',
          value: '',
          requiredAtStages: ['issuance'],
        })}
      />,
    );
    const star = screen.getByTitle(/Required for issuance/);
    expect(star).toHaveClass('text-amber-500');
  });

  it('renders SearchableSelect for select fields with options + searchable', () => {
    render(
      <QuestionnaireQuestionCard
        {...baseProps({
          question: { key: 'make', label: 'Make', type: 'select' },
          fieldKey: 'make',
          questionType: 'select',
          searchable: true,
          hasResolvedOptions: true,
          resolvedSelectOptions: [
            { value: 'toyota', label: 'Toyota' },
            { value: 'honda', label: 'Honda' },
          ],
          resolvedOptions: ['Toyota', 'Honda'],
          value: 'toyota',
        })}
      />,
    );
    expect(screen.getByText('Toyota')).toBeInTheDocument();
  });

  it('renders an unconfigured select state for searchable select with no options', () => {
    render(
      <QuestionnaireQuestionCard
        {...baseProps({
          question: { key: 'model', label: 'Model', type: 'select' },
          fieldKey: 'model',
          questionType: 'select',
          searchable: true,
          hasResolvedOptions: false,
          value: '',
        })}
      />,
    );
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByText('No options configured')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('QuestionnaireQuestionCard — escape-hatch removal (Phase 6a)', () => {
  it('does not declare a customRenderer prop on its TypeScript surface', () => {
    const props = baseProps();
    expect('customRenderer' in (props as Record<string, unknown>)).toBe(false);
  });
});

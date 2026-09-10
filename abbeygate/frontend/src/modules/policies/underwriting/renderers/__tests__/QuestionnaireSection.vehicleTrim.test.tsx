/* @vitest-environment happy-dom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuestionnaireSection } from '../QuestionnaireSection';
import type { ComponentProps } from 'react';

type SectionProps = ComponentProps<typeof QuestionnaireSection>;

function baseProps(overrides: Partial<SectionProps> = {}): SectionProps {
  return {
    part: {
      title: 'Part 3: Vehicle',
      questions: [
        { key: 'make', label: 'Make', type: 'select', searchable: true },
        { key: 'model', label: 'Model', type: 'select', searchable: true },
        { key: 'year', label: 'Year', type: 'number' },
      ],
    },
    index: 0,
    riskPoints: {},
    questionContractByKey: {},
    underwritingStage: 'quote',
    quoteData: { make: 'VW', model: 'Golf', year: 2020 },
    dirtyFields: {},
    hasReplacementData: () => false,
    makeOptions: [{ value: 'VW', label: 'VW' }],
    modelOptions: [{ value: 'Golf', label: 'Golf' }],
    variantSelectOptions: [{ value: 'variant-1', label: 'VW Golf 1.5 TSI' }],
    variantOptionsLoading: false,
    activeVariantId: '',
    activeMake: 'VW',
    activeModel: 'Golf',
    activeYear: 2020,
    selectVariant: vi.fn(),
    uwAnswers: {},
    followUpsSentMap: {},
    followUpEnabled: false,
    inlineEditEnabled: true,
    lockQuestionnaireOps: false,
    editMode: 'preBind',
    fieldErrors: {},
    fieldDisabled: false,
    isSavingChanges: false,
    updateQuestionField: vi.fn(),
    validateFieldOnBlur: vi.fn(),
    formatCurrencyDisplay: (value) => String(value ?? ''),
    formatCurrencyInputValue: (value) => String(value ?? ''),
    openFollowUp: vi.fn(),
    selectedPortfolio: {},
    getQuestionValue: (key) => ({ make: 'VW', model: 'Golf', year: 2020 }[String(key)]),
    ...overrides,
  };
}

describe('QuestionnaireSection vehicle trim selector', () => {
  it('renders the trim selector after make, model, and year are available', () => {
    render(<QuestionnaireSection {...baseProps()} />);

    expect(screen.getByText('Trim')).toBeInTheDocument();
    expect(screen.getByText('Select trim...')).toBeInTheDocument();
  });

  it('keeps the trim selector visible with a year prompt before variants can load', () => {
    render(
      <QuestionnaireSection
        {...baseProps({
          quoteData: { make: 'VW', model: 'Golf', year: '' },
          activeYear: 0,
          variantSelectOptions: [],
          getQuestionValue: (key) => ({ make: 'VW', model: 'Golf', year: '' }[String(key)]),
        })}
      />,
    );

    expect(screen.getByText('Trim')).toBeInTheDocument();
    expect(screen.getByText('Select year first')).toBeInTheDocument();
  });
});

describe('QuestionnaireSection conditional vehicle fields', () => {
  it('renders garage total value only when parking is Garage', () => {
    const props = baseProps({
      part: {
        title: 'Part 3: Vehicle',
        questions: [
          { key: 'parking', label: 'Parking', type: 'select', options: [{ value: 'Garage', label: 'Garage' }] },
          {
            key: 'garageTotalValue',
            label: 'Garage total value',
            type: 'currency',
            visibleWhen: { field: 'parking', equals: 'Garage' },
          },
        ],
      },
      quoteData: { parking: 'Drive' },
      activeMake: '',
      activeModel: '',
      getQuestionValue: (key) => ({ parking: 'Drive', garageTotalValue: '' }[String(key)]),
    });
    const { rerender } = render(<QuestionnaireSection {...props} />);
    expect(screen.queryByText('Garage total value')).not.toBeInTheDocument();

    rerender(
      <QuestionnaireSection
        {...props}
        quoteData={{ parking: 'Garage' }}
        getQuestionValue={(key) => ({ parking: 'Garage', garageTotalValue: '' }[String(key)])}
      />,
    );
    expect(screen.getByText('Garage total value')).toBeInTheDocument();
  });

  it('renders additional driver rows when additional drivers are required', () => {
    const updateQuestionField = vi.fn();
    render(
      <QuestionnaireSection
        {...baseProps({
          part: {
            title: 'Part 2: Driving history',
            questions: [
              { key: 'hasAdditionalDrivers', label: 'Additional drivers', type: 'boolean' },
              { key: 'additionalDrivers', label: 'Additional driver details', type: 'list', visibleWhen: { field: 'hasAdditionalDrivers', equals: true } },
            ],
          },
          quoteData: { hasAdditionalDrivers: true, additionalDrivers: [] },
          activeMake: '',
          activeModel: '',
          updateQuestionField,
          getQuestionValue: (key) => ({ hasAdditionalDrivers: true, additionalDrivers: [] }[String(key)]),
        })}
      />,
    );

    expect(screen.getByText('Additional driver details')).toBeInTheDocument();
    expect(screen.getByText('Add at least one additional driver.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add driver' }));
    expect(updateQuestionField).toHaveBeenCalledWith('additionalDrivers', 'list', [expect.objectContaining({
      firstName: '',
      lastName: '',
      dateOfBirth: '',
      licenseYears: '',
    })]);
  });
});

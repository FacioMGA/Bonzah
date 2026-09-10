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

describe('published instructions', () => {
  it('renders authored text read-only in editable and locked views without answers, required markers or follow-up controls', () => {
    const body = 'Check the declared activities.\n<strong>This is plain text.</strong>';
    const props = baseProps({
      part: { title: 'Guidance', questions: [{ key: 'guidance', label: 'Before reviewing', type: 'paragraph', body, requiredAtStages: ['quote'] }] },
      quoteData: { guidance: 'An old answer must not replace authored instructions' },
      getQuestionValue: () => 'An old answer must not replace authored instructions',
      activeMake: '', activeModel: '', followUpEnabled: true,
      riskPoints: { guidance: { pts: 20 } },
    });
    const view = render(<QuestionnaireSection {...props} />);
    const article = screen.getByRole('article', { name: 'Before reviewing' });
    expect(article.querySelector('p')?.textContent).toBe(body);
    expect(article.querySelector('strong, input, textarea, select, button')).toBeNull();
    expect(screen.queryByTitle('Required for quote')).not.toBeInTheDocument();
    expect(screen.getByTitle('Section score: 0')).toBeInTheDocument();
    expect(props.updateQuestionField).not.toHaveBeenCalled();
    expect(props.openFollowUp).not.toHaveBeenCalled();
    view.rerender(<QuestionnaireSection {...props} editMode="readOnly" fieldDisabled />);
    expect(screen.getByRole('article', { name: 'Before reviewing' }).querySelector('p')?.textContent).toBe(body);
  });

  it('respects instruction visibility and avoids repeating the authored label as a heading', () => {
    const props = baseProps({
      part: { title: 'Guidance', questions: [{ key: 'guidance', label: 'Read before proceeding', type: 'paragraph', body: 'Read before proceeding',
        sourceScope: { version: 1, selectors: [{ field: 'risk.segment', values: ['matched'] }] },
        visibleWhen: { field: 'showGuidance', equals: true } }] },
      quoteData: { risk: { segment: 'matched' }, showGuidance: true }, activeMake: '', activeModel: '',
    });
    const view = render(<QuestionnaireSection {...props} />);
    expect(screen.getAllByText('Read before proceeding')).toHaveLength(1);
    expect(screen.getByRole('article').querySelector('h4')).toBeNull();
    view.rerender(<QuestionnaireSection {...props} dirtyFields={{ 'risk.segment': 'other' }} />);
    expect(screen.queryByRole('article')).toBeNull();
    view.rerender(<QuestionnaireSection {...props} dirtyFields={{ showGuidance: false }} />);
    expect(screen.queryByRole('article')).toBeNull();
  });
});

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
  it('hides and restores a scoped required question using edited coverage and retained authority without clearing its answer', () => {
    const authorityId = '11111111-1111-4111-8111-111111111111';
    const updateQuestionField = vi.fn();
    const props = baseProps({
      part: { title: 'Selected cover details', questions: [{ key: 'customPremises', label: 'Premises details', type: 'text',
        requiredAtStages: ['quote'], sourceScope: { version: 1, authorityIds: [authorityId], selectors: [
          { field: 'risk.coverages', itemKey: 'coverage', values: ['Liability'] },
          { field: 'risk.segment', values: ['training'] },
        ] } }] },
      quoteData: { risk: { coverages: [{ coverage: 'Liability' }], segment: 'training' }, customPremises: 'Saved premises answer' },
      getQuestionValue: () => 'Saved premises answer',
      selectedPortfolio: { programmeDefinition: { binderProductAuthorityId: authorityId } },
      activeMake: '', activeModel: '', updateQuestionField,
    });
    const view = render(<QuestionnaireSection {...props} />);
    expect(screen.getByLabelText('Premises details')).toHaveValue('Saved premises answer');
    expect(screen.getByTitle('Required for quote')).toBeInTheDocument();
    view.rerender(<QuestionnaireSection {...props} dirtyFields={{ 'risk.coverages': [{ coverage: 'Property' }] }} />);
    expect(screen.queryByLabelText('Premises details')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Required for quote')).not.toBeInTheDocument();
    expect(updateQuestionField).not.toHaveBeenCalled();
    view.rerender(<QuestionnaireSection {...props} />);
    expect(screen.getByLabelText('Premises details')).toHaveValue('Saved premises answer');
    view.rerender(<QuestionnaireSection {...props} selectedPortfolio={{}} quoteData={{ ...props.quoteData, binderProductAuthorityId: authorityId }} />);
    expect(screen.queryByLabelText('Premises details')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('question configuration unavailable');
    view.rerender(<QuestionnaireSection {...props} part={{ ...props.part, questions: [{ ...props.part.questions[0], sourceScopeError: 'Unresolved binder' }] }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('question configuration unavailable');
  });

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

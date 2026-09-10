import { describe, expect, it } from 'vitest';
import '@/src/products';
import { resolveProgramQuestionnaire } from './questionnaires';

describe('resolveProgramQuestionnaire', () => {
  it('returns empty array when metadata does not define a questionnaire', () => {
    const result = resolveProgramQuestionnaire({ id: 'p1', metadata: {} });
    expect(result).toEqual([]);
  });

  it('normalizes metadata questionnaire structure when present', () => {
    const result = resolveProgramQuestionnaire({
      id: 'p2',
      metadata: {
        underwritingQuestionnaire: [
          {
            title: 'Custom section',
            questions: [
              { label: 'Foo', key: 'foo', type: 'text' },
              { question: 'Bar', fieldKey: 'bar', inputType: 'boolean' },
            ],
          },
        ],
      },
    });
    expect(result).toEqual([
      {
        title: 'Custom section',
        questions: [
          { label: 'Foo', key: 'foo', type: undefined, options: undefined },
          { label: 'Bar', key: 'bar', type: 'boolean', options: undefined },
        ],
      },
    ]);
  });

  it('fills known question type/options from the registered product manifest when metadata omits them', () => {
    const result = resolveProgramQuestionnaire({
      id: 'p3',
      productType: 'MOTOR',
      metadata: {
        underwritingQuestionnaire: [
          {
            title: 'Vehicle',
            questions: [
              { label: 'Cover Required', key: 'coverRequired' },
            ],
          },
        ],
      },
    });
    expect(result).toEqual([
      {
        title: 'Vehicle',
        questions: [
          {
            label: 'Cover Required',
            key: 'coverRequired',
            type: 'select',
            options: [
              { value: 'Third Party Liability', label: 'Third Party Liability' },
              { value: 'Own Damage', label: 'Own Damage (Comprehensive)' },
            ],
          },
        ],
      },
    ]);
  });

  it('normalizes object options by value and preserves metadata type', () => {
    const result = resolveProgramQuestionnaire({
      id: 'p4',
      metadata: {
        underwritingQuestionnaire: [
          {
            title: 'Driving',
            questions: [
              {
                label: 'License Type',
                key: 'licenseType',
                type: 'select',
                options: [{ label: 'Full', value: 'Full' }, { label: 'Provisional', value: 'Provisional' }],
              },
            ],
          },
        ],
      },
    });
    expect(result).toEqual([
      {
        title: 'Driving',
        questions: [
          {
            label: 'License Type',
            key: 'licenseType',
            type: 'select',
            options: ['Full', 'Provisional'],
            searchable: undefined,
            visibleWhen: undefined,
          },
        ],
      },
    ]);
  });

  it('returns empty when no program id', () => {
    const result = resolveProgramQuestionnaire({ id: '', metadata: {} });
    expect(result).toEqual([]);
  });

  it('filters product-owned hidden questionnaire keys from shared rendering', () => {
    const result = resolveProgramQuestionnaire({
      id: 'p5',
      productType: 'MOTOR',
      metadata: {
        underwritingQuestionnaire: [
          {
            title: 'Legacy',
            questions: [
              { label: 'Motorcycle riders named', key: 'motorcycleRidersNamed', type: 'boolean' },
              { label: 'Cover Required', key: 'coverRequired' },
            ],
          },
        ],
      },
    });
    expect(result[0]?.questions.map((question) => question.key)).toEqual(['coverRequired']);
  });

  it('moves policyholder details first for BO underwriting without changing customer order', () => {
    const program = {
      id: 'travel-program',
      productType: 'TRAVEL',
      metadata: {},
    };

    const boResult = resolveProgramQuestionnaire(program, { actor: 'underwriter', stage: 'quote' });
    const customerResult = resolveProgramQuestionnaire(program, { actor: 'customer', stage: 'quote' });

    expect(boResult[0]?.id).toBe('policy-holder');
    expect(customerResult.findIndex((section) => section.id === 'policy-holder')).toBeGreaterThan(0);
  });
});

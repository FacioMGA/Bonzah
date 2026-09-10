import { describe, expect, it } from 'vitest';
import { resolveProgramQuestionnaire } from './questionnaires';

const definition = {
  id: 'definition-motor-v1',
  programId: 'motor-program',
  questionnaire: {
    requiredness: {},
    sections: [
      {
        id: 'vehicle',
        title: 'Vehicle',
        questions: [
          {
            label: 'Cover Required',
            key: 'coverRequired',
            type: 'select',
            options: [
              'Third Party Liability',
              { value: 'Own Damage', label: 'Own Damage (Comprehensive)' },
            ],
          },
        ],
      },
    ],
  },
};

describe('resolveProgramQuestionnaire', () => {
  it('retains published instruction type and exact plain text without interpreting markup', () => {
    const body = '  First line\n<script>Authored plain text</script>\nLast line  ';
    const result = resolveProgramQuestionnaire({ id: 'published-instructions', questionnaire: { sections: [{ title: 'Review', questions: [
      { key: 'instructions', label: 'Review guidance', type: 'paragraph', body, requiredAtStages: [] },
    ] }] } });
    expect(result[0].questions[0]).toMatchObject({ type: 'paragraph', body, requiredAtStages: [] });
  });

  it('returns empty array when no published programme definition is available', () => {
    expect(resolveProgramQuestionnaire(null)).toEqual([]);
    expect(resolveProgramQuestionnaire({ id: 'definition-without-questionnaire' })).toEqual([]);
  });

  it('uses the published programme questionnaire, including its labels, types and options', () => {
    expect(resolveProgramQuestionnaire(definition)).toEqual([
      {
        id: 'vehicle',
        title: 'Vehicle',
        questions: [
          {
            label: 'Cover Required',
            key: 'coverRequired',
            type: 'select',
            options: [
              'Third Party Liability',
              { value: 'Own Damage', label: 'Own Damage (Comprehensive)' },
            ],
            searchable: undefined,
            visibleWhen: undefined,
          },
        ],
      },
    ]);
  });

  it('does not fill omitted fields or options from Program.metadata or a product manifest', () => {
    const result = resolveProgramQuestionnaire({
      ...definition,
      questionnaire: {
        ...definition.questionnaire,
        sections: [{
          id: 'vehicle',
          title: 'Vehicle',
          questions: [{ label: 'Configured question only', key: 'coverRequired', type: 'select' }],
        }],
      },
      metadata: {
        underwritingQuestionnaire: [{
          title: 'Ignored legacy metadata',
          questions: [{ label: 'Metadata question', key: 'legacy', type: 'text' }],
        }],
      },
    });
    expect(result[0]?.questions[0]).toMatchObject({
      label: 'Configured question only',
      key: 'coverRequired',
      type: 'select',
    });
    expect(result[0]?.questions[0]?.options).toBeUndefined();
    expect(result.some((section) => section.title === 'Ignored legacy metadata')).toBe(false);
  });

  it('moves policyholder details first for BO underwriting without changing customer order', () => {
    const definitionWithPolicyHolder = {
      ...definition,
      questionnaire: {
        ...definition.questionnaire,
        sections: [
          { id: 'vehicle', title: 'Vehicle', questions: [{ label: 'Make', key: 'make', type: 'text' }] },
          { id: 'policy-holder', title: 'Your details', questions: [{ label: 'Name', key: 'proposer.name', type: 'text' }] },
        ],
      },
    };
    const boResult = resolveProgramQuestionnaire(definitionWithPolicyHolder, { actor: 'underwriter', stage: 'quote' });
    const customerResult = resolveProgramQuestionnaire(definitionWithPolicyHolder, { actor: 'customer', stage: 'quote' });

    expect(boResult[0]?.id).toBe('policy-holder');
    expect(customerResult[0]?.id).toBe('vehicle');
  });

  it('uses the published visibility setting instead of exposing a question to every actor', () => {
    const visibleToUnderwriter = {
      ...definition,
      questionnaire: {
        ...definition.questionnaire,
        sections: [{
          id: 'internal',
          title: 'Internal review',
          questions: [{ label: 'Underwriter note', key: 'underwriter.note', type: 'textarea', visibility: 'underwriter' }],
        }],
      },
    };
    expect(resolveProgramQuestionnaire(visibleToUnderwriter, { actor: 'customer' })).toEqual([]);
    expect(resolveProgramQuestionnaire(visibleToUnderwriter, { actor: 'underwriter' })[0]?.questions[0]).toMatchObject({
      label: 'Underwriter note', visibility: 'underwriter',
    });
  });
});

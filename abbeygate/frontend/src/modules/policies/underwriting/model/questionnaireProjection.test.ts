import { describe, expect, it } from 'vitest';
import { NATIONALITY_OPTIONS, NATIONALITY_PAYLOAD_PATH } from '@facio/validation';
import {
  hasReplacementQuestionData,
  isQuestionVisibleForUnderwriting,
  resolveQuestionSelectOptions,
} from './questionnaireProjection';

describe('questionnaireProjection', () => {
  it('evaluates underwriting visibility from contract rule', () => {
    const visible = isQuestionVisibleForUnderwriting({
      fieldKey: 'claimsDetails',
      contractMeta: { visibleWhen: { field: 'hasClaims', equals: true } },
      visibleWhenOverride: undefined,
      context: { actor: 'underwriter', stage: 'quote' },
      quoteData: { hasClaims: true },
      dirtyFields: {},
    });
    expect(visible).toBe(true);
  });

  it('applies visibleWhen override before contract meta', () => {
    const visible = isQuestionVisibleForUnderwriting({
      fieldKey: 'claimsDetails',
      contractMeta: { visibleWhen: { field: 'hasClaims', equals: true } },
      visibleWhenOverride: { field: 'hasClaims', equals: false },
      context: { actor: 'underwriter', stage: 'quote' },
      quoteData: { hasClaims: true },
      dirtyFields: {},
    });
    expect(visible).toBe(false);
  });

  it('evaluates dotted visibleWhen fields against nested quote data', () => {
    const visible = isQuestionVisibleForUnderwriting({
      fieldKey: 'property.address.line1',
      contractMeta: undefined,
      visibleWhenOverride: { field: 'property.sameAsProposer', equals: false },
      context: { actor: 'underwriter', stage: 'quote' },
      quoteData: { property: { sameAsProposer: false } },
      dirtyFields: {},
    });
    expect(visible).toBe(true);
  });

  it('keeps current make/model value when outside dynamic options', () => {
    const { resolvedOptions } = resolveQuestionSelectOptions({
      fieldKey: 'make',
      currentValue: 'LegacyMake',
      questionOptions: [],
      makeOptions: [{ value: 'Toyota' }, { value: 'Honda' }],
      modelOptions: [],
    });
    expect(resolvedOptions[0]).toBe('LegacyMake');
  });

  it('normalizes legacy boolean-like yes/no values before resolving options', () => {
    const { resolvedOptions } = resolveQuestionSelectOptions({
      fieldKey: 'cabrio',
      currentValue: 'false',
      questionOptions: ['Yes', 'No'],
      makeOptions: [],
      modelOptions: [],
    });
    expect(resolvedOptions).toEqual(['Yes', 'No']);
  });

  it('uses centralized labels for labeled select options', () => {
    const { resolvedSelectOptions } = resolveQuestionSelectOptions({
      fieldKey: 'convictionClass',
      currentValue: 'minor_offence_10',
      questionOptions: [
        { value: 'minor_technical', label: 'Minor technical offence (no load)' },
        { value: 'minor_offence_10', label: 'Minor offence (10 points)' },
      ],
      makeOptions: [],
      modelOptions: [],
    });
    expect(resolvedSelectOptions).toEqual([
      { value: 'minor_technical', label: 'Minor technical offence (no load)' },
      { value: 'minor_offence_10', label: 'Minor offence (10 points)' },
    ]);
  });

  it('keeps centralized labels for numeric coded select options', () => {
    const { resolvedSelectOptions } = resolveQuestionSelectOptions({
      fieldKey: 'majorConvictionWithinYears',
      currentValue: '3',
      questionOptions: [
        { value: '2', label: 'Within last 2 years' },
        { value: '3', label: 'Within last 3 years' },
        { value: '5', label: 'Within last 5 years' },
      ],
      makeOptions: [],
      modelOptions: [],
    });
    expect(resolvedSelectOptions).toEqual([
      { value: '2', label: 'Within last 2 years' },
      { value: '3', label: 'Within last 3 years' },
      { value: '5', label: 'Within last 5 years' },
    ]);
  });

  it('sources canonical nationality options when manifest ships none', () => {
    const { resolvedOptions, resolvedSelectOptions, hasResolvedOptions } = resolveQuestionSelectOptions({
      fieldKey: NATIONALITY_PAYLOAD_PATH,
      currentValue: '',
      questionOptions: [],
      makeOptions: [],
      modelOptions: [],
    });
    expect(hasResolvedOptions).toBe(true);
    expect(resolvedOptions).toEqual([...NATIONALITY_OPTIONS]);
    expect(resolvedSelectOptions[0]).toEqual({ value: 'Afghanistan', label: 'Afghanistan' });
    expect(resolvedSelectOptions).toHaveLength(NATIONALITY_OPTIONS.length);
  });

  it('preserves a stale nationality value alongside the canonical list', () => {
    const { resolvedOptions } = resolveQuestionSelectOptions({
      fieldKey: NATIONALITY_PAYLOAD_PATH,
      currentValue: 'British',
      questionOptions: [],
      makeOptions: [],
      modelOptions: [],
    });
    expect(resolvedOptions[0]).toBe('British');
    expect(resolvedOptions).toContain('United Kingdom');
  });

  it('sources canonical country options for proposer country fields', () => {
    const { resolvedOptions, hasResolvedOptions } = resolveQuestionSelectOptions({
      fieldKey: 'proposer.domicileCountry',
      currentValue: '',
      questionOptions: [],
      makeOptions: [],
      modelOptions: [],
    });
    expect(hasResolvedOptions).toBe(true);
    expect(resolvedOptions).toEqual([...NATIONALITY_OPTIONS]);
  });

  it('lets manifest-supplied options win over the canonical fallback', () => {
    const { resolvedOptions } = resolveQuestionSelectOptions({
      fieldKey: NATIONALITY_PAYLOAD_PATH,
      currentValue: '',
      questionOptions: ['Cyprus', 'Portugal'],
      makeOptions: [],
      modelOptions: [],
    });
    expect(resolvedOptions).toEqual(['Cyprus', 'Portugal']);
  });

  it('detects replacement data for additional drivers', () => {
    const hasReplacementData = hasReplacementQuestionData({
      replacementKey: 'additionalDrivers',
      quoteData: {},
      dirtyFields: { additionalDrivers: [{ firstName: 'A' }] },
      normalizeAdditionalDrivers: (value) => (Array.isArray(value) ? value : []),
    });
    expect(hasReplacementData).toBe(true);
  });
});

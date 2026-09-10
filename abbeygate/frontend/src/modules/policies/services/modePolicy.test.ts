import { describe, expect, it } from 'vitest';
import {
  requirednessSeverityByMode,
  schemaSeverityByMode,
  shouldIncludeFieldInBlur,
} from './modePolicy';

describe('modePolicy', () => {
  it('uses warning severity for save requiredness', () => {
    expect(requirednessSeverityByMode('save')).toBe('warning');
    expect(requirednessSeverityByMode('blur')).toBe('error');
    expect(requirednessSeverityByMode('submit')).toBe('error');
  });

  it('keeps schema errors as blocking errors', () => {
    expect(schemaSeverityByMode('blur')).toBe('error');
    expect(schemaSeverityByMode('save')).toBe('error');
    expect(schemaSeverityByMode('submit')).toBe('error');
  });

  it('matches top-level and nested blur fields', () => {
    expect(shouldIncludeFieldInBlur({ focusField: 'additionalDrivers', candidateField: 'additionalDrivers.0.firstName' })).toBe(true);
    expect(shouldIncludeFieldInBlur({ focusField: 'additionalDrivers.0.firstName', candidateField: 'additionalDrivers' })).toBe(true);
    expect(shouldIncludeFieldInBlur({ focusField: 'email', candidateField: 'dateOfBirth' })).toBe(false);
  });
});


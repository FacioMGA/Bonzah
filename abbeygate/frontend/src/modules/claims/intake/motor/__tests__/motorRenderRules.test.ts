import { describe, expect, it } from 'vitest';
import {
  isPoliceReportRequired,
  isThirdPartyNameRequired,
  isThirdPartySectionVisible,
  isWindscreenSectionVisible,
} from '../motorRenderRules';

describe('motorRenderRules', () => {
  it('shows third-party requirements for collision losses', () => {
    const snapshot: Record<string, unknown> = { incident: { type: 'collision' }, thirdParty: { involved: true } };
    expect(isThirdPartySectionVisible(snapshot)).toBe(true);
    expect(isThirdPartyNameRequired(snapshot)).toBe(true);
  });

  it('requires police report for theft losses', () => {
    const snapshot: Record<string, unknown> = { incident: { type: 'theft' } };
    expect(isPoliceReportRequired(snapshot)).toBe(true);
  });

  it('shows windscreen fields and hides third-party for windscreen losses', () => {
    const snapshot: Record<string, unknown> = { incident: { type: 'windscreen' } };
    expect(isWindscreenSectionVisible(snapshot)).toBe(true);
    expect(isThirdPartySectionVisible(snapshot)).toBe(false);
  });
});

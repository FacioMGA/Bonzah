import { describe, expect, it } from 'vitest';
import { runReflexGates, gatesRequireHuman } from '../reflexGates.js';

describe('reflexGates', () => {
  it('refers when a trusted exposure exceeds the authority limit (CY-MTR-017 / EUR 25k DCA)', () => {
    const decisions = runReflexGates({ largestExposureAmount: 30000, authorityLimit: 25000, exposureTrusted: true, currency: 'EUR' });
    const gate = decisions.find((d) => d.code === 'AUTHORITY_THRESHOLD');
    expect(gate?.status).toBe('REFER');
    expect(gatesRequireHuman(decisions)).toBe(true);
  });

  it('passes when the trusted exposure is within authority', () => {
    const decisions = runReflexGates({ largestExposureAmount: 10000, authorityLimit: 25000, exposureTrusted: true });
    expect(decisions.find((d) => d.code === 'AUTHORITY_THRESHOLD')?.status).toBe('PASS');
    expect(gatesRequireHuman(decisions)).toBe(false);
  });

  it('cannot assert authority when the exposure is not trusted', () => {
    const decisions = runReflexGates({ largestExposureAmount: 30000, authorityLimit: 25000, exposureTrusted: false });
    expect(decisions.find((d) => d.code === 'AUTHORITY_THRESHOLD')?.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('blocks when required evidence is outstanding', () => {
    const decisions = runReflexGates({
      requiredEvidence: [
        { documentType: 'police_report', satisfied: false },
        { documentType: 'v5_registration', satisfied: false },
        { documentType: 'claim_form', satisfied: true },
      ],
    });
    const gate = decisions.find((d) => d.code === 'MISSING_REQUIRED_EVIDENCE');
    expect(gate?.status).toBe('BLOCK');
    expect(gate?.detail?.missing).toEqual(['police_report', 'v5_registration']);
  });

  it('blocks on a breached trusted endorsement condition but defers an untrusted one', () => {
    const breached = runReflexGates({ endorsementConditions: [{ endorsementRef: 'E141', condition: 'GESY proof', satisfied: false, trusted: true }] });
    expect(breached.find((d) => d.code === 'ENDORSEMENT_CONDITION')?.status).toBe('BLOCK');

    const untrusted = runReflexGates({ endorsementConditions: [{ endorsementRef: 'E141', condition: 'GESY proof', satisfied: false, trusted: false }] });
    expect(untrusted.find((d) => d.code === 'ENDORSEMENT_CONDITION')?.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('falls back to insufficient evidence below the trusted-fact floor', () => {
    const decisions = runReflexGates({ trustedFactCount: 1, minTrustedFacts: 3 });
    expect(decisions.find((d) => d.code === 'INSUFFICIENT_EVIDENCE')?.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('skips gates whose inputs are absent', () => {
    expect(runReflexGates({})).toEqual([]);
  });
});

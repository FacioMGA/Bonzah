import { describe, expect, it } from 'vitest';
import { resolvePrecedence, type PrecedenceCandidate } from '../precedenceResolver.js';

describe('precedenceResolver', () => {
  it('lets a current endorsement govern over the formal policy wording (Endorsement 141)', () => {
    const candidates: PrecedenceCandidate[] = [
      { id: 'policy', sourceClass: 'FORMAL_POLICY', effectiveDate: '2025-01-01', versionStatus: 'CURRENT', label: 'Master wording' },
      { id: 'e141', sourceClass: 'ENDORSEMENT', effectiveDate: '2026-01-01', versionStatus: 'CURRENT', label: 'Endorsement 141 (GESY)' },
    ];
    const result = resolvePrecedence(candidates, { asOf: '2026-06-01' });
    expect(result.winner?.id).toBe('e141');
    expect(result.rationale).toContain('Endorsement 141');
  });

  it('excludes superseded, draft, expired, and not-yet-effective sources', () => {
    const candidates: PrecedenceCandidate[] = [
      { id: 'old', sourceClass: 'ENDORSEMENT', versionStatus: 'SUPERSEDED' },
      { id: 'draft', sourceClass: 'ENDORSEMENT', versionStatus: 'DRAFT' },
      { id: 'future', sourceClass: 'ENDORSEMENT', effectiveDate: '2099-01-01' },
      { id: 'policy', sourceClass: 'FORMAL_POLICY', versionStatus: 'CURRENT' },
    ];
    const result = resolvePrecedence(candidates, { asOf: '2026-06-01' });
    expect(result.winner?.id).toBe('policy');
  });

  it('excludes jurisdiction / product mismatches', () => {
    const candidates: PrecedenceCandidate[] = [
      { id: 'gb-endo', sourceClass: 'ENDORSEMENT', jurisdiction: 'GB' },
      { id: 'cy-policy', sourceClass: 'FORMAL_POLICY', jurisdiction: 'CY' },
    ];
    const result = resolvePrecedence(candidates, { jurisdiction: 'CY', product: 'MOTOR' });
    expect(result.winner?.id).toBe('cy-policy');
  });

  it('returns no winner when nothing is eligible', () => {
    const result = resolvePrecedence([{ id: 'draft', sourceClass: 'ENDORSEMENT', versionStatus: 'DRAFT' }]);
    expect(result.winner).toBeNull();
    expect(result.rationale).toContain('No eligible source');
  });

  it('is deterministic on ties via stable id ordering', () => {
    const candidates: PrecedenceCandidate[] = [
      { id: 'b', sourceClass: 'ENDORSEMENT' },
      { id: 'a', sourceClass: 'ENDORSEMENT' },
    ];
    expect(resolvePrecedence(candidates).winner?.id).toBe('a');
  });
});

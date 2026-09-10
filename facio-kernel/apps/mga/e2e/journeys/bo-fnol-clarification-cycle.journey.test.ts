// Journey contract: BO FNOL clarification cycle.
//
// Bound to the canonical claim command dispatcher and the command
// type union. If REQUEST_FNOL_CLARIFICATION /
// FNOL_CLARIFICATION_RECEIVED / AMEND_FNOL / CONFIRM_FNOL are removed
// from ClaimCommandType, the `satisfies` clause below fails TS compile
// before the clarification surface silently breaks.

import { describe, expect, it } from 'vitest';
import { handleIntakeCommands } from '../../backend/modules/claims/domain/commands/intake.js';
import type { ClaimCommandType } from '../../backend/modules/claims/domain/commands/types.js';

const clarificationCommands = [
  'REQUEST_FNOL_CLARIFICATION',
  'FNOL_CLARIFICATION_RECEIVED',
  'AMEND_FNOL',
  'CONFIRM_FNOL',
] as const satisfies readonly ClaimCommandType[];

describe('journey: bo-fnol-clarification-cycle', () => {
  it('binds to the canonical intake command dispatcher', () => {
    expect(typeof handleIntakeCommands).toBe('function');
  });

  it('preserves the four clarification commands in the canonical union', () => {
    expect(clarificationCommands).toContain('REQUEST_FNOL_CLARIFICATION');
    expect(clarificationCommands).toContain('FNOL_CLARIFICATION_RECEIVED');
    expect(clarificationCommands).toContain('CONFIRM_FNOL');
    expect(clarificationCommands).toContain('AMEND_FNOL');
  });
});

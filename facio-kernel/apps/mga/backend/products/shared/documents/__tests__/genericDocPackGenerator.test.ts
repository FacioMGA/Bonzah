import { describe, expect, it } from 'vitest';
import { resolveDocPackVersion } from '../docPackVersion.js';

describe('resolveDocPackVersion', () => {
  it('reuses the active issued-pack version during recovery', () => {
    expect(resolveDocPackVersion({
      docPack: 'ISSUED_POLICY_PACK',
      latestVersion: 3,
      activeVersion: 3,
    })).toBe(3);
  });

  it('starts an issued pack at version one when no active document exists', () => {
    expect(resolveDocPackVersion({
      docPack: 'ISSUED_POLICY_PACK',
      latestVersion: null,
      activeVersion: null,
    })).toBe(1);
  });

  it('keeps versioned regeneration for non-issued packs', () => {
    expect(resolveDocPackVersion({
      docPack: 'ENDORSEMENT_PACK',
      latestVersion: 3,
      activeVersion: 3,
    })).toBe(4);
  });
});

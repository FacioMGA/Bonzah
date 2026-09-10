/**
 * Regression test for the platform → modules layer inversion fix.
 *
 * Before this fix, `backend/platform/events/policyEmailOrchestration.ts`
 * did:
 *
 *   import { ProductRegistry } from '../../modules/policy/domain/ProductRegistry.js';
 *
 * That violates `lint:layers` (`platform/` cannot import from `modules/`)
 * and is the architectural inversion that lets product knowledge leak
 * into the platform spine.
 *
 * The fix:
 *   1. Removes the `ProductRegistry` import from the platform module.
 *   2. Removes the local `resolveRequiredIssuedDocTypes` /
 *      `resolveEndorsementDocTypes` / `resolvePolicyDocRequirements`
 *      helpers (which baked product knowledge into platform).
 *   3. Adds `requiredIssuedDocTypes` / `requiredEndorsementDocTypes`
 *      parameters so callers (workers + module app services) inject the
 *      product-resolved arrays from above.
 *
 * This test guarantees the import direction never regresses, regardless
 * of whether someone replays the same fix later or accidentally re-adds
 * a similar shortcut.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ORCHESTRATOR = path.resolve(
  __dirname,
  '..',
  'policyEmailOrchestration.ts',
);

describe('platform/events/policyEmailOrchestration — layer purity (regression)', () => {
  const source = readFileSync(ORCHESTRATOR, 'utf8');

  it('does not import from any sibling backend module (`backend/modules/**`)', () => {
    const offenders = source
      .split('\n')
      .map((line, idx) => ({ line, idx: idx + 1 }))
      .filter(({ line }) => /^\s*import[\s\S]*from\s+['"]/.test(line))
      .filter(({ line }) => /['"][^'"\n]*\bmodules\/[^'"\n]+['"]/.test(line));

    expect(offenders, `platform/ must not import from modules/. Offenders:\n${offenders.map((o) => `  L${o.idx}: ${o.line}`).join('\n')}`).toEqual([]);
  });

  it('does not reference ProductRegistry directly (product knowledge is injected, not imported)', () => {
    expect(source).not.toMatch(/\bProductRegistry\b/);
  });

  it('exports the welcome-email helper with an injected requiredIssuedDocTypes parameter', () => {
    expect(source).toMatch(
      /export\s+async\s+function\s+maybeSendWelcomeEmailForIssuedPack\s*\(args:\s*\{[\s\S]*?requiredIssuedDocTypes\s*:\s*readonly\s+string\[\]/m,
    );
  });

  it('builds issued-pack welcome attachments strictly from injected requiredIssuedDocTypes', () => {
    expect(source).toMatch(/type:\s*\{\s*in:\s*\[\.\.\.requiredIssuedDocTypes\]\s*\}/m);
    expect(source).toMatch(/const\s+missing\s*=\s*requiredIssuedDocTypes\.filter/m);
    expect(source).toMatch(/for\s*\(\s*const\s+t\s+of\s+requiredIssuedDocTypes\s*\)/m);
    expect(source).not.toMatch(/HOME_CERTIFICATE_PDF|TRAVEL_CERTIFICATE_PDF|MOTOR_CERTIFICATE_PDF/);
  });

  it('gives genuine internal sale notifications a tenant-aware BO policy link', () => {
    expect(source).toContain('adminUrl: buildBackOfficePolicyUrl(');
    expect(source).toContain('resolvePublicAppBaseUrlFromTenant(),');
    expect(source).toContain('args.policyId,');
  });

  it('routes synthetic issuance-proof welcome email to ISSUANCE_PROOF_WELCOME_TO', () => {
    expect(source).toContain('function resolveIssuanceProofWelcomeTo()');
    expect(source).toMatch(/const toEmail = isSyntheticProof[\s\S]*resolveIssuanceProofWelcomeTo\(\)/m);
  });

  it('exports the endorsement-email helper with both injected doc-type parameters', () => {
    expect(source).toMatch(
      /export\s+async\s+function\s+sendEndorsementIssueEmailWithAttachments\s*\(args:\s*\{[\s\S]*?requiredIssuedDocTypes\s*:\s*readonly\s+string\[\][\s\S]*?requiredEndorsementDocTypes\s*:\s*readonly\s+string\[\]/m,
    );
  });
});

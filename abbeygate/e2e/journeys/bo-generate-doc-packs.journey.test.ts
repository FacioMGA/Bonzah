// Journey contract: BO generate quote pack + issued pack.
//
// Bound to the three canonical doc-pack workers. ADR-0013 (issuance
// spine) requires DOC.GENERATE_ISSUED_POLICY_PACK to arrive as a
// DomainEventEnvelope, so we also assert the handler rejects raw
// payloads — a regression would silently re-enable bypass enqueues.

import { describe, expect, it, vi } from 'vitest';

// Doc-pack handlers transitively pull in pdfRenderer -> puppeteer at
// import time. Stub puppeteer so the journey contract test does not
// race with the chromium dynamic-import while the vitest worker
// closes the rpc. The puppeteer surface is exercised at tier 2 via
// templates_render_smoke.test.ts.
vi.mock('puppeteer', () => ({ default: { launch: vi.fn() } }));

import { runIssuedPackJob } from '../../backend/workers/handlers/DOC.GENERATE_ISSUED_POLICY_PACK.js';
import { handleGenerateMotorDocPack } from '../../backend/workers/handlers/DOC.GENERATE_MOTOR_DOC_PACK.js';
import { handleGenerateQuotePack } from '../../backend/workers/handlers/DOC.GENERATE_QUOTE_PACK.js';

describe('journey: bo-generate-doc-packs', () => {
  it('exposes the canonical doc-pack handlers', () => {
    expect(typeof runIssuedPackJob).toBe('function');
    expect(typeof handleGenerateMotorDocPack).toBe('function');
    expect(typeof handleGenerateQuotePack).toBe('function');
  });

  it('issued-pack handler rejects non-envelope payloads (ADR-0013 enforcement)', async () => {
    await expect(runIssuedPackJob({ policyId: 'p_1' })).rejects.toThrow(
      /envelope|DomainEventEnvelope/i,
    );
    await expect(runIssuedPackJob(null)).rejects.toThrow();
  });
});

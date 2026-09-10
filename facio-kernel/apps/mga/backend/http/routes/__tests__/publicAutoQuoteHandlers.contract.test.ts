import { describe, expect, it } from 'vitest';

// publicAutoQuoteHandlers.ts is the thin lazy-binding layer the
// genericPublicQuoteRouter uses for MOTOR. Each export is a function
// that resolves to a controller method on first invocation. The
// contract this file pins: every motor-controller seam the router
// depends on remains exported and remains an Express handler shape.

import * as handlers from '../../../modules/quotes/http/publicAutoQuoteHandlers.js';

const EXPECTED_HANDLER_NAMES = [
  'createSessionHandler',
  'forkHandler',
  'generateQuotePackHandler',
  'getIssueReadinessHandler',
  'getRecommendationsHandler',
  'getSessionHandler',
  'issuedPackHandler',
  'patchSessionHandler',
  'rateHandler',
  'recoEventHandler',
  'requestCallbackHandler',
  'sendQuoteEmailHandler',
  'unlockHandler',
] as const;

// `Reflect.get` is the typed read-by-string for a module namespace —
// avoids the double-cast through `unknown` that the `any-baseline`
// ratchet flags as laundering. The return type is `unknown` from the
// test's perspective; the `typeof` / `.length` checks below narrow on
// the runtime value, which is what the contract is about.
function readHandlerByName(name: string): unknown {
  return Reflect.get(handlers, name);
}

describe('publicAutoQuoteHandlers — handler export contract', () => {
  it('exports every handler the genericPublicQuoteRouter wires to motor', () => {
    for (const name of EXPECTED_HANDLER_NAMES) {
      expect(typeof readHandlerByName(name), `${name} must be exported as a function`).toBe('function');
    }
  });

  it('each handler accepts the canonical (req, res, next?) Express signature', () => {
    for (const name of EXPECTED_HANDLER_NAMES) {
      const handler = readHandlerByName(name);
      if (typeof handler !== 'function') {
        throw new Error(`${name} must be exported as a function`);
      }
      expect(handler.length, `${name} must take 2 or 3 positional parameters`).toBeGreaterThanOrEqual(2);
      expect(handler.length).toBeLessThanOrEqual(3);
    }
  });
});

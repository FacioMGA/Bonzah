import { z } from 'zod';

/**
 * Sliding admin-fee bands for Travel — Andy (Abbeygate) 2026-05-16.
 *
 * Replaces the flat tenant-driven `adminFee` for Travel. Per Andy's
 * directive, fees apply on **net premium** (pre-tax), Travel-only.
 *
 * Bands as currently signed off (active-sale):
 *   - Net premium ≤ €70  → fee €7
 *   - Net premium €71–€200 → fee €18
 *   - Net premium €201+  → fee €25
 *
 * Schema invariants (failed loud at load time):
 *   - At least one band.
 *   - Exactly one open-ended band (`uptoNet: null` — the "and over" tier).
 *   - The open-ended band must be the LAST entry; ordering matters.
 *   - All `uptoNet` thresholds are positive numbers; `fee` is non-negative.
 *
 * Schema-driven so a future band rotation is a one-line JSON edit and a
 * redeploy — no code change. Per the canonical-ownership "Product rate
 * tables" row, this lives as JSON + zod + loader; inline TS literals are
 * forbidden by `check-no-inline-rate-tables.mjs`.
 */

const FeeBandSchema = z.object({
  uptoNet: z.union([z.number().positive(), z.null()]),
  fee: z.number().min(0),
});
export type TravelFeeBand = z.infer<typeof FeeBandSchema>;

export const TravelFeeBandsSchema = z.object({
  version: z.string().min(1),
  appliesTo: z.literal('net_premium'),
  bands: z.array(FeeBandSchema).min(1),
}).superRefine((data, ctx) => {
  const openIdx = data.bands.findIndex((b) => b.uptoNet === null);
  if (openIdx === -1) {
    ctx.addIssue({
      code: 'custom',
      message: 'Exactly one band must be open-ended (uptoNet: null) — the "and over" tier.',
      path: ['bands'],
    });
    return;
  }
  if (openIdx !== data.bands.length - 1) {
    ctx.addIssue({
      code: 'custom',
      message: 'The open-ended band (uptoNet: null) must be the LAST band in the list.',
      path: ['bands'],
    });
  }
  const openCount = data.bands.filter((b) => b.uptoNet === null).length;
  if (openCount > 1) {
    ctx.addIssue({
      code: 'custom',
      message: `Only one band may be open-ended; found ${openCount}.`,
      path: ['bands'],
    });
  }
  // Closed bands must be in strictly ascending order so the resolver
  // can walk them top-down without ambiguity.
  const closed = data.bands.slice(0, openIdx);
  for (let i = 1; i < closed.length; i += 1) {
    const prev = closed[i - 1].uptoNet as number;
    const curr = closed[i].uptoNet as number;
    if (curr <= prev) {
      ctx.addIssue({
        code: 'custom',
        message: `Bands must be strictly ascending by uptoNet; band ${i} (uptoNet: ${curr}) is not greater than band ${i - 1} (uptoNet: ${prev}).`,
        path: ['bands', i, 'uptoNet'],
      });
    }
  }
});
export type TravelFeeBands = z.infer<typeof TravelFeeBandsSchema>;

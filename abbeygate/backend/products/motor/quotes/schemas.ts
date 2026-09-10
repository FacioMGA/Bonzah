import { z } from 'zod';

/**
 * Phase 8 (2026-04-28) strictness: deleted `.passthrough()` and the
 * `z.union([z.string(), z.number()])` tolerance on `overrideExcess`.
 * Unknown body keys are silently stripped; `overrideExcess` rejects
 * string-shaped values. Callers must send a properly-typed payload.
 */

function normalizeVehicleTypeSeed(value: unknown): unknown {
  const raw = String(value || '').trim();
  const key = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (key === 'car' || key === 'motor') return 'Car';
  if (key === 'motorbike' || key === 'motorcycle' || key === 'bike') return 'Motorbike';
  if (key === 'motorcaravan' || key === 'motor caravan' || key === 'caravan' || key === 'motorhome') return 'Motorcaravan';
  if (key === 'van' || key === 'van to 3.5 tons' || key === 'van to 3 5 tons') return 'Van to 3.5 tons';
  return value;
}

export const CreateSessionBodySchema = z.object({
  sessionKey: z.string().trim().min(1).optional(),
  origin: z.enum(['customer', 'bo']).optional(),
  vehicleType: z.preprocess(
    normalizeVehicleTypeSeed,
    z.enum(['Car', 'Motorbike', 'Motorcaravan', 'Van to 3.5 tons']).optional(),
  ),
});

export const PatchSessionBodySchema = z.object({
  quoteData: z.record(z.string(), z.any()),
  step: z.string().trim().min(1).optional(),
  origin: z.enum(['customer', 'bo']).optional(),
  materializeAccount: z.boolean().optional(),
  customerAccountResolution: z.object({
    action: z.enum(['attachExisting', 'createNew']),
    policyHolderId: z.string().trim().min(1).optional(),
  }).refine(
    (value) => value.action === 'createNew' || Boolean(value.policyHolderId),
    'policyHolderId is required when attaching an existing customer account'
  ).optional(),
});

export const RateSessionBodySchema = z.object({
  quoteData: z.record(z.string(), z.any()),
  overrideExcess: z.number().optional(),
  previewOnly: z.boolean().optional(),
  coverageSelection: z.object({
    selected: z.record(z.string(), z.boolean()).optional(),
    params: z.record(z.string(), z.any()).optional(),
    source: z.string().optional(),
  }).optional(),
});

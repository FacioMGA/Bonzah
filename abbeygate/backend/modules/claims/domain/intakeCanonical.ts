import { z } from 'zod';

/**
 * Canonical FNOL intake shape — the single source of truth for the
 * "First Notice of Loss" payload across BO, customer, and public
 * portals.
 *
 * `spine/v2` Wave 5 deleted the prior 60-line alias-resolution body
 * (`pickText` over many path tuples like `incidentDate | claimType |
 * incident.type | incident.lossType | …`). Frontends used to emit two
 * parallel shapes (`fnolPayload` + `finalForm`) plus flat aliases at
 * the top of `fnolPayload`; backends accepted all of them. That was
 * the drift surface the reviewer flagged. The FE now emits ONLY this
 * shape (see `frontend/src/modules/claims/intake/actions/clientFnol.submit.ts`)
 * and every receiving route runs a thin `.parse` instead of an alias
 * walk.
 */
export const CanonicalIntakeSchema = z.object({
  schemaVersion: z.number().int().optional(),
  mode: z.string().optional(),
  incident: z.object({
    type: z.string().trim().optional(),
    date: z.string().trim().optional(),
    time: z.string().trim().nullable().optional(),
    location: z.object({
      address: z.string().trim().nullable().optional(),
      city: z.string().trim().nullable().optional(),
      country: z.string().trim().nullable().optional(),
    }).default(() => ({})),
    description: z.string().trim().optional(),
  }).default(() => ({ location: {} })),
  driver: z.object({
    kind: z.string().trim().optional(),
    id: z.string().trim().optional(),
    name: z.string().trim().nullable().optional(),
    dateOfBirth: z.string().trim().nullable().optional(),
    hasPermission: z.boolean().optional(),
    contact: z.object({
      phone: z.string().trim().nullable().optional(),
      email: z.string().trim().nullable().optional(),
    }).default(() => ({})),
    license: z.object({
      yearsHeld: z.number().nullable().optional(),
      issuedCountry: z.string().trim().nullable().optional(),
    }).default(() => ({})),
  }).default(() => ({ contact: {}, license: {} })),
  thirdParty: z.object({
    involved: z.boolean().optional(),
    counts: z.object({
      anotherCar: z.number().int().optional(),
      pedestrian: z.number().int().optional(),
      property: z.number().int().optional(),
    }).default(() => ({})),
    kinds: z.array(z.string()).default([]),
    anotherCars: z.array(z.record(z.string(), z.unknown())).default([]),
    pedestrians: z.array(z.record(z.string(), z.unknown())).default([]),
    properties: z.array(z.record(z.string(), z.unknown())).default([]),
  }).default(() => ({ counts: {}, kinds: [], anotherCars: [], pedestrians: [], properties: [] })),
  police: z.object({
    involved: z.boolean().optional(),
    reportNumber: z.string().trim().nullable().optional(),
    station: z.string().trim().nullable().optional(),
  }).default({}),
  triage: z.object({
    carDrivable: z.boolean().nullable().optional(),
    needTow: z.boolean().optional(),
    injuriesReported: z.boolean().nullable().optional(),
  }).default(() => ({})),
  evidence: z.object({
    accidentLocation: z.array(z.string()).default([]),
    vehicleDamage: z.array(z.string()).default([]),
    policeReport: z.array(z.string()).default([]),
    drivingLicence: z.array(z.string()).default([]),
    vehicleRegistrationCertificate: z.array(z.string()).default([]),
  }).default(() => ({
    accidentLocation: [],
    vehicleDamage: [],
    policeReport: [],
    drivingLicence: [],
    vehicleRegistrationCertificate: [],
  })),
  declarationAccepted: z.boolean().optional(),
});

export type CanonicalIntake = z.infer<typeof CanonicalIntakeSchema>;

/**
 * Parse + normalize the FNOL intake payload into `CanonicalIntake`.
 *
 * Thin wrapper over `CanonicalIntakeSchema.parse`. Throws a `ZodError`
 * when the payload doesn't match the canonical shape — callers must
 * map that to a 400 (the route handlers already do).
 */
export function normalizeCanonicalIntake(raw: unknown): CanonicalIntake {
  return CanonicalIntakeSchema.parse(raw);
}

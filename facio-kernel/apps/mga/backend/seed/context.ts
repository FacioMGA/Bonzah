// Shared seed-script context. Holds the singleton PrismaClient,
// re-exports the canonical program/binder fixtures, and surfaces
// the env-var flag controlling whether binder rows are overwritten
// when re-seeded. Imported by every per-stage module under `./`.

import { PrismaClient } from '@prisma/client';
import {
  CANONICAL_PROGRAMS,
  canonicalBindersForProduct,
  LEGACY_MOTOR_BINDER_ID,
  statusForCanonicalPeriod,
} from '../modules/policy/app/binders/canonicalProgramBinderSeed.js';

if (!process.env.DATABASE_URL) throw new Error('FATAL: DATABASE_URL is not set');

export const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

export {
  CANONICAL_PROGRAMS,
  canonicalBindersForProduct,
  LEGACY_MOTOR_BINDER_ID,
  statusForCanonicalPeriod,
};

export const SEEDED_PROGRAM_ID = CANONICAL_PROGRAMS.MOTOR.id;
export const SEEDED_HOME_PROGRAM_ID = CANONICAL_PROGRAMS.HOME.id;
export const SEEDED_TRAVEL_PROGRAM_ID = CANONICAL_PROGRAMS.TRAVEL.id;
export const SEEDED_HEALTH_PROGRAM_ID = CANONICAL_PROGRAMS.HEALTH.id;
export const YEAR_BINDERS = canonicalBindersForProduct('MOTOR');
export const HOME_BINDERS = canonicalBindersForProduct('HOME');
export const TRAVEL_BINDERS = canonicalBindersForProduct('TRAVEL');
// HEALTH has no dedicated binder rows — it overlays BRIT travel binders
// (see backend/seed/binders.ts HEALTH overlay loop).
export const SEED_OVERWRITE_BINDERS = process.env.SEED_OVERWRITE_BINDERS === '1';

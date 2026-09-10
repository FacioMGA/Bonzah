import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { ClassicCarRatesSchema, type ClassicCarRates } from './classic-car-rates.schema.js';
import {
  AbbeygateAutoCyprus2022MatrixSchema,
  type AbbeygateAutoCyprus2022Matrix,
} from './abbeygate-auto-cyprus-2022.schema.js';

const moduleDir = path.dirname(url.fileURLToPath(import.meta.url));
const CLASSIC_DATA_PATH = path.join(moduleDir, 'classic-car-rates.json');
const ABBEYGATE_AUTO_CY_2022_DATA_PATH = path.join(moduleDir, 'abbeygate-auto-cyprus-2022.json');

let cachedClassic: ClassicCarRates | null = null;
let cachedAbbeygateAutoCy2022: AbbeygateAutoCyprus2022Matrix | null = null;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const child = (value as Record<string, unknown>)[key];
      if (child && typeof child === 'object' && !Object.isFrozen(child)) {
        deepFreeze(child);
      }
    }
  }
  return value;
}

/**
 * Load the classic-car rates from disk, validate against the schema, and
 * deep-freeze. Cached after first call.
 *
 * Throws on missing file or schema-validation failure: this is intentional.
 * Bad rates must crash startup loudly rather than silently mispricing
 * policies. See `docs/architecture/contracts/canonical-ownership.md`.
 */
export function loadClassicCarRates(): ClassicCarRates {
  if (cachedClassic) return cachedClassic;
  const raw = fs.readFileSync(CLASSIC_DATA_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const validated = ClassicCarRatesSchema.parse(parsed);
  cachedClassic = deepFreeze(validated);
  return cachedClassic;
}

/**
 * Test-only: drop the cached value so a fresh load + re-validate runs on the
 * next call. Production code must never call this.
 */
export function __resetClassicCarRatesCacheForTests(): void {
  cachedClassic = null;
}

/**
 * Load the Abbeygate Cyprus 2022 motor rating matrix from disk, validate
 * against the schema, transform `null` upper-bound sentinels into
 * `Number.POSITIVE_INFINITY` (so existing band-lookup consumers keep
 * working unchanged), and deep-freeze. Cached after first call.
 *
 * Throws on missing file or schema-validation failure — same loud-failure
 * policy as `loadClassicCarRates`.
 */
export function loadAbbeygateAutoCyprus2022Matrix(): AbbeygateAutoCyprus2022Matrix {
  if (cachedAbbeygateAutoCy2022) return cachedAbbeygateAutoCy2022;
  const raw = fs.readFileSync(ABBEYGATE_AUTO_CY_2022_DATA_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const validated = AbbeygateAutoCyprus2022MatrixSchema.parse(parsed);
  cachedAbbeygateAutoCy2022 = deepFreeze(validated);
  return cachedAbbeygateAutoCy2022;
}

/**
 * Test-only: drop the cached value so a fresh load + re-validate runs on the
 * next call. Production code must never call this.
 */
export function __resetAbbeygateAutoCyprus2022MatrixCacheForTests(): void {
  cachedAbbeygateAutoCy2022 = null;
}

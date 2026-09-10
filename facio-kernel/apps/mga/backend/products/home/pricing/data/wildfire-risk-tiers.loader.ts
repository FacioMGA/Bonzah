import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WildfireRiskTiersSchema, type WildfireRiskTiers } from './wildfire-risk-tiers.schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'wildfire-risk-tiers.json');

let cached: WildfireRiskTiers | null = null;

function deepFreeze<T>(input: T): T {
  if (input === null || typeof input !== 'object') return input;
  Object.freeze(input);
  for (const value of Object.values(input)) {
    deepFreeze(value);
  }
  return input;
}

export function loadWildfireRiskTiers(): WildfireRiskTiers {
  if (cached) return cached;
  const raw = readFileSync(DATA_FILE, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  const validated = WildfireRiskTiersSchema.parse(parsed);
  cached = deepFreeze(validated);
  return cached;
}

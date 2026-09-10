/**
 * sampleInboxAdapter — load bundled demo threads as normalized messages
 * (ADR-0044). Lets the demo run with zero OAuth.
 *
 * Reads JSON files from the sample corpus directory. Each file is either a
 * single NormalizedOutlookMessage or an array of them. The demo scenario
 * pack writes these files (Part G); absent a corpus the adapter returns [].
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../../../../platform/utils/logger.js';
import {
  isNormalizedOutlookMessage,
  type NormalizedOutlookMessage,
} from '../../domain/providers/outlookMessage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SAMPLE_DIR = path.join(__dirname, 'sample');

function sampleDir(): string {
  const override = String(process.env.ORG2VEC_SAMPLE_DIR || '').trim();
  return override || DEFAULT_SAMPLE_DIR;
}

/** Load all sample messages, optionally filtered to one conversation/file key. */
export async function loadSampleInbox(filterKey?: string): Promise<NormalizedOutlookMessage[]> {
  const dir = sampleDir();
  let entries: string[];
  try {
    entries = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    logger.warn({ event: 'org2vec.sample.dir_missing', dir }, 'org2vec.sample.dir_missing');
    return [];
  }

  const selected = filterKey
    ? entries.filter((f) => f.toLowerCase().includes(filterKey.toLowerCase()))
    : entries;

  const out: NormalizedOutlookMessage[] = [];
  for (const file of selected) {
    try {
      const raw: unknown = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
      const candidates = Array.isArray(raw) ? raw : [raw];
      for (const candidate of candidates) {
        if (isNormalizedOutlookMessage(candidate)) out.push(candidate);
      }
    } catch (err) {
      logger.warn({ event: 'org2vec.sample.parse_failed', file, err }, 'org2vec.sample.parse_failed');
    }
  }
  return out;
}

/** Distinct conversation keys available in the sample corpus. */
export async function listSampleConversations(): Promise<string[]> {
  const messages = await loadSampleInbox();
  return Array.from(new Set(messages.map((m) => m.conversationId)));
}

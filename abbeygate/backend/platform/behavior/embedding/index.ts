/**
 * Embedder factory.
 *
 * Selection rule:
 *   - If `OPENAI_API_KEY` is set, use the OpenAI text-embedding-3-small.
 *   - Otherwise, use the deterministic stub.
 *
 * The factory is memoized so callers don't re-instantiate per event. Tests
 * may bypass this by constructing the concrete classes directly.
 */
import { logger } from '../../utils/logger.js';
import type { Embedder } from './embedder.js';
import { StubEmbedder } from './stubEmbedder.js';
import { OpenAIEmbedder } from './openaiEmbedder.js';

export { EMBEDDING_DIM } from './embedder.js';
export type { Embedder } from './embedder.js';
export { StubEmbedder } from './stubEmbedder.js';
export { OpenAIEmbedder } from './openaiEmbedder.js';

let cached: Embedder | null = null;

export function getEmbedder(): Embedder {
  if (cached) return cached;
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (key) {
    logger.info({ embedder: 'openai-text-embedding-3-small' }, 'behavior.embedder.selected');
    cached = new OpenAIEmbedder(key);
  } else {
    logger.info({ embedder: 'stub-sha512-1536' }, 'behavior.embedder.selected');
    cached = new StubEmbedder();
  }
  return cached;
}

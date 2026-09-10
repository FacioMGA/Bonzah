/**
 * Deterministic stub embedder.
 *
 * Why exist?
 *   - Lets the entire Behavior pipeline run offline (no API key, no network).
 *   - Identical input → identical vector → unit tests are reproducible.
 *   - The vector lives on the same unit sphere as a real OpenAI vector
 *     (L2-normalized to magnitude 1), so cosine similarity downstream
 *     behaves the same way; only the *meaning* of similarity changes.
 *
 * Not a model: the stub does NOT capture semantics. Two paraphrased
 * sentences will get unrelated vectors. That is fine for local/test runs — when
 * `OPENAI_API_KEY` is set, the factory swaps in real embeddings.
 */
import { createHash } from 'node:crypto';
import { EMBEDDING_DIM, type Embedder } from './embedder.js';
import { l2Normalize } from '../vector.js';

const HASH_BYTES = EMBEDDING_DIM * 4; // 4 bytes per float32 component

function deterministicBytes(text: string): Buffer {
  let out = Buffer.alloc(0);
  let counter = 0;
  while (out.length < HASH_BYTES) {
    const h = createHash('sha512');
    h.update(text);
    h.update(`:${counter}`);
    out = Buffer.concat([out, h.digest()]);
    counter++;
  }
  return out.subarray(0, HASH_BYTES);
}

export class StubEmbedder implements Embedder {
  readonly name = 'stub-sha512-1536';

  async embed(text: string): Promise<number[]> {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      throw new Error('StubEmbedder.embed: text is required');
    }
    const bytes = deterministicBytes(trimmed);
    const raw = new Array<number>(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      // Pull a uint32, map to [-1, 1]. Cheap, deterministic, well-distributed.
      const u = bytes.readUInt32BE(i * 4);
      raw[i] = (u / 0xffffffff) * 2 - 1;
    }
    return l2Normalize(raw);
  }
}

/**
 * Embedder boundary.
 *
 * The trajectory layer must never know whether vectors come from OpenAI or a
 * deterministic stub. That is the only way to:
 *   - run integration tests offline
 *   - swap providers (Cohere, local model, ...)
 *   - keep local and test embeddings reproducible
 */

export const EMBEDDING_DIM = 1536;

export interface Embedder {
  /** Stable identifier for logs / telemetry. */
  readonly name: string;
  embed(text: string): Promise<number[]>;
}

/**
 * OpenAI text-embedding-3-small embedder.
 *
 * Implemented over `fetch` to avoid pulling a new SDK into the platform
 * without adding another runtime SDK. text-embedding-3-small returns 1536-dim L2-normalized
 * vectors — the same shape as our stub embedder, on the same unit sphere
 * as cosine similarity expects.
 */
import { logger } from '../../utils/logger.js';
import { EMBEDDING_DIM, type Embedder } from './embedder.js';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 500;

function embeddingTimeoutMs(): number {
  const configured = Number(process.env.OPENAI_EMBEDDINGS_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

function embeddingMaxAttempts(): number {
  const configured = Number(process.env.OPENAI_EMBEDDINGS_MAX_ATTEMPTS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_ATTEMPTS;
}

function embeddingTotalTimeoutMs(): number {
  const configured = Number(process.env.OPENAI_EMBEDDINGS_TOTAL_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TOTAL_TIMEOUT_MS;
}

function embeddingRetryBaseMs(): number {
  const configured = Number(process.env.OPENAI_EMBEDDINGS_RETRY_BASE_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : BASE_RETRY_DELAY_MS;
}

function bodySnippet(text: string): string {
  const t = (text || '').trim();
  return t ? ` ${t.slice(0, 300)}` : '';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number): number {
  // attempt is 0-based for the *next* retry after a failure.
  const base = embeddingRetryBaseMs() * 2 ** attempt;
  return base + Math.floor(Math.random() * 250);
}

/** Exported for unit tests — mirrors Creditsafe's transient classifier. */
export function isTransientOpenAiHttpStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function isTransientOpenAiError(error: Error): boolean {
  const status = extractHttpStatus(error.message);
  if (status !== null) return isTransientOpenAiHttpStatus(status);
  // Fetch reports DNS, reset and other transport failures as TypeError. Abort
  // is also transient while the total budget still has time remaining.
  return error instanceof TypeError || error.name === 'AbortError' || error.name === 'TimeoutError';
}

export class OpenAIEmbedder implements Embedder {
  readonly name = 'openai-text-embedding-3-small';

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error('OpenAIEmbedder requires an apiKey');
  }

  async embed(text: string): Promise<number[]> {
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('OpenAIEmbedder.embed: text is required');

    const maxAttempts = embeddingMaxAttempts();
    const deadline = Date.now() + embeddingTotalTimeoutMs();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) throw new Error('OpenAI embeddings failed: total timeout exceeded');
        return await this.requestEmbedding(trimmed, Math.min(embeddingTimeoutMs(), remainingMs));
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const status = extractHttpStatus(lastError.message);
        const retryable = isTransientOpenAiError(lastError);
        const hasAttemptsLeft = attempt < maxAttempts - 1;
        const remainingMs = deadline - Date.now();
        if (!retryable || !hasAttemptsLeft || remainingMs <= 0) throw lastError;

        const delayMs = Math.min(retryDelayMs(attempt), remainingMs);
        logger.warn({
          event: 'behavior.embedder.openai_retry',
          attempt: attempt + 1,
          maxAttempts,
          status,
          delayMs,
        }, 'behavior.embedder.openai_retry');
        await wait(delayMs);
      }
    }

    throw lastError ?? new Error('OpenAI embeddings failed after retries');
  }

  private async requestEmbedding(trimmed: string, timeoutMs: number): Promise<number[]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: trimmed,
      }),
      signal: AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs))),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`OpenAI embeddings failed: HTTP ${res.status}${bodySnippet(detail)}`);
    }

    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const vec = json?.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
      throw new Error(`OpenAI embeddings returned unexpected shape (len=${vec?.length})`);
    }
    return vec;
  }
}

function extractHttpStatus(message: string): number | null {
  const match = message.match(/HTTP (\d{3})/);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

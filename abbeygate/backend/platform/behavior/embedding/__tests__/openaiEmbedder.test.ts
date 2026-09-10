import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDING_DIM } from '../embedder.js';
import { isTransientOpenAiHttpStatus, OpenAIEmbedder } from '../openaiEmbedder.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function embeddingResponse(): Response {
  const vec = Array.from({ length: EMBEDDING_DIM }, (_, i) => (i + 1) / EMBEDDING_DIM);
  return new Response(JSON.stringify({ data: [{ embedding: vec }] }), { status: 200 });
}

describe('isTransientOpenAiHttpStatus', () => {
  it('treats 429 and 5xx as transient', () => {
    expect(isTransientOpenAiHttpStatus(429)).toBe(true);
    expect(isTransientOpenAiHttpStatus(500)).toBe(true);
    expect(isTransientOpenAiHttpStatus(503)).toBe(true);
  });

  it('does not treat 4xx (except 429) as transient', () => {
    expect(isTransientOpenAiHttpStatus(400)).toBe(false);
    expect(isTransientOpenAiHttpStatus(401)).toBe(false);
    expect(isTransientOpenAiHttpStatus(404)).toBe(false);
  });
});

describe('OpenAIEmbedder', () => {
  it('requires non-empty text', async () => {
    const embedder = new OpenAIEmbedder('test-key');
    await expect(embedder.embed('   ')).rejects.toThrow('text is required');
  });

  it('returns the embedding vector on success', async () => {
    const fetchMock = vi.fn(async () => embeddingResponse());
    vi.stubGlobal('fetch', fetchMock);

    const embedder = new OpenAIEmbedder('test-key');
    const vec = await embedder.embed('policy bound');

    expect(vec).toHaveLength(EMBEDDING_DIM);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries transient HTTP 500 and succeeds on the next attempt (ABY-528)', async () => {
    vi.stubEnv('OPENAI_EMBEDDINGS_MAX_ATTEMPTS', '3');
    vi.stubEnv('OPENAI_EMBEDDINGS_RETRY_BASE_MS', '1');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":"server_error"}', { status: 500 }))
      .mockResolvedValueOnce(embeddingResponse());
    vi.stubGlobal('fetch', fetchMock);

    const embedder = new OpenAIEmbedder('test-key');
    const vec = await embedder.embed('policy bound');

    expect(vec).toHaveLength(EMBEDDING_DIM);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-transient HTTP 401', async () => {
    vi.stubEnv('OPENAI_EMBEDDINGS_MAX_ATTEMPTS', '3');
    const fetchMock = vi.fn(async () => new Response('{"error":"invalid_api_key"}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const embedder = new OpenAIEmbedder('test-key');
    await expect(embedder.embed('policy bound')).rejects.toThrow('HTTP 401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient transport failure', async () => {
    vi.stubEnv('OPENAI_EMBEDDINGS_MAX_ATTEMPTS', '3');
    vi.stubEnv('OPENAI_EMBEDDINGS_RETRY_BASE_MS', '1');
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(embeddingResponse());
    vi.stubGlobal('fetch', fetchMock);

    const embedder = new OpenAIEmbedder('test-key');
    await expect(embedder.embed('policy bound')).resolves.toHaveLength(EMBEDDING_DIM);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries on persistent 500', async () => {
    vi.stubEnv('OPENAI_EMBEDDINGS_MAX_ATTEMPTS', '2');
    vi.stubEnv('OPENAI_EMBEDDINGS_RETRY_BASE_MS', '1');
    const fetchMock = vi.fn(async () => new Response('{"error":"server_error"}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const embedder = new OpenAIEmbedder('test-key');
    await expect(embedder.embed('policy bound')).rejects.toThrow('HTTP 500');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not start another request once the total retry budget has elapsed', async () => {
    vi.stubEnv('OPENAI_EMBEDDINGS_MAX_ATTEMPTS', '3');
    vi.stubEnv('OPENAI_EMBEDDINGS_TOTAL_TIMEOUT_MS', '10');
    vi.stubEnv('OPENAI_EMBEDDINGS_RETRY_BASE_MS', '1');
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(11);
    const fetchMock = vi.fn(async () => new Response('{"error":"server_error"}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const embedder = new OpenAIEmbedder('test-key');
    await expect(embedder.embed('policy bound')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });
});

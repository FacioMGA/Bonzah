import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Kernel } from '../application/kernel.js';
import { KernelError } from '../domain/canonical.js';

/** Server-registered adapters authenticate the exact bytes; scope comes from the retained request. */
export function providerRoutes(app: FastifyInstance, kernel: Kernel) {
  app.register(async (ingress) => {
    ingress.removeContentTypeParser('application/json');
    ingress.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_request, body, done) => done(null, body),
    );
    const attempts = new Map<string, { start: number; count: number }>();
    ingress.post(
      '/provider-callbacks/:adapterId/:requestId',
      { bodyLimit: 1_048_576 },
      async (request) => {
        const now = Date.now();
        if (attempts.size >= 1000)
          for (const [key, value] of attempts)
            if (now - value.start >= 60_000) attempts.delete(key);
        if (attempts.size >= 1000 && !attempts.has(request.ip))
          throw new KernelError(
            'RATE_LIMITED',
            'Provider callback capacity is temporarily exhausted',
            429,
          );
        const window = attempts.get(request.ip);
        const current = window && now - window.start < 60_000 ? window : { start: now, count: 0 };
        attempts.set(request.ip, current);
        if (++current.count > 120)
          throw new KernelError('RATE_LIMITED', 'Too many provider callbacks; retry later', 429);
        const { adapterId, requestId } = z
          .strictObject({ adapterId: z.string().min(1).max(100), requestId: z.string().uuid() })
          .parse(request.params);
        if (!(request.body instanceof Uint8Array))
          throw new KernelError(
            'INVALID_PROVIDER_PAYLOAD',
            'Provider callbacks require the exact JSON bytes',
            422,
          );
        const headers = Object.fromEntries(
          Object.entries(request.headers).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        );
        kernel.providers.acceptCallback(adapterId, requestId, request.body, headers);
        // No retained risk, internal claim, credentials or full receipt is returned to the provider.
        return { received: true };
      },
    );
  });
}

/** One hosted process owns the SQLite writer. Async delivery runs outside command transactions. */
export function providerWorker(app: FastifyInstance, kernel: Kernel) {
  let running: Promise<unknown> | null = null;
  let stopped = false;
  const tick = () => {
    if (stopped || running) return;
    running = kernel.providers
      .workOnce()
      .catch(() => {
        // The worker records each attempt/failure; keep the scheduler alive without logging payloads.
        app.log.error('Provider worker cycle failed; inspect retained provider audit evidence');
      })
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(tick, 1000);
  timer.unref();
  app.addHook('onClose', async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  });
}

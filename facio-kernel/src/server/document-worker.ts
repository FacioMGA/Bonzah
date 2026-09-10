import type { FastifyInstance } from 'fastify';
import type { Kernel } from '../application/kernel.js';

/** Rendering happens outside SQLite transactions; shutdown waits for the bounded in-flight job. */
export function documentWorker(app: FastifyInstance, kernel: Kernel) {
  let running: Promise<unknown> | null = null;
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped || running) return;
    running = kernel.documents
      .runOne()
      .catch(() => {
        app.log.error('Document worker cycle failed; inspect retained document job evidence');
      })
      .finally(() => {
        running = null;
      });
  }, 1000);
  timer.unref();
  app.addHook('onClose', async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  });
}

import { initializeRustMoney } from './domain/rust-money.js';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { credentialSchema } from './server/auth.js';
import { buildApp } from './server/app.js';
import { Kernel } from './application/kernel.js';
import { Store } from './storage/store.js';
if (process.env.NODE_ENV === 'production')
  throw new Error(
    'Production hosting requires managed identity, approved storage and release gates; this foundation is local only',
  );
if (!process.env.KERNEL_AUTH_FILE || !process.env.KERNEL_DB_PATH)
  throw new Error(
    'KERNEL_AUTH_FILE and KERNEL_DB_PATH are required. Use npm run dev for isolated synthetic fixtures.',
  );
initializeRustMoney();
const credentials = z
  .array(credentialSchema)
  .parse(JSON.parse(await readFile(process.env.KERNEL_AUTH_FILE, 'utf8')));
const store = new Store(process.env.KERNEL_DB_PATH);
const app = buildApp({ kernel: new Kernel(store), credentials });
await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT ?? 4310) });
const stop = async () => {
  await app.close();
  store.close();
  process.exit(0);
};
process.once('SIGINT', () => {
  void stop();
});
process.once('SIGTERM', () => {
  void stop();
});

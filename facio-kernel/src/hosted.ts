import { initializeRustMoney } from './domain/rust-money.js';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { Store } from './storage/store.js';
import { AuthStore } from './storage/auth-store.js';
import { Kernel } from './application/kernel.js';
import { createSyntheticProviderAdapter } from './application/provider.js';
import { syntheticDocumentPack } from './domain/document-training.js';
import { syntheticFnolDestination } from './contracts/fnol.js';
import { HostedAuth } from './server/hosted-auth.js';
import { oidcProvider, type IdentityProvider } from './server/oidc.js';
import { buildApp } from './server/app.js';
import { sandboxRegionResidencies, type AccountBootstrap } from './contracts/control-plane.js';
import { KernelError } from './domain/canonical.js';

const env = z
  .object({
    KERNEL_PUBLIC_URL: z.url(),
    KERNEL_REGION: z.enum(
      Object.keys(sandboxRegionResidencies) as [keyof typeof sandboxRegionResidencies],
    ),
    KERNEL_BUILD_SHA: z.string().regex(/^[a-f0-9]{40}$/),
    KERNEL_DB_PATH: z.string().min(1),
    KERNEL_AUTH_DB_PATH: z.string().min(1),
    KERNEL_BOOTSTRAP_FILE: z.string().min(1),
    KERNEL_WORKSPACE_DOMAIN: z.literal('facio.io').default('facio.io'),
    KERNEL_OIDC_TENANT_ID: z.string().uuid().optional(),
    KERNEL_OIDC_CLIENT_ID: z.string().optional(),
    KERNEL_OIDC_CLIENT_SECRET: z.string().optional(),
    KERNEL_GOOGLE_CLIENT_ID: z.string().optional(),
    KERNEL_GOOGLE_CLIENT_SECRET: z.string().optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(4310),
  })
  .parse(process.env);
initializeRustMoney();
const store = new Store(env.KERNEL_DB_PATH);
const kernel = new Kernel(
  store,
  [],
  [],
  undefined,
  {
    region: env.KERNEL_REGION,
    buildSha: env.KERNEL_BUILD_SHA,
  },
  [createSyntheticProviderAdapter()],
  [syntheticDocumentPack],
  [syntheticFnolDestination],
);
kernel.control.bootstrapAccount(
  JSON.parse(await readFile(env.KERNEL_BOOTSTRAP_FILE, 'utf8')) as AccountBootstrap,
);
const providers: IdentityProvider[] = [];
if (env.KERNEL_OIDC_CLIENT_ID && env.KERNEL_OIDC_CLIENT_SECRET && env.KERNEL_OIDC_TENANT_ID)
  providers.push(
    oidcProvider({
      id: 'microsoft',
      clientId: env.KERNEL_OIDC_CLIENT_ID,
      clientSecret: env.KERNEL_OIDC_CLIENT_SECRET,
      tenantId: env.KERNEL_OIDC_TENANT_ID,
      publicUrl: env.KERNEL_PUBLIC_URL,
      workspaceDomain: env.KERNEL_WORKSPACE_DOMAIN,
    }),
  );
if (env.KERNEL_GOOGLE_CLIENT_ID && env.KERNEL_GOOGLE_CLIENT_SECRET)
  providers.push(
    oidcProvider({
      id: 'google',
      clientId: env.KERNEL_GOOGLE_CLIENT_ID,
      clientSecret: env.KERNEL_GOOGLE_CLIENT_SECRET,
      publicUrl: env.KERNEL_PUBLIC_URL,
      workspaceDomain: env.KERNEL_WORKSPACE_DOMAIN,
    }),
  );
if (!providers.length)
  throw new Error('At least one organization identity provider must be configured for hosted mode');
const authStore = new AuthStore(env.KERNEL_AUTH_DB_PATH);
const auth = new HostedAuth(authStore, {
  publicUrl: env.KERNEL_PUBLIC_URL,
  providers,
  authorizePrincipal: (principal) => {
    if (!kernel.control.session(principal).accounts.length)
      throw new KernelError('FORBIDDEN', 'Sandbox membership was revoked', 403);
  },
  acceptVerifiedGoogleInvitation: (principal) => {
    kernel.control.acceptVerifiedInvitation(principal);
  },
});
const app = buildApp({
  kernel,
  providerWorker: true,
  documentWorker: true,
  hosted: {
    auth,
    publicUrl: env.KERNEL_PUBLIC_URL,
    buildSha: env.KERNEL_BUILD_SHA,
    region: env.KERNEL_REGION,
  },
});
await app.listen({ host: '0.0.0.0', port: env.PORT });
const cleanup = setInterval(() => authStore.prune(), 60_000);
cleanup.unref();
const stop = async () => {
  clearInterval(cleanup);
  await app.close();
  authStore.close();
  store.close();
  process.exit(0);
};
process.once('SIGINT', () => {
  void stop();
});
process.once('SIGTERM', () => {
  void stop();
});

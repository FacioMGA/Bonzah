import { initializeRustMoney } from './domain/rust-money.js';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Store } from './storage/store.js';
import { Kernel } from './application/kernel.js';
import { buildApp } from './server/app.js';
import {
  referenceScope,
  incompleteScope,
  referenceConfiguration,
  incompleteConfiguration,
} from './fixtures/reference.js';
import type { Credential } from './server/auth.js';
import { customerRequirementsProfiles } from './fixtures/customer-requirements.js';
import { runtimeDemoScope, runtimeDemoPolicies } from './fixtures/insurance.js';
import {
  bonzahDevelopmentConfiguration,
  bonzahDevelopmentPolicies,
  bonzahDevelopmentScope,
} from './fixtures/bonzah.js';

if (process.env.NODE_ENV === 'production')
  throw new Error('The local fixture server cannot run in production');
initializeRustMoney();
await mkdir('.local', { recursive: true, mode: 0o700 });
const store = new Store(resolve('.local/kernel.sqlite'));
store.seed(referenceScope, referenceConfiguration, referenceConfiguration);
store.seed(incompleteScope, incompleteConfiguration);
for (const { scope } of customerRequirementsProfiles)
  store.seed(
    scope,
    scope.tenantId === bonzahDevelopmentScope.tenantId
      ? bonzahDevelopmentConfiguration
      : incompleteConfiguration,
  );
store.seed(runtimeDemoScope, incompleteConfiguration);
const credentials: Credential[] = [
  referenceScope,
  incompleteScope,
  ...customerRequirementsProfiles.map(({ scope }) => scope),
  runtimeDemoScope,
].map((scope) => ({
  token: randomBytes(32).toString('hex'),
  context: {
    ...scope,
    actorId: 'local-editor',
    permissions: [
      'configuration:read',
      'configuration:write',
      'audit:read',
      ...([runtimeDemoScope.tenantId, bonzahDevelopmentScope.tenantId].includes(scope.tenantId)
        ? (['insurance:read', 'insurance:quote', 'insurance:bind', 'insurance:service'] as const)
        : []),
    ],
  },
}));
const app = buildApp({
  kernel: new Kernel(store, customerRequirementsProfiles, [
    ...runtimeDemoPolicies,
    ...bonzahDevelopmentPolicies,
  ]),
  credentials,
});
const credentialPath = resolve('.local/credentials.json');
const temporaryCredentialPath = resolve(
  `.local/.credentials-${randomBytes(16).toString('hex')}.tmp`,
);
let address: string;
try {
  // A failed second startup must not replace credentials for the running server.
  address = await app.listen({ port: Number(process.env.PORT ?? 4310), host: '127.0.0.1' });
  await writeFile(temporaryCredentialPath, JSON.stringify(credentials, null, 2), {
    mode: 0o600,
    flag: 'wx',
  });
  await rename(temporaryCredentialPath, credentialPath);
} catch (error) {
  await Promise.allSettled([app.close(), rm(temporaryCredentialPath, { force: true })]);
  store.close();
  throw error;
}
console.log(
  `Facio Kernel: ${address}\nLocal credentials: ${resolve('.local/credentials.json')}\nUse runtime-demo for synthetic insurance execution; reference/incomplete for configuration; UE/VUW for source intake. Production publication is unavailable.`,
);
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

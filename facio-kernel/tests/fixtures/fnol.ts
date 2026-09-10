import { randomUUID } from 'node:crypto';
import { Kernel } from '../../src/application/kernel.js';
import { Store } from '../../src/storage/store.js';
import {
  fnolViewSchema,
  syntheticFnolDestination,
  type FnolDetails,
  type FnolNotice,
  type FnolOperationName,
} from '../../src/contracts/fnol.js';
import { insuranceMutationResultSchema } from '../../src/contracts/insurance.js';
import type { Context } from '../../src/contracts/configuration.js';
import { insuranceContext, scopedRuntimePolicy, externalQuote, testNow } from './insurance.js';
export const syntheticFnolDetails: FnolDetails = {
  insured: { displayName: 'Synthetic Training Insured', reference: 'fixture-insured-1' },
  reporter: {
    displayName: 'Example Reporter',
    role: 'insured',
    contact: { email: 'reporter@example.test', phone: '' },
  },
  preparer: {
    displayName: 'Example Preparer',
    role: 'broker',
    company: 'Training desk',
    contact: { email: '', phone: '' },
  },
  loss: {
    occurredAt: '2026-09-09T14:00:00+01:00',
    reportedTimeZone: 'UTC+01:00 supplied in synthetic source',
    location: 'Training location one',
    kind: 'property',
    description: 'Synthetic water damage notice for internal workflow verification.',
    injuryStatus: 'none_reported',
  },
  evidence: [
    {
      kind: 'photo',
      reference: 'fixture://fnol/synthetic-scene',
      description: 'Synthetic reference only; no actual file upload',
    },
  ],
  declaration: { confirmed: true, statementVersion: 'synthetic-intake-v1' },
};
export function fnolFixture(path = ':memory:') {
  const store = new Store(path),
    context: Context = {
      ...insuranceContext,
      permissions: [
        ...insuranceContext.permissions,
        'configuration:read',
        'fnol:read',
        'fnol:write',
        'fnol:handoff',
      ],
    };
  const kernel = new Kernel(
    store,
    [],
    [scopedRuntimePolicy],
    testNow,
    undefined,
    [],
    [],
    [syntheticFnolDestination],
  );
  const quoted = insuranceMutationResultSchema.parse(
    kernel.execute(
      'insurance_create_quote',
      {
        productId: scopedRuntimePolicy.policy.id,
        productVersion: scopedRuntimePolicy.policy.version,
        quote: structuredClone(externalQuote),
        idempotencyKey: randomUUID(),
      },
      context,
    ),
  ).record;
  const bound = insuranceMutationResultSchema.parse(
    kernel.execute(
      'insurance_bind',
      {
        recordId: quoted.id,
        expectedVersion: quoted.version,
        quoteHash: quoted.quoteHash,
        idempotencyKey: randomUUID(),
      },
      context,
    ),
  ).record;
  const command = (
    sourceReference = 'fixture-notice-1',
    details = structuredClone(syntheticFnolDetails),
  ) => ({
    recordId: bound.id,
    recordVersion: bound.version,
    recordHash: bound.recordHash,
    sourceReference,
    destinationId: syntheticFnolDestination.id,
    destinationVersion: syntheticFnolDestination.version,
    details,
    idempotencyKey: randomUUID(),
  });
  const execute = (name: FnolOperationName, input: unknown, actor = context) =>
    kernel.execute(name, input, actor);
  const create = (sourceReference?: string, details?: FnolDetails) =>
    fnolViewSchema.parse(execute('fnol_create', command(sourceReference, details)));
  return { store, kernel, context, quoted, bound, command, execute, create };
}
export const fnolCas = (notice: FnolNotice) => ({
  noticeId: notice.id,
  expectedVersion: notice.version,
  noticeHash: notice.noticeHash,
  idempotencyKey: randomUUID(),
});

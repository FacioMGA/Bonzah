import { timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { contextSchema, type Context } from '../contracts/configuration.js';
import { KernelError } from '../domain/canonical.js';
export const credentialSchema = z.strictObject({
  token: z.string().min(32),
  context: contextSchema.omit({ correlationId: true }),
});
export type Credential = z.infer<typeof credentialSchema>;
export class Authenticator {
  private readonly entries: { digest: Buffer; context: Credential['context'] }[];
  constructor(credentials: Credential[]) {
    const parsed = z.array(credentialSchema).min(1).parse(credentials);
    if (new Set(parsed.map((c) => c.token)).size !== parsed.length)
      throw new Error('Credential tokens must be unique');
    this.entries = parsed.map((c) => ({
      digest: createHash('sha256').update(c.token).digest(),
      context: c.context,
    }));
  }
  authenticate(authorization: string | undefined): Context {
    if (!authorization?.startsWith('Bearer '))
      throw new KernelError('UNAUTHENTICATED', 'A scoped bearer credential is required', 401);
    const digest = createHash('sha256').update(authorization.slice(7)).digest();
    const entry = this.entries.find((c) => timingSafeEqual(c.digest, digest));
    if (!entry) throw new KernelError('UNAUTHENTICATED', 'The credential is invalid', 401);
    return {
      ...entry.context,
      permissions: [...entry.context.permissions],
      correlationId: randomUUID(),
    };
  }
}

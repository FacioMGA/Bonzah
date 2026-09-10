import { createHash, randomBytes } from 'node:crypto';

export const secret = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export type Principal = {
  issuer: string; subject: string; actorId: string; correlationId: string; email?: string;
};
export class IdentityError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); }
}

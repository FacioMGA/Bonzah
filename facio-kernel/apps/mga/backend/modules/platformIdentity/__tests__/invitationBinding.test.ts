import { describe, expect, it } from 'vitest';
import { invitedEmail, readEntraBindings } from '../domain/invitationBinding.js';
const tenantId = '10000000-0000-4000-8000-000000000001';
const oid = '20000000-0000-4000-8000-000000000001';
const env = { KERNEL_ENTRA_TENANT_ID: tenantId, KERNEL_ENTRA_IDENTITY_BINDINGS: JSON.stringify([{ tenantId, oid, email: 'approved@facio.io' }]) };
const principal = { issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`, subject: oid, email: 'spoofed@facio.io', actorId: 'test', correlationId: 'test' };
describe('explicit Entra directory invitation binding', () => {
  it('binds only the verified issuer and oid, never a mutable email assertion', () => {
    const bindings = readEntraBindings(env);
    expect(invitedEmail(principal, bindings)).toBe('approved@facio.io');
    expect(invitedEmail({ ...principal, subject: 'another-oid', email: 'approved@facio.io' }, bindings)).toBeUndefined();
    expect(invitedEmail({ ...principal, issuer: 'https://attacker.invalid', email: 'approved@facio.io' }, bindings)).toBeUndefined();
    expect(invitedEmail(principal, [])).toBeUndefined();
  });
  it('rejects a different directory, external email and ambiguous bootstrap subjects', () => {
    for (const entries of [[{ tenantId: oid, oid, email: 'approved@facio.io' }], [{ tenantId, oid, email: 'approved@external.invalid' }], [{ tenantId, oid, email: 'first@facio.io' }, { tenantId, oid, email: 'second@facio.io' }]]) expect(() => readEntraBindings({ ...env, KERNEL_ENTRA_IDENTITY_BINDINGS: JSON.stringify(entries) })).toThrow();
  });
});

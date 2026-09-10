import { describe, expect, it } from 'vitest';
import { signingSecretErrors } from '../../../platform/config/signingSecrets.js';
describe('required platform signing keys', () => {
  it('rejects missing, short and reused quote keys before serving shared platform traffic', () => {
    const env = { KERNEL_PLATFORM_MODE: 'true', NODE_ENV: 'development', JWT_SECRET: 'a'.repeat(48) };
    expect(signingSecretErrors(env).join()).toContain('QUOTE_TOKEN_SECRET');
    expect(signingSecretErrors({ ...env, QUOTE_TOKEN_SECRET: 'short' })).toHaveLength(1);
    expect(signingSecretErrors({ ...env, QUOTE_TOKEN_SECRET: env.JWT_SECRET }).join()).toContain('must differ');
    expect(signingSecretErrors({ ...env, QUOTE_TOKEN_SECRET: 'b'.repeat(48) })).toEqual([]);
    expect(signingSecretErrors({ NODE_ENV: 'production' })).toHaveLength(2);
  });
});

/** Session and signed-quote keys are independent required platform capabilities. */
export function signingSecretErrors(env: Record<string, string | undefined>): string[] {
  if (env.NODE_ENV !== 'production' && env.KERNEL_PLATFORM_MODE !== 'true') return [];
  const errors: string[] = [];
  const placeholders = new Set(['dev-jwt-secret-change-me', 'local-only-change-me-with-openssl-rand-hex-32']);
  for (const key of ['JWT_SECRET', 'QUOTE_TOKEN_SECRET']) {
    const value = env[key]?.trim() || '';
    if (value.length < 32 || placeholders.has(value)) errors.push(`[StartupValidation] ${key} requires a dedicated secret of at least 32 characters in shared platform or production mode.`);
  }
  if (env.JWT_SECRET && env.JWT_SECRET === env.QUOTE_TOKEN_SECRET) errors.push('[StartupValidation] JWT_SECRET and QUOTE_TOKEN_SECRET must differ; session and quote signatures have separate rotation scopes.');
  return errors;
}

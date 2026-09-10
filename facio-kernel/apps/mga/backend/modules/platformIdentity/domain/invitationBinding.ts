import { z } from 'zod';
import type { Principal } from './identity.js';
const bindingSchema = z.array(z.object({ tenantId: z.uuid(), oid: z.uuid(), email: z.email() }).strict()).max(100);
export type EntraBinding = z.infer<typeof bindingSchema>[number];
/** These operator-supplied subjects come from a verified directory lookup, never
 * an incoming email/preferred_username claim. The app still checks membership. */
export function readEntraBindings(env: Record<string, string | undefined>): EntraBinding[] {
  if (!env.KERNEL_ENTRA_IDENTITY_BINDINGS) return [];
  const bindings = bindingSchema.parse(JSON.parse(env.KERNEL_ENTRA_IDENTITY_BINDINGS));
  const domain = env.KERNEL_WORKSPACE_DOMAIN || 'facio.io';
  if (bindings.some(binding => binding.tenantId !== env.KERNEL_ENTRA_TENANT_ID || binding.email !== binding.email.toLowerCase() || binding.email.split('@')[1] !== domain)) throw new Error('Entra bootstrap identity does not match the configured organization.');
  if (new Set(bindings.map(binding => binding.oid)).size !== bindings.length || new Set(bindings.map(binding => binding.email)).size !== bindings.length) throw new Error('Entra bootstrap identity mapping is ambiguous.');
  return bindings;
}
export function invitedEmail(principal: Principal, bindings: EntraBinding[]): string | undefined {
  if (principal.issuer === 'https://accounts.google.com') return principal.email;
  return bindings.find(binding => principal.issuer === `https://login.microsoftonline.com/${binding.tenantId}/v2.0` && principal.subject === binding.oid)?.email;
}

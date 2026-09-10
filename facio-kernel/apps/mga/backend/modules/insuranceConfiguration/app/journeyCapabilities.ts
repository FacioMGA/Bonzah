import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { resolveMappedProgramDefinition } from '../../programs/app/activeProgramDefinition.js';
import { parseProgrammeChannelPermissions } from '../../programs/app/programRuntimeDefinitions.js';
import { effectiveCustomerCapability } from '../domain/processConfiguration.js';
import { readInsuranceConfiguration, assertConfiguredJourneyCapability, InsuranceConfigurationError, type JourneyActor, type JourneyAction } from '../domain/runtimeConfiguration.js';
import type { ResolvedProgramDefinition } from '../../programs/domain/programDefinition.js';

export function projectJourneyCapabilities(definition: ResolvedProgramDefinition) {
  const channels = parseProgrammeChannelPermissions(definition.channels), source = readInsuranceConfiguration(definition.workflow);
  const active = !source || (source.product.active && source.product.status === 'Active');
  return { definitionId: definition.id, definitionVersion: definition.version, programId: definition.programId, binderProductAuthorityId: definition.binderProductAuthorityId, configuredProductActive: active, sourceConfigurationAttached: Boolean(source), customer: { questions: active && channels.questions, quote: active && channels.quote, payment: active && channels.payment, documents: active && Boolean(source && effectiveCustomerCapability(source.process, 'docs')), portal: active && Boolean(source && effectiveCustomerCapability(source.process, 'portal')), claim: active && Boolean(source && effectiveCustomerCapability(source.process, 'claim')), cancel: active && Boolean(source && effectiveCustomerCapability(source.process, 'cancel')) } };
}
export async function resolvePolicyJourneyDefinition(policy: { programId?: string | null; binderId?: string | null; productType?: string | null }) {
  const tenantId = getTenantConfig().id;
  if (!policy.programId || !policy.binderId || !policy.productType) throw new InsuranceConfigurationError('Policy programme, binder and product are required to resolve journey capabilities.');
  const authority = await tenantScopedPrisma.binderProductAuthority.findFirst({ where: { operatingTenantId: tenantId, binderId: policy.binderId, productCode: policy.productType.toUpperCase() }, select: { id: true } });
  if (!authority) throw new InsuranceConfigurationError('Policy authority is unavailable in this operating tenant.');
  return resolveMappedProgramDefinition({ programId: policy.programId, binderProductAuthorityId: authority.id });
}
export async function readPolicyJourneyCapabilities(policyId: string) {
  const policy = await tenantScopedPrisma.policy.findFirst({ where: { id: policyId, operatingTenantId: getTenantConfig().id }, select: { id: true, programId: true, binderId: true, productType: true } });
  if (!policy) throw new InsuranceConfigurationError('Policy is unavailable in this operating tenant.');
  return { policyId: policy.id, ...projectJourneyCapabilities(await resolvePolicyJourneyDefinition(policy)) };
}
export async function assertPolicyJourneyAction(policy: { programId?: string | null; binderId?: string | null; productType?: string | null }, actor: JourneyActor, action: JourneyAction) {
  const definition = await resolvePolicyJourneyDefinition(policy);
  assertConfiguredJourneyCapability(definition.workflow, actor, action);
  return definition;
}

/** Authenticated actor fields are supplied by HTTP/MCP adapters or a trusted worker. */
export function isConfiguredAgentIdentity(actor: { role?: string | null; userType?: string | null }): boolean {
  return [actor.userType, actor.role].some((value) => ['BROKER', 'PARTNER', 'AGENT'].includes(String(value || '').toUpperCase()));
}
export async function assertConfiguredBindingActor(policy: { programId?: string | null; binderId?: string | null; productType?: string | null }, actor: { role?: string | null; userType?: string | null }): Promise<void> {
  if (isConfiguredAgentIdentity(actor)) await assertPolicyJourneyAction(policy, 'agent', 'bind');
}

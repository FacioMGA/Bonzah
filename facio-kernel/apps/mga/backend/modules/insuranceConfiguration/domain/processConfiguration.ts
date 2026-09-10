import { z } from 'zod';

/** Adapted from Symphony routes/processConfig.ts and customerCapabilities.ts.
 * All choices are explicit; the source's permissive default grants are omitted. */
export const CUSTOMER_CAPABILITIES = ['forms', 'approve', 'docs', 'portal', 'pay', 'claim', 'cancel'] as const;
export const AGENT_PERMISSIONS = ['submitProposals', 'uploadCustomerData', 'viewExpectedCommission', 'reportClaims', 'requestCancellation'] as const;
export const PROCESS_CONSIDERATIONS = ['workingWithAgents', 'clientInvolvement', 'customerPortal', 'billingPayments', 'digitalClaims', 'certificates', 'externalIntegrations', 'apiAi', 'businessVolume', 'mainPainPoints'] as const;
const unique = <T>(values: T[]) => new Set(values).size === values.length;

export const processConfigurationSchema = z.object({
  businessDescription: z.string().max(1500),
  considerations: z.array(z.enum(PROCESS_CONSIDERATIONS)).max(10).refine(unique, 'Duplicate consideration'),
  recommendedPackage: z.enum(['QUOTE_SYMPHONY', 'LOUD_SYMPHONY', 'SYMPHONY_POLICYPRO']).describe('Source package classification; does not grant capabilities or license features.'),
  customers: z.object({ forms: z.boolean(), approve: z.boolean(), docs: z.boolean(), portal: z.boolean(), pay: z.boolean(), claim: z.boolean(), cancel: z.boolean() }).strict(),
  agents: z.object({
    enabled: z.boolean(),
    contractTypes: z.array(z.enum(['direct', 'parent', 'sub'])).max(3).refine(unique),
    deltaBonus: z.array(z.enum(['direct', 'parent'])).max(2).refine(unique),
    commissionMode: z.enum(['none', 'reports', 'full']),
    showExpectedCommission: z.boolean(),
    cancellationRule: z.enum(['full', 'proRata']).describe('Agent commission cancellation preference. Never authorizes or computes the policyholder refund.'),
    permissions: z.array(z.enum(AGENT_PERMISSIONS)).max(5).refine(unique),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.agents.contractTypes.includes('sub') && !value.agents.contractTypes.includes('parent')) ctx.addIssue({ code: 'custom', path: ['agents', 'contractTypes'], message: 'Sub-agent contracts require a parent contract type.' });
  if (value.agents.deltaBonus.some((type) => !value.agents.contractTypes.includes(type))) ctx.addIssue({ code: 'custom', path: ['agents', 'deltaBonus'], message: 'Delta bonus must reference an enabled contract type.' });
});
export type ProcessConfiguration = z.infer<typeof processConfigurationSchema>;
export type CustomerCapability = typeof CUSTOMER_CAPABILITIES[number];
export type AgentPermission = typeof AGENT_PERMISSIONS[number];

/** Child flags retain authoring intent while portal=false makes them ineffective. */
export function effectiveCustomerCapability(process: ProcessConfiguration, capability: CustomerCapability): boolean {
  return ['pay', 'claim', 'cancel'].includes(capability) ? process.customers.portal && process.customers[capability] : process.customers[capability];
}

/** Source stage vocabulary is retained for inspection, not an arbitrary command executor. */
export const workflowStagesSchema = z.object({
  stages: z.array(z.object({
    id: z.string().min(1).max(100), name: z.string().min(1).max(200),
    actions: z.array(z.string().min(1).max(100)).max(50).optional(),
    autoForm: z.string().min(1).max(100).optional(), requiredRole: z.string().min(1).max(100).optional(),
    autoTransition: z.object({ if: z.literal('product.digitalSale'), to: z.string().min(1).max(100) }).strict().optional(),
    triggers: z.array(z.string().min(1).max(100)).max(50).optional(),
  }).strict()).max(50),
  forms: z.record(z.string(), z.object({ title: z.string().min(1).max(200), fields: z.array(z.object({ name: z.string().min(1).max(100), label: z.string().min(1).max(500), type: z.enum(['text', 'textarea', 'number', 'select']), required: z.boolean().optional(), options: z.array(z.string().max(500)).optional() }).strict()).max(200) }).strict()).optional(),
  digitalSale: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  const ids = value.stages.map((stage) => stage.id);
  if (!unique(ids)) ctx.addIssue({ code: 'custom', path: ['stages'], message: 'Stage IDs must be unique.' });
  for (const [index, stage] of value.stages.entries()) {
    if (stage.autoTransition && !ids.includes(stage.autoTransition.to)) ctx.addIssue({ code: 'custom', path: ['stages', index, 'autoTransition'], message: 'Transition target does not exist.' });
    if (stage.autoForm && !value.forms?.[stage.autoForm]) ctx.addIssue({ code: 'custom', path: ['stages', index, 'autoForm'], message: 'Referenced form does not exist.' });
  }
});

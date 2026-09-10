import { validateInsuranceConfigurationComponents, readInsuranceConfiguration } from '../../insuranceConfiguration/domain/runtimeConfiguration.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import {
  ProgramDefinitionConfigurationError,
  requireDefinitionComponents,
  requireRecord,
  type ResolvedProgramDefinition,
} from '../domain/programDefinition.js';
import {
  parseProgrammeChannelPermissions,
  type ProgrammeChannelPermissions,
} from './programRuntimeDefinitions.js';

export { ProgramDefinitionConfigurationError } from '../domain/programDefinition.js';

/**
 * Safe programme-definition fields that a questionnaire surface may consume.
 * The resolver remains the only path from a selected binder authority to the
 * published definition; HTTP consumers receive this projection through app.
 */
export type ProgramDefinitionQuestionnaireProjection = Pick<
  ResolvedProgramDefinition,
  'id' | 'programId' | 'version' | 'pricingMode' | 'binderProductAuthorityId' | 'questionnaire'
>;

/** Resolve public-journey permissions from the exact mapped definition only. */
export async function resolveMappedProgrammeChannelPermissions(args: {
  programId: string;
  binderProductAuthorityId: string;
}): Promise<ProgrammeChannelPermissions> {
  const definition = await resolveMappedProgramDefinition(args);
  try {
    const channels = parseProgrammeChannelPermissions(definition.channels);
    const source = readInsuranceConfiguration(definition.workflow);
    return source && (!source.product.active || source.product.status !== 'Active') ? { questions: false, quote: false, payment: false } : channels;
  } catch (error) {
    throw new ProgramDefinitionConfigurationError(
      args.binderProductAuthorityId,
      error instanceof Error ? error.message : 'invalid channel permissions',
    );
  }
}

/**
 * Resolves the complete, immutable definition explicitly authorised for an
 * already-selected binder-product authority. This is deliberately separate
 * from the temporary ADR-0100 rating-model resolver: no caller can combine a
 * definition from one authority with pricing from another.
 */
export async function resolveMappedProgramDefinition(args: {
  programId: string;
  binderProductAuthorityId: string;
}): Promise<ResolvedProgramDefinition> {
  const programId = String(args.programId || '').trim();
  const binderProductAuthorityId = String(args.binderProductAuthorityId || '').trim();
  if (!programId || !binderProductAuthorityId) {
    throw new ProgramDefinitionConfigurationError(
      binderProductAuthorityId || '(missing)',
      'program and binder-product authority are both required',
    );
  }

  const mapping = await tenantScopedPrisma.binderProductAuthorityProgramDefinition.findUnique({
    where: { binderProductAuthorityId },
    include: {
      binderProductAuthority: {
        select: {
          operatingTenantId: true,
          status: true,
          productCode: true,
          ratingModelMapping: { select: { programRatingModelId: true } },
          binder: {
            select: {
              status: true,
              programLinks: {
                where: { programId, status: 'ACTIVE' },
                select: { id: true },
              },
            },
          },
        },
      },
      programDefinitionVersion: {
        select: {
          id: true,
          operatingTenantId: true,
          programId: true,
          version: true,
          status: true,
          pricingMode: true,
          underwriting: true,
          coverage: true,
          questionnaire: true,
          workflow: true,
          channels: true,
          documents: true,
          programRatingModel: {
            select: { id: true, programId: true, version: true, status: true, stages: true, tables: true },
          },
        },
      },
    },
  });
  if (!mapping) {
    throw new ProgramDefinitionConfigurationError(binderProductAuthorityId, 'no definition is mapped');
  }
  if (mapping.binderProductAuthority.operatingTenantId !== getTenantConfig().id) {
    throw new ProgramDefinitionConfigurationError(binderProductAuthorityId, 'authority is not owned by this tenant');
  }
  if (String(mapping.binderProductAuthority.status).toUpperCase() !== 'ACTIVE') {
    throw new ProgramDefinitionConfigurationError(binderProductAuthorityId, 'authority is not active');
  }
  if (String(mapping.binderProductAuthority.binder.status).toUpperCase() !== 'ACTIVE') {
    throw new ProgramDefinitionConfigurationError(binderProductAuthorityId, 'binder is not active');
  }
  if (mapping.binderProductAuthority.binder.programLinks.length !== 1) {
    throw new ProgramDefinitionConfigurationError(binderProductAuthorityId, 'binder has no active link to this program');
  }

  const definition = mapping.programDefinitionVersion;
  if (definition.operatingTenantId !== getTenantConfig().id) {
    throw new ProgramDefinitionConfigurationError(binderProductAuthorityId, 'definition is not owned by this tenant');
  }
  if (definition.programId !== programId) {
    throw new ProgramDefinitionConfigurationError(
      binderProductAuthorityId,
      `mapped definition belongs to program ${definition.programId}, not ${programId}`,
    );
  }
  if (definition.status !== 'PUBLISHED') {
    throw new ProgramDefinitionConfigurationError(binderProductAuthorityId, `definition status is ${definition.status}`);
  }
  if (definition.pricingMode !== 'AUTOMATED' && definition.pricingMode !== 'MANUAL') {
    throw new ProgramDefinitionConfigurationError(binderProductAuthorityId, `unknown pricing mode ${definition.pricingMode}`);
  }

  const components = requireDefinitionComponents(binderProductAuthorityId, definition);
  validateInsuranceConfigurationComponents(components, mapping.binderProductAuthority.productCode);
  if (definition.pricingMode === 'MANUAL') {
    if (definition.programRatingModel) {
      throw new ProgramDefinitionConfigurationError(binderProductAuthorityId, 'manual definition must not select a rating model');
    }
    return {
      id: definition.id,
      programId: definition.programId,
      version: definition.version,
      pricingMode: 'MANUAL',
      binderProductAuthorityId,
      ...components,
    };
  }

  const ratingModel = definition.programRatingModel;
  if (!ratingModel) {
    throw new ProgramDefinitionConfigurationError(binderProductAuthorityId, 'automated definition has no rating model');
  }
  if (ratingModel.programId !== programId || ratingModel.status !== 'PUBLISHED') {
    throw new ProgramDefinitionConfigurationError(binderProductAuthorityId, 'selected rating model is not published for this program');
  }
  if (mapping.binderProductAuthority.ratingModelMapping?.programRatingModelId !== ratingModel.id) {
    throw new ProgramDefinitionConfigurationError(binderProductAuthorityId, 'selected rating model is not mapped to this binder-product authority');
  }
  return {
    id: definition.id,
    programId: definition.programId,
    version: definition.version,
    pricingMode: 'AUTOMATED',
    binderProductAuthorityId,
    ratingModel: {
      id: ratingModel.id,
      programId: ratingModel.programId,
      version: ratingModel.version,
      stages: requireRatingStages(binderProductAuthorityId, ratingModel.stages),
      tables: requireRecord(binderProductAuthorityId, ratingModel.tables, 'rating model tables'),
    },
    ...components,
  };
}

function requireRatingStages(binderProductAuthorityId: string, value: unknown): import('../../../platform/types/json.js').JsonObject[] {
  if (!Array.isArray(value) || value.some((stage) => !stage || typeof stage !== 'object' || Array.isArray(stage))) {
    throw new ProgramDefinitionConfigurationError(binderProductAuthorityId, 'rating model stages must be an array of objects');
  }
  return value as import('../../../platform/types/json.js').JsonObject[];
}

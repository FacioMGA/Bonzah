import { PrismaClient, Prisma } from '@prisma/client';
import { loadAbbeygateAutoCyprus2022Matrix } from '../products/motor/pricing/data/loader.js';
import { loadHomeRates } from '../products/home/pricing/data/loader.js';
import { loadBritHealthRates } from '../products/health/pricing/data/loader.js';
import { loadBritTravelRates } from '../products/travel/pricing/data/loader.js';
import { loadTravelFeeBands } from '../products/travel/pricing/data/travel-fee-bands.loader.js';
import { parsePublishedProductKitForProduct } from '../modules/programs/domain/productKit/productKit.js';
import { MOTOR_RATING_PIPELINE, parseMotorProgramRatingModel } from '../products/motor/pricing/programRatingModel.js';

// guard:cross-tenant-intentional -- Helm invokes this one-time pre-upgrade
// migration once for each deployed database; it must materialise every active
// tenant programme before the program-model-only runtime is rolled out.
const prisma = new PrismaClient();
const AUTOMATED_PRODUCT_TYPES = ['MOTOR', 'HOME', 'TRAVEL', 'HEALTH'] as const;
const MANUAL_PRODUCT_TYPES = ['BUSINESS', 'OPEN_MARKET'] as const;
const SUPPORTED_PRODUCT_TYPES = [...AUTOMATED_PRODUCT_TYPES, ...MANUAL_PRODUCT_TYPES] as const;
type SupportedProductType = (typeof SUPPORTED_PRODUCT_TYPES)[number];
type AutomatedProductType = (typeof AUTOMATED_PRODUCT_TYPES)[number];
type CutoverMode = 'preflight' | 'apply';

type SeedDefinition = {
  name: string;
  source: string;
  tables: () => Prisma.InputJsonValue;
};

function toInputJson(value: object): Prisma.InputJsonValue {
  return structuredClone(value) as Prisma.InputJsonValue;
}

function asRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function requireConfiguredComponents(args: {
  programId: string;
  productType: SupportedProductType;
  metadata: Record<string, Prisma.JsonValue>;
}): {
  underwriting: Prisma.InputJsonObject;
  coverage: Prisma.InputJsonObject;
  questionnaire: Prisma.InputJsonObject;
  workflow: Prisma.InputJsonObject;
  channels: Prisma.InputJsonObject;
  documents: Prisma.InputJsonObject;
} {
  const configured = args.metadata.programmeDefinitionComponents;
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    throw new Error(`Program ${args.programId} (${args.productType}) requires explicit metadata.programmeDefinitionComponents for cutover; no product defaults will be generated.`);
  }
  const components = configured as Record<string, Prisma.JsonValue>;
  const requireObject = (component: 'underwriting' | 'coverage' | 'questionnaire' | 'workflow' | 'channels' | 'documents') => {
    const value = components[component];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Program ${args.programId} (${args.productType}) requires explicit programmeDefinitionComponents.${component}; no product defaults will be generated.`);
    }
    return toInputJson(value) as Prisma.InputJsonObject;
  };
  const documents = requireObject('documents');
  const productKit = (documents as Record<string, unknown>).productKit;
  try {
    parsePublishedProductKitForProduct(args.productType, productKit);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'invalid product kit';
    throw new Error(`Program ${args.programId} (${args.productType}) requires a complete programmeDefinitionComponents.documents.productKit before cutover: ${message}`);
  }
  const issuedPack = (documents as Record<string, unknown>).issuedPack;
  if (!issuedPack || typeof issuedPack !== 'object' || Array.isArray(issuedPack)) {
    throw new Error(`Program ${args.programId} (${args.productType}) requires explicit programmeDefinitionComponents.documents.issuedPack before cutover; no document selection will be inferred.`);
  }
  const requiredTypes = (issuedPack as Record<string, unknown>).requiredTypes;
  if (!Array.isArray(requiredTypes) || requiredTypes.some((type) => typeof type !== 'string' || !type.trim())) {
    throw new Error(`Program ${args.programId} (${args.productType}) requires documents.issuedPack.requiredTypes as an explicit array of document types before cutover.`);
  }
  if (isAutomatedProductType(args.productType) && requiredTypes.length === 0) {
    throw new Error(`Automated program ${args.programId} (${args.productType}) requires at least one issued-pack document type before cutover.`);
  }
  return {
    underwriting: requireObject('underwriting'),
    coverage: requireObject('coverage'),
    questionnaire: requireObject('questionnaire'),
    workflow: requireObject('workflow'),
    channels: requireObject('channels'),
    documents,
  };
}

const SEED_DEFINITIONS: Record<AutomatedProductType, SeedDefinition> = {
  MOTOR: {
    name: 'Imported deployed Motor matrix',
    source: 'abbeygate-auto-cyprus-2022.json:program-model-cutover-v3',
    tables: () => toInputJson(loadAbbeygateAutoCyprus2022Matrix()),
  },
  HOME: {
    name: 'Imported deployed Home rate card',
    source: 'home-rates-2026.json:program-model-cutover-v1',
    tables: () => toInputJson(loadHomeRates()),
  },
  TRAVEL: {
    name: 'Imported deployed Travel rate card',
    source: 'brit-travel-2025.json+travel-fee-bands.json:program-model-cutover-v1',
    tables: () => toInputJson({ rateCard: loadBritTravelRates(), adminFees: loadTravelFeeBands() }),
  },
  HEALTH: {
    name: 'Imported deployed Health rate card',
    source: 'brit-health-2026.json:program-model-cutover-v1',
    tables: () => toInputJson(loadBritHealthRates()),
  },
};

function isSupportedProductType(value: string): value is SupportedProductType {
  return (SUPPORTED_PRODUCT_TYPES as readonly string[]).includes(value);
}

function isAutomatedProductType(value: SupportedProductType): value is AutomatedProductType {
  return (AUTOMATED_PRODUCT_TYPES as readonly string[]).includes(value);
}

function isCutoverSource(value: string | null): boolean {
  return String(value || '').includes('cutover');
}

function cutoverRatingModelStages(productType: AutomatedProductType): Prisma.InputJsonValue {
  if (productType === 'MOTOR') {
    return toInputJson(MOTOR_RATING_PIPELINE.map((operator) => ({ id: operator, operator })));
  }
  return toInputJson([]);
}

function validateMotorRatingModelBeforeMapping(args: {
  productType: AutomatedProductType;
  programId: string;
  model: { id: string; version: number; stages: Prisma.JsonValue; tables: Prisma.JsonValue };
  binderProductAuthorityId: string;
}): void {
  if (args.productType !== 'MOTOR') return;
  parseMotorProgramRatingModel({
    id: args.model.id,
    programId: args.programId,
    version: args.model.version,
    binderProductAuthorityId: args.binderProductAuthorityId,
    stages: args.model.stages,
    tables: args.model.tables,
  });
}

function resolveCutoverMode(argv: readonly string[]): CutoverMode {
  const flags = new Set(argv);
  const supported = new Set(['--preflight', '--apply']);
  const unknown = [...flags].filter((flag) => !supported.has(flag));
  if (unknown.length > 0) throw new Error(`Unknown cutover option(s): ${unknown.join(', ')}.`);
  if (flags.has('--preflight') && flags.has('--apply')) {
    throw new Error('Choose either --preflight or --apply, not both.');
  }
  if (!flags.has('--preflight') && !flags.has('--apply')) {
    throw new Error('Specify --preflight for a read-only check or --apply for the approved one-time cutover.');
  }
  return flags.has('--apply') ? 'apply' : 'preflight';
}

async function materialiseProgramModel(program: {
  id: string;
  operatingTenantId: string;
  productType: string;
  metadata: Prisma.JsonValue | null;
}) {
  if (!isSupportedProductType(program.productType)) return;
  const productType = program.productType;
  const activeAuthorities = await prisma.binderProductAuthority.findMany({
    where: {
      operatingTenantId: program.operatingTenantId,
      productCode: productType,
      status: 'ACTIVE',
      binder: {
        status: 'ACTIVE',
        programLinks: { some: { programId: program.id, status: 'ACTIVE' } },
      },
    },
    select: { id: true },
  });
  if (activeAuthorities.length === 0) return;
  if (!isAutomatedProductType(productType)) {
    await materialiseManualDefinitions(program, activeAuthorities);
    return;
  }
  const definition = SEED_DEFINITIONS[productType];

  await prisma.$transaction(async (tx) => {
    const models = await tx.programRatingModel.findMany({
      where: { programId: program.id },
      orderBy: { version: 'desc' },
      select: { id: true, status: true, source: true, version: true, stages: true, tables: true },
    });
    const existingExplicit = models.find((model) => !isCutoverSource(model.source));
    const cutoverModel = models.find((model) => isCutoverSource(model.source));
    const model = existingExplicit
      ? existingExplicit
      : cutoverModel
        ? await tx.programRatingModel.update({
          where: { id: cutoverModel.id },
          data: {
            status: 'PUBLISHED',
            name: definition.name,
            source: definition.source,
            stages: cutoverRatingModelStages(productType),
            tables: definition.tables(),
            notes: 'One-time runtime-authority cutover from the deployed asset.',
          },
          select: { id: true, status: true, version: true, stages: true, tables: true },
        })
        : await tx.programRatingModel.create({
          data: {
            operatingTenantId: program.operatingTenantId,
            programId: program.id,
            version: (models[0]?.version || 0) + 1,
            status: 'PUBLISHED',
            name: definition.name,
            source: definition.source,
            notes: 'One-time runtime-authority cutover from the deployed asset.',
            stages: cutoverRatingModelStages(productType),
            tables: definition.tables(),
          },
          select: { id: true, status: true, version: true, stages: true, tables: true },
        });

    if (model.status !== 'PUBLISHED') {
      throw new Error(`Program ${program.id} has an explicit ${model.status} rating model; publish it before enabling runtime model authority.`);
    }

    for (const authority of activeAuthorities) {
      validateMotorRatingModelBeforeMapping({
        productType,
        programId: program.id,
        model,
        binderProductAuthorityId: authority.id,
      });
      const existingMapping = await tx.binderProductAuthorityRatingModel.findUnique({
        where: { binderProductAuthorityId: authority.id },
        include: { programRatingModel: { select: { programId: true } } },
      });
      if (existingMapping && existingMapping.programRatingModel.programId !== program.id) {
        throw new Error(`Binder authority ${authority.id} is already mapped to program ${existingMapping.programRatingModel.programId}; refusing implicit remap.`);
      }
      await tx.binderProductAuthorityRatingModel.upsert({
        where: { binderProductAuthorityId: authority.id },
        create: { binderProductAuthorityId: authority.id, programRatingModelId: model.id },
        update: { programRatingModelId: model.id },
      });

      const existingDefinitionMapping = await tx.binderProductAuthorityProgramDefinition.findUnique({
        where: { binderProductAuthorityId: authority.id },
        include: { programDefinitionVersion: { select: { source: true, programId: true } } },
      });
      if (existingDefinitionMapping && existingDefinitionMapping.programDefinitionVersion.programId !== program.id) {
        throw new Error(`Binder authority ${authority.id} is already mapped to program definition for ${existingDefinitionMapping.programDefinitionVersion.programId}; refusing implicit remap.`);
      }
      if (String(existingDefinitionMapping?.programDefinitionVersion.source || '').includes('document-component-cutover-v3')) continue;

      const latestDefinition = await tx.programDefinitionVersion.findFirst({
        where: { programId: program.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const definitionVersion = await tx.programDefinitionVersion.create({
        data: {
          operatingTenantId: program.operatingTenantId,
          programId: program.id,
          version: (latestDefinition?.version || 0) + 1,
          status: 'PUBLISHED',
          pricingMode: 'AUTOMATED',
          programRatingModelId: model.id,
          ...requireConfiguredComponents({ programId: program.id, productType, metadata: asRecord(program.metadata) }),
          source: 'program-definition-document-component-cutover-v3',
          notes: 'Versioned programme-component cutover from deployed configuration.',
        },
        select: { id: true },
      });
      await tx.binderProductAuthorityProgramDefinition.upsert({
        where: { binderProductAuthorityId: authority.id },
        create: {
          operatingTenantId: program.operatingTenantId,
          binderProductAuthorityId: authority.id,
          programDefinitionVersionId: definitionVersion.id,
        },
        update: { programDefinitionVersionId: definitionVersion.id },
      });
    }
  });
}

async function materialiseManualDefinitions(
  program: { id: string; operatingTenantId: string; productType: string; metadata: Prisma.JsonValue | null },
  authorities: Array<{ id: string }>,
) {
  if (!isSupportedProductType(program.productType)) return;
  const productType = program.productType;
  for (const authority of authorities) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.binderProductAuthorityProgramDefinition.findUnique({
        where: { binderProductAuthorityId: authority.id },
        select: { id: true },
      });
      if (existing) return;
      const latest = await tx.programDefinitionVersion.findFirst({
        where: { programId: program.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const definition = await tx.programDefinitionVersion.create({
        data: {
          operatingTenantId: program.operatingTenantId,
          programId: program.id,
          version: (latest?.version || 0) + 1,
          status: 'PUBLISHED',
          pricingMode: 'MANUAL',
          ...requireConfiguredComponents({ programId: program.id, productType, metadata: asRecord(program.metadata) }),
          source: 'program-definition-cutover-v1',
          notes: 'One-time manual programme-definition cutover from deployed configuration.',
        },
        select: { id: true },
      });
      await tx.binderProductAuthorityProgramDefinition.create({
        data: {
          operatingTenantId: program.operatingTenantId,
          binderProductAuthorityId: authority.id,
          programDefinitionVersionId: definition.id,
        },
      });
    });
  }
}

function validateCutoverPrerequisites(programs: Array<{
  id: string;
  productType: string | null;
  metadata: Prisma.JsonValue | null;
}>): void {
  const failures: string[] = [];
  for (const program of programs) {
    if (!program.productType || !isSupportedProductType(program.productType)) continue;
    try {
      requireConfiguredComponents({
        programId: program.id,
        productType: program.productType,
        metadata: asRecord(program.metadata),
      });
    } catch (error: unknown) {
      failures.push(error instanceof Error ? error.message : `Program ${program.id} has invalid documents.productKit.`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Programme-definition cutover is blocked by incomplete explicit settings:\n${failures.join('\n')}`);
  }
}

async function validateAuthorityPrerequisites(programs: Array<{
  id: string;
  operatingTenantId: string;
  productType: string | null;
}>): Promise<Array<{ programId: string; productType: string; activeAuthorityIds: string[] }>> {
  const results: Array<{ programId: string; productType: string; activeAuthorityIds: string[] }> = [];
  const failures: string[] = [];
  for (const program of programs) {
    if (!program.productType || !isSupportedProductType(program.productType)) continue;
    const authorities = await prisma.binderProductAuthority.findMany({
      where: {
        operatingTenantId: program.operatingTenantId,
        productCode: program.productType,
        status: 'ACTIVE',
        binder: {
          status: 'ACTIVE',
          programLinks: { some: { programId: program.id, status: 'ACTIVE' } },
        },
      },
      select: { id: true },
    });
    if (authorities.length === 0) {
      failures.push(`Program ${program.id} (${program.productType}) has no active, linked binder-product authority.`);
      continue;
    }
    results.push({
      programId: program.id,
      productType: program.productType,
      activeAuthorityIds: authorities.map((authority) => authority.id),
    });
  }
  if (failures.length > 0) {
    throw new Error(`Programme-definition cutover is blocked by authority mapping gaps:\n${failures.join('\n')}`);
  }
  return results;
}

async function main() {
  const mode = resolveCutoverMode(process.argv.slice(2));
  const programs = await prisma.program.findMany({
    where: { status: 'ACTIVE', productType: { in: [...SUPPORTED_PRODUCT_TYPES] } },
    select: { id: true, operatingTenantId: true, productType: true, metadata: true },
  });
  validateCutoverPrerequisites(programs);
  const authorityMappings = await validateAuthorityPrerequisites(programs);
  if (mode === 'preflight') {
    console.info(JSON.stringify({
      mode,
      programs: authorityMappings,
      message: 'Programme-definition cutover preflight passed. No data was written.',
    }, null, 2));
    return;
  }
  for (const program of programs) {
    if (!program.productType) continue;
    await materialiseProgramModel({ ...program, productType: program.productType });
  }
  console.info(`Materialised programme rating models for ${programs.length} program(s).`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

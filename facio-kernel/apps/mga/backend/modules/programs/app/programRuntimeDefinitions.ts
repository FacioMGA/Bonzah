import { validateInsuranceConfigurationComponents } from '../../insuranceConfiguration/domain/runtimeConfiguration.js';
import { ProductRegistry } from '../../policy/domain/ProductRegistry.js';
import { resolveProductEngines } from '../../policy/domain/productEngines.js';
import { parsePublishedProgramMbeProductConfig } from '../../mbe/domain/programProduct.js';
import { validateClaimsProgrammeQuestionnaire } from '../../claims/domain/claimsContract.js';
import type { Prisma } from '@prisma/client';
import { parsePublishedProductKitForProduct, parsePublishedMotorProductKitForSources } from '../domain/productKit/productKit.js';

type ProgramDefinitionComponents = {
  underwriting: Prisma.JsonObject;
  coverage: Prisma.JsonObject;
  questionnaire: Prisma.JsonObject;
  workflow: Prisma.JsonObject;
  channels: Prisma.JsonObject;
  documents: Prisma.JsonObject;
};

const QUESTIONNAIRE_FIELD_TYPES = new Set([
  'text', 'date', 'boolean', 'number', 'currency', 'textarea', 'select', 'multiselect', 'list',
]);

export type ProgrammeChannelPermissions = {
  questions: boolean;
  quote: boolean;
  payment: boolean;
};

export type ProgrammeDocumentSelection = {
  requiredIssuedDocTypes: string[];
  sources: Array<{ documentType: string; sourceId: string; sourceVersion: string }>;
};

export class ProgrammeDefinitionEditorUnavailableError extends Error {
  readonly code = 'PROGRAMME_EDITOR_UNAVAILABLE';

  constructor(productType: string) {
    super(`Product ${productType} does not expose a programme-definition editor descriptor.`);
    this.name = 'ProgrammeDefinitionEditorUnavailableError';
  }
}

function requireObject(value: unknown, label: string): Prisma.JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Programme definition ${label} must be an object.`);
  }
  return value as Prisma.JsonObject;
}

/**
 * The published definition owns the three public-journey permissions. There
 * is deliberately no product, tenant, or previous-definition fallback.
 */
export function parseProgrammeChannelPermissions(value: unknown): ProgrammeChannelPermissions {
  const channels = requireObject(value, 'channels');
  for (const key of ['questions', 'quote', 'payment'] as const) {
    if (typeof channels[key] !== 'boolean') {
      throw new Error(`Programme definition channels requires boolean ${key}.`);
    }
  }
  return {
    questions: channels.questions as boolean,
    quote: channels.quote as boolean,
    payment: channels.payment as boolean,
  };
}

/** Validate all configuration before it can become a published authority. */
export function validateProgramDefinitionComponents(args: {
  productType: string;
  pricingMode: 'AUTOMATED' | 'MANUAL';
  components: ProgramDefinitionComponents;
}): void {
  const productType = String(args.productType || '').trim().toUpperCase();
  const underwriting = requireObject(args.components.underwriting, 'underwriting');
  const coverage = requireObject(args.components.coverage, 'coverage');
  const questionnaire = requireObject(args.components.questionnaire, 'questionnaire');
  const workflow = requireObject(args.components.workflow, 'workflow');
  const channels = requireObject(args.components.channels, 'channels');
  const documents = requireObject(args.components.documents, 'documents');
  validateInsuranceConfigurationComponents({ workflow: workflow as import('../../../platform/types/json.js').JsonObject, questionnaire: questionnaire as import('../../../platform/types/json.js').JsonObject, channels: channels as import('../../../platform/types/json.js').JsonObject }, productType);

  if (args.pricingMode === 'AUTOMATED') {
    validateProgramUwConfig(productType, underwriting);
    parsePublishedProgramMbeProductConfig(coverage, { productType });
  } else if (coverage.schemaVersion !== 1 || coverage.mode !== 'MANUAL') {
    throw new Error('Manually priced programme coverage requires { schemaVersion: 1, mode: "MANUAL" }.');
  }
  if (!Object.prototype.hasOwnProperty.call(questionnaire, 'requiredness')) {
    throw new Error('Programme definition questionnaire requires requiredness.');
  }
  if (!Array.isArray(questionnaire.sections) || questionnaire.sections.length === 0) {
    throw new Error('Programme definition questionnaire requires at least one configured section.');
  }
  for (const [sectionIndex, section] of questionnaire.sections.entries()) {
    if (!section || typeof section !== 'object' || Array.isArray(section)) {
      throw new Error(`Programme definition questionnaire section ${sectionIndex + 1} must be an object.`);
    }
    const sectionRecord = section as Prisma.JsonObject;
    if (!String(sectionRecord.id || '').trim() || !String(sectionRecord.title || '').trim()) {
      throw new Error(`Programme definition questionnaire section ${sectionIndex + 1} requires id and title.`);
    }
    if (!Array.isArray(sectionRecord.questions) || sectionRecord.questions.length === 0) {
      throw new Error(`Programme definition questionnaire section ${sectionIndex + 1} requires questions.`);
    }
    for (const [questionIndex, question] of sectionRecord.questions.entries()) {
      if (!question || typeof question !== 'object' || Array.isArray(question)) {
        throw new Error(`Programme definition questionnaire question ${sectionIndex + 1}.${questionIndex + 1} must be an object.`);
      }
      const questionRecord = question as Prisma.JsonObject;
      const questionType = String(questionRecord.type || '').trim().toLowerCase();
      if (!String(questionRecord.key || '').trim() || !String(questionRecord.label || '').trim() || !questionType) {
        throw new Error(`Programme definition questionnaire question ${sectionIndex + 1}.${questionIndex + 1} requires key, label and type.`);
      }
      if (!QUESTIONNAIRE_FIELD_TYPES.has(questionType)) {
        throw new Error(`Programme definition questionnaire question ${sectionIndex + 1}.${questionIndex + 1} has unsupported type "${questionType}".`);
      }
    }
  }
  validateClaimsProgrammeQuestionnaire({ productType, questionnaire });
  parseProgrammeChannelPermissions(channels);
  if (!Object.prototype.hasOwnProperty.call(workflow, 'referralOnly')) {
    throw new Error('Programme definition workflow requires referralOnly.');
  }
  const externalIssuance = requireObject(workflow.externalIssuance, 'workflow.externalIssuance');
  if (externalIssuance.mode !== 'NONE' && externalIssuance.mode !== 'manager_upload_after_payment') {
    throw new Error('Programme definition workflow.externalIssuance has an unsupported mode.');
  }
  if (externalIssuance.mode === 'manager_upload_after_payment' && (
    !Array.isArray(externalIssuance.documentTypes)
    || externalIssuance.documentTypes.some((type) => typeof type !== 'string' || !type.trim())
  )) {
    throw new Error('External issuance workflow requires documentTypes.');
  }
  const documentSelection = parsePublishedProgrammeDocumentSelection(productType, documents);
  if (args.pricingMode === 'AUTOMATED' && documentSelection.requiredIssuedDocTypes.length === 0) {
    throw new Error('Automated programme definitions require at least one issued-pack document type.');
  }
}

function getProductEngines(productType: string) {
  const adapter = ProductRegistry.getInstance().getAdapter(String(productType || '').trim().toUpperCase());
  const runtime = adapter?.getRuntimeDefinition();
  if (!runtime?.engines) return null;
  return resolveProductEngines(runtime.engines);
}

/**
 * BO authoring is generic: this app-layer projection exposes only the
 * descriptor declared by the canonical product runtime.
 */
export function getProgrammeDefinitionEditorDescriptor(productType: string) {
  const normalizedProductType = String(productType || '').trim().toUpperCase();
  const runtime = ProductRegistry.getInstance().getAdapter(normalizedProductType)?.getRuntimeDefinition();
  if (!runtime?.programmeDefinitionEditor || runtime.programmeDefinitionEditor.productType !== normalizedProductType) {
    throw new ProgrammeDefinitionEditorUnavailableError(normalizedProductType);
  }
  return runtime.programmeDefinitionEditor;
}

export function validateProgramUwConfig(productType: string, config: unknown): void {
  const validator = getProductEngines(productType)?.underwriting.validateProgramUwConfig;
  if (!validator) {
    throw new Error(`Product ${productType} does not expose a programmable underwriting configuration.`);
  }
  validator(config);
}

export function validateProgramRatingModel(productType: string, model: {
  id: string;
  programId: string;
  version: number;
  binderProductAuthorityId?: string;
  stages: unknown;
  tables: unknown;
}): void {
  const validator = getProductEngines(productType)?.rating.validateProgramRatingModel;
  if (!validator) {
    throw new Error(`Product ${productType} does not define a publishable programme rating model.`);
  }
  validator(model);
}

/**
 * Document files and rendering operators remain product-owned capabilities,
 * but a programme definition alone selects which issued-pack documents are
 * legally required for that binder-authorised programme.
 */
export function parsePublishedProgrammeDocumentSelection(
  productType: string,
  value: unknown,
): ProgrammeDocumentSelection {
  const documents = requireObject(value, 'documents');
  if (productType !== 'MOTOR') parsePublishedProductKitForProduct(productType, documents.productKit);
  const issuedPack = requireObject(documents.issuedPack, 'documents.issuedPack');
  if (!Array.isArray(issuedPack.requiredTypes)) {
    throw new Error('Programme definition documents.issuedPack requires a requiredTypes array.');
  }

  const adapter = ProductRegistry.getInstance().getAdapter(String(productType || '').trim().toUpperCase());
  if (!adapter) throw new Error(`Product ${productType} has no registered document vocabulary.`);
  const allowedTypes = new Set(Object.keys(adapter.getDocumentTypes()));
  const seen = new Set<string>();
  const requiredIssuedDocTypes = issuedPack.requiredTypes.map((raw, index) => {
    const documentType = typeof raw === 'string' ? raw.trim() : '';
    if (!documentType || !allowedTypes.has(documentType)) {
      throw new Error(`Programme definition documents.issuedPack.requiredTypes[${index}] is not a supported ${productType} document type.`);
    }
    if (seen.has(documentType)) {
      throw new Error(`Programme definition documents.issuedPack.requiredTypes duplicates ${documentType}.`);
    }
    seen.add(documentType);
    return documentType;
  });
  if (!Array.isArray(documents.sources)) {
    throw new Error('Programme definition documents requires a sources array.');
  }
  const sourceTypes = new Set<string>();
  const sources = documents.sources.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Programme definition documents.sources[${index}] must be an object.`);
    }
    const source = raw as Prisma.JsonObject;
    const documentType = typeof source.documentType === 'string' ? source.documentType.trim() : '';
    const sourceId = typeof source.sourceId === 'string' ? source.sourceId.trim() : '';
    const sourceVersion = typeof source.sourceVersion === 'string' ? source.sourceVersion.trim() : '';
    if (!documentType || !allowedTypes.has(documentType)) {
      throw new Error(`Programme definition documents.sources[${index}] has an unsupported ${productType} document type.`);
    }
    if (!sourceId) {
      throw new Error(`Programme definition documents.sources[${index}] requires sourceId.`);
    }
    if (!sourceVersion) {
      throw new Error(`Programme definition documents.sources[${index}] requires sourceVersion.`);
    }
    if (sourceTypes.has(documentType)) {
      throw new Error(`Programme definition documents.sources duplicates ${documentType}.`);
    }
    sourceTypes.add(documentType);
    return { documentType, sourceId, sourceVersion };
  });
  for (const requiredType of requiredIssuedDocTypes) {
    if (!sourceTypes.has(requiredType)) {
      throw new Error(`Programme definition documents.sources is missing required issued document ${requiredType}.`);
    }
  }
  if (productType === 'MOTOR') parsePublishedMotorProductKitForSources(documents.productKit, sources.map(source => source.documentType));
  return { requiredIssuedDocTypes, sources };
}

import type {
  BindRulesResult,
  BuildQuoteResponseContext,
  BuildVersionRowsArgs,
  CustomerJourneyMeta,
  DocPackGenerationArgs,
  DocPackGenerationResult,
  EndorsementPremiumResult,
  ProductViewModelBuilderParams,
  QuoteResponseResult,
  ProductGoldenFixtures,
  UwNormalizationResult,
  VersionMeta,
  VersionRow,
} from './productContracts.js';
import type { PremiumCalculation } from '../../../platform/types/index.js';
import type { ProductManifest } from '@facio/products';
import type { ProductDiscoverabilityInput, ProductDiscoverabilityProjection } from '../app/discoverability/types.js';
import type { ProductEngineProvider } from './productEngines.js';

export type ProductRuntimeExecutionMode = 'manifest_only' | 'runtime_config' | 'plugin';

export type RatingFrameworkDefinition = {
  framework: 'unified-rating';
  mode: 'table_assets' | 'plugin';
  source: 'deployed_asset' | 'program_model';
  assetRefs: string[];
  pluginKey?: string;
  traceSchemaVersion: string;
};

export type IntakeRuntimeDefinition = {
  publicSessionSlug: string;
  publicEntryPath: string;
  firstStep: string;
  validationMode: 'manifest_only' | 'product_schema';
};

/**
 * Product-owned schema for the generic BO programme-settings editor.  This is
 * intentionally structural: it defines editable components and allowed modes,
 * never an insurer's rates, territories, wording, questions or defaults.
 * Those business values live only in a versioned ProgrammeDefinition draft.
 */
export type ProgrammeDefinitionEditorComponentKey =
  | 'underwriting'
  | 'coverage'
  | 'questionnaire'
  | 'workflow'
  | 'channels'
  | 'documents';

/**
 * Product-owned authoring controls. The BO only renders a declared control;
 * product runtimes own which component may use a specialised editor.
 */
export type ProgrammeDefinitionEditorControl =
  | 'structured'
  | 'coverage'
  | 'questionnaire'
  | 'workflow'
  | 'channels'
  | 'documents'
  | 'home-underwriting'
  | 'travel-underwriting'
  | 'health-underwriting'
  | 'motor-underwriting';

export type ProgrammeDefinitionEditorDescriptor = {
  schemaVersion: 1;
  productType: string;
  pricingModes: ReadonlyArray<'AUTOMATED' | 'MANUAL'>;
  ratingPipeline?: ReadonlyArray<{ operator: string; label: string }>;
  components: ReadonlyArray<{
    key: ProgrammeDefinitionEditorComponentKey;
    label: string;
    description: string;
    control: ProgrammeDefinitionEditorControl;
  }>;
};

const programmeDefinitionComponents = [
  { key: 'underwriting', label: 'Underwriting', description: 'Eligibility, referral and decline rules for this programme.', control: 'structured' },
  { key: 'coverage', label: 'Cover and options', description: 'The cover, option and endorsement catalogue available for this programme.', control: 'coverage' },
  { key: 'questionnaire', label: 'Questionnaire', description: 'The questions, field types, options, visibility and requiredness for this programme.', control: 'questionnaire' },
  { key: 'workflow', label: 'Workflow', description: 'Referral, issuance and operator workflow for this programme.', control: 'workflow' },
  { key: 'channels', label: 'Channels', description: 'Whether questions, quotation and payment are permitted for this programme.', control: 'channels' },
  { key: 'documents', label: 'Document pack', description: 'The approved product kit and issued-policy document selection for this programme.', control: 'documents' },
] as const satisfies ReadonlyArray<{
  key: ProgrammeDefinitionEditorComponentKey;
  label: string;
  description: string;
  control: ProgrammeDefinitionEditorControl;
}>;

export function defineProgrammeDefinitionEditor(args: {
  productType: string;
  pricingModes: ReadonlyArray<'AUTOMATED' | 'MANUAL'>;
  ratingPipeline?: ReadonlyArray<{ operator: string; label: string }>;
  componentControls?: Partial<Record<ProgrammeDefinitionEditorComponentKey, ProgrammeDefinitionEditorControl>>;
}): ProgrammeDefinitionEditorDescriptor {
  return {
    schemaVersion: 1,
    productType: args.productType,
    pricingModes: [...args.pricingModes],
    ...(args.ratingPipeline ? { ratingPipeline: args.ratingPipeline.map((stage) => ({ ...stage })) } : {}),
    components: programmeDefinitionComponents.map((component) => ({
      ...component,
      control: args.componentControls?.[component.key] || component.control,
    })),
  };
}

export type ProductRuntimeDefinition = {
  resolvePolicyPeriod?: (quoteData: unknown) => { inceptionDate: Date; expiryDate: Date };
  productType: string;
  displayName: string;
  executionMode: ProductRuntimeExecutionMode;
  manifest: ProductManifest;
  goldenFixtures: ProductGoldenFixtures;
  customerJourney: CustomerJourneyMeta;
  intake: IntakeRuntimeDefinition;
  rating: RatingFrameworkDefinition;
  programmeDefinitionEditor: ProgrammeDefinitionEditorDescriptor;
  engines: ProductEngineProvider;
  getDocPackJobName(): string;
  calculatePremium(data: unknown, options?: { overrideExcess?: number | string | null }): PremiumCalculation;
  buildQuoteResponse(quoteData: unknown, context?: BuildQuoteResponseContext): Promise<QuoteResponseResult>;
  validateBindRules(quoteData: unknown, binderConfig: unknown): BindRulesResult;
  normalizeUwData(quoteData: unknown): UwNormalizationResult;
  buildVersionMeta(quoteData: unknown): VersionMeta;
  buildVersionRows(args: BuildVersionRowsArgs): VersionRow[];
  buildProductFields?(quoteData: unknown): Record<string, unknown>;
  getCustomerJourneyMeta(): CustomerJourneyMeta;
  buildDocViewModel?(params: ProductViewModelBuilderParams): Record<string, unknown> | null;
  buildDiscoverabilityProjection?(input: ProductDiscoverabilityInput): ProductDiscoverabilityProjection;
  generateDocPack(args: DocPackGenerationArgs): Promise<DocPackGenerationResult>;
  calculateEndorsementPremium(
    quoteData: unknown,
    appliedEndorsements: Array<{ code: string; params?: unknown }>,
    context?: BuildQuoteResponseContext,
  ): Promise<EndorsementPremiumResult>;
};

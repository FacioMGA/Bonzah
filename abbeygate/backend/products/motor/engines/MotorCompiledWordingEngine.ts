import type {
  IWordingEngine,
} from '../../../modules/policy/domain/productEngines.js';
import type {
  DocPackGenerationArgs,
  DocPackGenerationResult,
  ProductViewModelBuilderParams,
} from '../../../modules/policy/domain/productContracts.js';
import { buildMotorDocViewModel } from '../documents/viewModel.js';

export class MotorCompiledWordingEngine implements IWordingEngine {
  readonly engineId = 'motor.compiled.wording';
  readonly kind = 'compiled' as const;

  getDocPackJobName(): string {
    return 'DOC.GENERATE_MOTOR_DOC_PACK';
  }

  async render(args: DocPackGenerationArgs): Promise<DocPackGenerationResult> {
    const { executeMotorDocPackGeneration } = await import('../documents/generateMotorDocPack.js');
    return await executeMotorDocPackGeneration({
      policyId: args.policyId,
      riskTransactionId: args.riskTransactionId || null,
      docPack: args.docPack as import('../documents/generateMotorDocPack.js').MotorDocPack,
      source: args.source as 'CUSTOMER' | 'BO' | 'SYSTEM',
      generatedByUserId: args.generatedByUserId || null,
      templateVersion: args.templateVersion,
      db: args.db as never,
    }) as unknown as DocPackGenerationResult;
  }

  buildDocViewModel(params: ProductViewModelBuilderParams): Record<string, unknown> | null {
    try {
      return buildMotorDocViewModel({
        policy: { ...params.policyRecord, binder: params.binder || undefined },
        snap: params.snapshotRecord,
        activeEndorsements: params.activeEndorsements as never,
        mbeSections: params.mbeSections as never,
        normalizedMbeCfg: params.normalizedMbeCfg as never,
        greenCardSerial: String(params.policyRecord.greenCardSerial || '') || null,
        brand: params.brand as never,
        assetsBasePath: '',
      }) as unknown as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

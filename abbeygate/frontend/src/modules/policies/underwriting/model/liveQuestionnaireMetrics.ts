import type { LifecycleStageId } from '@facio/validation';
import { hasMeaningfulValue } from '@/src/shared/lib/products/questionnaire';
import { isFieldEffectivelyRequired } from '@/src/shared/lib/products/questionnaireFromProfile';
import {
  isQuestionVisibleForUnderwriting,
  type RendererFieldMeta,
} from './questionnaireProjection';

type QuestionnaireQuestionLike = {
  key?: unknown;
  visibleWhen?: unknown;
  replacedBy?: unknown;
};

type QuestionnaireSectionLike = {
  questions: QuestionnaireQuestionLike[];
};

type UnderwritingTriggerLike = {
  fields: string[];
};

export type LiveQuestionnaireMetrics = {
  completed: number;
  total: number;
  riskFlags: number;
};

export function computeLiveQuestionnaireMetrics(args: {
  questionnaireStructure: QuestionnaireSectionLike[];
  questionContractByKey: Record<string, RendererFieldMeta | undefined>;
  quoteData: Record<string, unknown>;
  dirtyFields: Record<string, unknown>;
  productType: string;
  underwritingStage: LifecycleStageId;
  underwritingTriggers: UnderwritingTriggerLike[];
  getQuestionValue: (fieldKey: string) => unknown;
  hasReplacementData: (replacementKey: string) => boolean;
}): LiveQuestionnaireMetrics {
  const currentAnswers = { ...args.quoteData, ...args.dirtyFields };
  const flaggedFieldKeys = new Set(args.underwritingTriggers.flatMap((trigger) => trigger.fields));

  return args.questionnaireStructure.reduce<LiveQuestionnaireMetrics>(
    (acc, section) => {
      for (const question of section.questions) {
        const fieldKey = String(question.key || '');
        if (!fieldKey) continue;
        const keyContract = args.questionContractByKey[fieldKey] || {};
        const visible = isQuestionVisibleForUnderwriting({
          fieldKey,
          contractMeta: keyContract,
          visibleWhenOverride: question.visibleWhen,
          context: { actor: 'underwriter', stage: args.underwritingStage },
          quoteData: args.quoteData,
          dirtyFields: args.dirtyFields,
        });
        if (!visible) continue;
        const replacementKey = String(question.replacedBy || keyContract.replacedBy || '');
        if (replacementKey && args.hasReplacementData(replacementKey)) continue;
        if (flaggedFieldKeys.has(fieldKey)) acc.riskFlags += 1;
        if (!isFieldEffectivelyRequired(args.productType, fieldKey, { actor: 'underwriter', stage: args.underwritingStage }, currentAnswers)) continue;
        acc.total += 1;
        if (hasMeaningfulValue(args.getQuestionValue(fieldKey))) acc.completed += 1;
      }
      return acc;
    },
    { completed: 0, total: 0, riskFlags: 0 },
  );
}

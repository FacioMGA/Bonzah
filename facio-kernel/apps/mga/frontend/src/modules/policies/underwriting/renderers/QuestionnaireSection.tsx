import React from 'react';
import {CommercialCoverageRows, CommercialSegmentField} from '@/src/modules/insuranceConfiguration';
import {getSelectedTenant} from '@/src/shared/lib/tenant/runtimeProfile';
import { asRecord } from '@/src/shared/lib/record';
import { sourceQuestionScopeUnavailable } from '../../config/sourceQuestionScope';
type QuestionOption = { value: string; label: string } | string;
import {
  isQuestionVisibleForUnderwriting,
  resolveQuestionSelectOptions,
  type RendererFieldMeta,
} from '../model/questionnaireProjection';
import { AdditionalDriversListField } from './AdditionalDriversListField';
import { QuestionnaireQuestionCard } from './QuestionnaireQuestionCard';
import type { LifecycleStageId } from '@facio/validation';
import { SearchableSelect } from '@/src/shared/ui';

type FollowUpSentMeta = { sentAt: string; status: 'sent' | 'viewed' | 'answered' };
type RiskPoint = { pts: number; kind?: 'pos' | 'neg' | 'warn' | 'miss'; why?: string; conf?: string };
type QuestionType = 'date' | 'boolean' | 'number' | 'currency' | 'textarea' | 'select' | 'multiselect' | 'text' | 'percentage' | 'list';

type PartQuestion = {
  key: unknown;
  label: string;
  type?: QuestionType | 'paragraph';
  body?: string;
  options?: unknown[];
  searchable?: boolean;
  visibleWhen?: unknown;
  sourceScope?: unknown;
  sourceScopeError?: unknown;
  replacedBy?: string;
  requiredAtStages?: LifecycleStageId[];
};

type QuestionnairePart = {
  title: string;
  questions: PartQuestion[];
  // Optional canonical step key carried from the questionnaire projection
  // when the part originated from a multi-step contract; falls back to a
  // slug derived from `title` when absent.
  stepKey?: string;
};

type Props = {
  part: QuestionnairePart;
  index: number;
  riskPoints?: Record<string, RiskPoint>;
  questionContractByKey: Record<string, RendererFieldMeta & { searchable?: boolean }>;
  underwritingStage: LifecycleStageId;
  quoteData: Record<string, unknown>;
  dirtyFields: Record<string, unknown>;
  hasReplacementData: (replacementKey: string) => boolean;
  makeOptions?: Array<{ value: string; label: string }>;
  modelOptions?: Array<{ value: string; label: string }>;
  variantSelectOptions?: Array<{ value: string; label: string }>;
  variantOptionsLoading?: boolean;
  activeVariantId?: string;
  activeMake?: string;
  activeModel?: string;
  activeYear?: number;
  selectVariant?: (variantId: string) => void;
  uwAnswers: Record<string, unknown>;
  followUpsSentMap: Record<string, FollowUpSentMeta>;
  followUpEnabled: boolean;
  inlineEditEnabled: boolean;
  lockQuestionnaireOps: boolean;
  editMode: 'preBind' | 'readOnly' | 'endorsementDraft';
  fieldErrors: Record<string, string>;
  fieldDisabled: boolean;
  isSavingChanges: boolean;
  updateQuestionField: (key: string, type: QuestionType | undefined, rawValue: unknown) => void;
  validateFieldOnBlur: (fieldPath: string) => void;
  formatCurrencyDisplay: (value: unknown) => string;
  formatCurrencyInputValue: (value: unknown) => string;
  openFollowUp: (args: { questionLabel: string; fieldKey: string; stepKey: string }) => void;
  selectedPortfolio: unknown;
  getQuestionValue: (key: unknown) => unknown;
};

export function QuestionnaireSection(props: Props) {
  const {
    part,
    index,
    riskPoints,
    questionContractByKey,
    underwritingStage,
    quoteData,
    dirtyFields,
    hasReplacementData,
    makeOptions,
    modelOptions,
    variantSelectOptions,
    variantOptionsLoading,
    activeVariantId,
    activeMake,
    activeModel,
    activeYear,
    selectVariant,
    uwAnswers,
    followUpsSentMap,
    followUpEnabled,
    inlineEditEnabled,
    lockQuestionnaireOps,
    editMode,
    fieldErrors,
    fieldDisabled,
    isSavingChanges,
    updateQuestionField,
    validateFieldOnBlur,
    formatCurrencyDisplay,
    formatCurrencyInputValue,
    openFollowUp,
    selectedPortfolio,
    getQuestionValue,
  } = props;

  const title = part.title.replace(/^Part\s+\d+:\s+/, '');
  const sectionScore = part.questions.reduce((acc, q) => acc + (q.type === 'paragraph' ? 0 : riskPoints?.[String(q.key)]?.pts || 0), 0);
  const dotPct = Math.max(0, Math.min(100, Math.round(50 + sectionScore)));
  const stepKeyForPart = part.stepKey || part.title.toLowerCase().replace(/\s+/g, '-');
  const binderProductAuthorityId = String(asRecord(asRecord(selectedPortfolio).programmeDefinition).binderProductAuthorityId || '');
  const scopeUnavailable = part.questions.some((question) => {
    const meta = questionContractByKey[String(question.key)] || {};
    return sourceQuestionScopeUnavailable(question.sourceScope === undefined ? meta.sourceScope : question.sourceScope,
      question.sourceScopeError === undefined ? meta.sourceScopeError : question.sourceScopeError, binderProductAuthorityId);
  });
  if (scopeUnavailable) return <section role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
    <h3 className="font-bold">{title}: question configuration unavailable</h3>
    <p className="mt-2">The published question scope or its binder context could not be verified. Reload the policy and review the published programme configuration before proceeding.</p>
  </section>;

  return (
    <section className="animate-in fade-in slide-in-from-bottom-4 duration-700" style={{ animationDelay: `${index * 80}ms` }}>
      <div className="pb-3 border-b border-slate-200/60">
        <h3 className="text-[11px] font-black text-slate-600 uppercase tracking-widest">
          {title}
        </h3>
        <div className="mt-3 flex items-center gap-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Section impact</div>
          <div className="flex-1 h-2 rounded-full bg-slate-100 border border-slate-200/60 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-rose-200/40 via-slate-100 to-brand-primary/20" />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-slate-900 shadow"
              style={{ left: `calc(${dotPct}% - 6px)` }}
              title={`Section score: ${sectionScore}`}
            />
          </div>
          <div className="text-[10px] font-black text-slate-500 tabular-nums">{sectionScore >= 0 ? `+${sectionScore}` : `${sectionScore}`}</div>
        </div>
      </div>

      <div className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-8">
        {part.questions.map((q, qIndex) => {
          const fieldKey = String(q.key || '');
          const questionType = q.type;
          const questionOptions = Array.isArray(q.options)
            ? (q.options as Array<QuestionOption>)
            : [];
          const keyContract = questionContractByKey[fieldKey] || {};
          const searchable = q.searchable === true || keyContract.searchable === true;
          const visibleWhen = q.visibleWhen || keyContract.visibleWhen;
          const replacedBy = q.replacedBy || keyContract.replacedBy;
          const isVisible = isQuestionVisibleForUnderwriting({
            fieldKey,
            contractMeta: keyContract,
            visibleWhenOverride: visibleWhen,
            sourceScope: q.sourceScope,
            sourceScopeError: q.sourceScopeError,
            binderProductAuthorityId,
            context: { actor: 'underwriter', stage: underwritingStage },
            quoteData,
            dirtyFields,
          });
          if (!isVisible) return null;
          if (replacedBy && hasReplacementData(String(replacedBy))) return null;
          if (questionType === 'paragraph') {
            const body = q.body ?? q.label;
            return <article key={fieldKey} id={`uw-field-${fieldKey}`} aria-label={q.label} className="md:col-span-2 min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-5">
              {body !== q.label ? <h4 className="mb-2 font-semibold text-slate-900">{q.label}</h4> : null}
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{body}</p>
            </article>;
          }

          const val = getQuestionValue(q.key);
          const { resolvedOptions, resolvedSelectOptions, hasResolvedOptions } = resolveQuestionSelectOptions({
            fieldKey,
            currentValue: val,
            questionOptions,
            makeOptions: makeOptions ?? [],
            modelOptions: modelOptions ?? [],
          });
          const draftReq = (Array.isArray(uwAnswers.followUpRequests) ? uwAnswers.followUpRequests : [])
            .find((r) => String(asRecord(r)?.fieldKey || '') === fieldKey || String(asRecord(r)?.question || '') === String(q.label));
          const outstandingReq = (Array.isArray(uwAnswers.outstandingRequests) ? uwAnswers.outstandingRequests : [])
            .find((r) => String(asRecord(r)?.fieldKey || '') === fieldKey || String(asRecord(r)?.question || '') === String(q.label));
          const pendingReq = draftReq || outstandingReq;
          const pendingState: 'draft' | 'outstanding' | null = draftReq ? 'draft' : outstandingReq ? 'outstanding' : null;
          const fieldFollowUpEnabled = followUpEnabled && inlineEditEnabled && !lockQuestionnaireOps;
          const chip = riskPoints?.[String(q.key)];
          const followUpSentKey = `${stepKeyForPart}:${fieldKey}`;
          const sentMeta = followUpsSentMap?.[followUpSentKey] || followUpsSentMap?.[fieldKey] || followUpsSentMap?.[q.label];
          const underwritingAnalysis = asRecord(asRecord(selectedPortfolio)?.underwritingAnalysis);
          const uwTriggers = Array.isArray(underwritingAnalysis?.triggers) ? (underwritingAnalysis.triggers as unknown[]) : [];
          const hits = uwTriggers.filter((t) => {
            const fields = asRecord(t)?.fields;
            return Array.isArray(fields) && fields.includes(String(q.key));
          });
          const uwLane = hits.some((h) => String(asRecord(h).lane) === 'red') ? 'red' : hits.some((h) => String(asRecord(h).lane) === 'yellow') ? 'yellow' : null;
          const uwMsgs = hits.map((h) => String(asRecord(h).message || '')).filter(Boolean);
          const draftFieldChanged = editMode === 'endorsementDraft' && Object.prototype.hasOwnProperty.call(dirtyFields, fieldKey);
          const fieldError = fieldErrors[fieldKey];
          const actorStageRequirements = asRecord(keyContract.requiredAtByActor).underwriter;
          const requiredAtStages = Array.isArray(q.requiredAtStages)
            ? q.requiredAtStages
            : Array.isArray(actorStageRequirements)
            ? actorStageRequirements as LifecycleStageId[]
            : Array.isArray(keyContract.requiredAtStages)
              ? keyContract.requiredAtStages
              : q.requiredAtStages;

          if (fieldKey === 'commercial.coverages' || fieldKey === 'commercial.segmentId') {
            const definition = asRecord(asRecord(selectedPortfolio).programmeDefinition);
            const mapping = {programId: String(definition.programId || ''), binderProductAuthorityId: String(definition.binderProductAuthorityId || '')};
            return <div key={fieldKey} className="md:col-span-2">
              {fieldKey === 'commercial.coverages' ? <CommercialCoverageRows {...mapping} value={val} disabled={fieldDisabled || isSavingChanges} onChange={rows => updateQuestionField(fieldKey, 'list', rows)} fieldError={fieldError} currency={getSelectedTenant()?.profile.currency} /> : <CommercialSegmentField {...mapping} value={val} disabled={fieldDisabled || isSavingChanges} onChange={value => updateQuestionField(fieldKey, 'text', value)} fieldError={fieldError} />}
            </div>;
          }
          if (fieldKey === 'additionalDrivers') {
            return (
              <AdditionalDriversListField
                key={`${fieldKey}-question`}
                fieldKey={fieldKey}
                value={val}
                fieldDisabled={fieldDisabled}
                fieldError={fieldError}
                updateQuestionField={updateQuestionField}
                validateFieldOnBlur={validateFieldOnBlur}
              />
            );
          }

          const card = (
            <QuestionnaireQuestionCard
                key={`${fieldKey}-question`}
                question={{ ...q, type: questionType }}
                fieldKey={fieldKey}
                value={val}
                questionType={questionType}
                searchable={searchable}
                resolvedOptions={resolvedOptions}
                resolvedSelectOptions={resolvedSelectOptions}
                hasResolvedOptions={hasResolvedOptions}
                fieldDisabled={fieldDisabled}
                isSavingChanges={isSavingChanges}
                updateQuestionField={updateQuestionField}
                validateFieldOnBlur={validateFieldOnBlur}
                formatCurrencyDisplay={formatCurrencyDisplay}
                formatCurrencyInputValue={formatCurrencyInputValue}
                fieldError={fieldError}
                requiredAtStages={requiredAtStages}
                draftFieldChanged={draftFieldChanged}
                pendingReq={pendingReq ? asRecord(pendingReq) : null}
                pendingState={pendingState}
                sentMeta={sentMeta}
                fieldFollowUpEnabled={fieldFollowUpEnabled}
                openFollowUp={openFollowUp}
                stepKeyForPart={stepKeyForPart}
                uwLane={uwLane}
                uwMsgs={uwMsgs}
                chip={chip}
              />
          );
          const shouldRenderTrimSelector =
            fieldKey === 'year' &&
            (Boolean(activeMake && activeModel) || Boolean(activeVariantId) || Boolean(variantOptionsLoading));
          if (!shouldRenderTrimSelector) return card;
          const trimDisabled = fieldDisabled || !activeYear || Number(activeYear) < 1970 || (variantSelectOptions ?? []).length === 0;
          const trimPlaceholder = !activeYear
            ? 'Select year first'
            : variantOptionsLoading
              ? 'Loading trims...'
              : (variantSelectOptions ?? []).length === 0
                ? 'No trims found'
                : 'Select trim...';
          return (
            <React.Fragment key={qIndex}>
              {card}
              <div id="uw-field-trim" className="relative group/field">
                <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">
                  Trim
                </label>
                <div className="rounded-xl px-5 py-4 font-bold text-slate-700 border border-slate-200/80 bg-white/30">
                  <SearchableSelect
                    value={String(activeVariantId || '')}
                    onChange={(next) => selectVariant?.(next)}
                    options={variantSelectOptions ?? []}
                    placeholder={trimPlaceholder}
                    searchPlaceholder="Type to search..."
                    disabled={trimDisabled}
                    loading={variantOptionsLoading}
                  />
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </section>
  );
}

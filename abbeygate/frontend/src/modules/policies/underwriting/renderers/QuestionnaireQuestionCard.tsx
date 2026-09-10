import React from 'react';
import { Button, Input, MoneyInput, MultiSearchableSelect, SearchableSelect, Select, Textarea } from '@/src/shared/ui';
import { formatDateUI } from '@/src/shared/lib/format';
import { getBooleanSelectOptions } from '../model/booleanOptionOrder';
import { asRecord } from '@/src/shared/lib/record';
import type { LifecycleStageId } from '@facio/validation';

type QuestionType = 'date' | 'boolean' | 'number' | 'currency' | 'textarea' | 'select' | 'multiselect' | 'text' | 'percentage' | 'list';

type QuestionLike = {
  key: unknown;
  label: string;
  type?: QuestionType;
};

type RiskPoint = { pts: number; kind?: 'pos' | 'neg' | 'warn' | 'miss'; why?: string; conf?: string };

type FollowUpSentMeta = { sentAt: string; status: 'sent' | 'viewed' | 'answered' };

type Props = {
  question: QuestionLike;
  fieldKey: string;
  value: unknown;
  questionType: QuestionType | undefined;
  searchable: boolean;
  resolvedOptions: string[];
  resolvedSelectOptions: Array<{ value: string; label: string }>;
  hasResolvedOptions: boolean;
  fieldDisabled: boolean;
  isSavingChanges: boolean;
  updateQuestionField: (key: string, type: QuestionType | undefined, rawValue: unknown) => void;
  validateFieldOnBlur: (fieldPath: string) => void;
  formatCurrencyDisplay: (value: unknown) => string;
  formatCurrencyInputValue: (value: unknown) => string;
  fieldError?: string;
  requiredAtStages?: LifecycleStageId[];
  draftFieldChanged: boolean;
  pendingReq: Record<string, unknown> | null;
  pendingState: 'draft' | 'outstanding' | null;
  sentMeta?: FollowUpSentMeta;
  fieldFollowUpEnabled: boolean;
  openFollowUp: (args: { questionLabel: string; fieldKey: string; stepKey: string }) => void;
  stepKeyForPart: string;
  uwLane: 'red' | 'yellow' | null;
  uwMsgs: string[];
  chip?: RiskPoint;
};

export function QuestionnaireQuestionCard(props: Props) {
  const {
    question,
    fieldKey,
    value,
    questionType,
    searchable,
    resolvedOptions,
    resolvedSelectOptions,
    hasResolvedOptions,
    fieldDisabled,
    updateQuestionField,
    validateFieldOnBlur,
    formatCurrencyDisplay,
    formatCurrencyInputValue,
    fieldError,
    requiredAtStages,
    draftFieldChanged,
    pendingReq,
    pendingState,
    sentMeta,
    fieldFollowUpEnabled,
    openFollowUp,
    stepKeyForPart,
    uwLane,
    uwMsgs,
    chip,
  } = props;

  const booleanSelectOptions = React.useMemo(
    () => getBooleanSelectOptions(fieldKey),
    [fieldKey]
  );

  let displayText = '';
  if (question.type === 'boolean') {
    const isTrue = value === true || value === 'true';
    const isFalse = value === false || value === 'false';
    displayText = isTrue ? 'Yes' : isFalse ? 'No' : '';
  } else if (question.type === 'currency') {
    displayText = formatCurrencyDisplay(value);
  } else if (question.type === 'multiselect' || Array.isArray(value)) {
    displayText = Array.isArray(value) ? value.join(', ') : String(value || '');
  } else {
    displayText = String(value ?? '');
  }
  const isEmpty = !displayText;
  const requiredForQuote = Boolean(requiredAtStages?.some((stage) => stage === 'quote' || stage === 'pricing'));
  const requiredForIssuance = Boolean(requiredAtStages?.some((stage) => stage === 'bind' || stage === 'issuance'));
  const requiredMark = requiredForQuote ? (
    <span className="ml-1 text-rose-500 text-lg font-black" title={requiredForIssuance ? 'Required for quote and issuance' : 'Required for quote'}>*</span>
  ) : requiredForIssuance ? (
    <span className="ml-1 text-amber-500 text-lg font-black" title="Required for issuance">*</span>
  ) : null;

  return (
    <div id={`uw-field-${fieldKey}`} className="relative group/field">
      <label className="absolute -top-2.5 left-4 bg-brand-canvas px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10">
        {question.label}{requiredMark}
      </label>

      <div
        className={`relative w-full border ${pendingReq
          ? 'border-amber-300/60 bg-amber-50/10'
          : draftFieldChanged
            ? 'border-amber-300 bg-amber-100/50'
            : uwLane === 'red'
              ? 'border-rose-300/80 bg-rose-50/10'
              : uwLane === 'yellow'
                ? 'border-amber-300/80 bg-amber-50/10'
                : fieldError
                  ? 'border-rose-300/80 bg-rose-50/10'
                  : fieldFollowUpEnabled
                    ? 'border-slate-200/80 bg-white/30 group-hover/field:border-brand-primary/25 group-hover/field:bg-white/60'
                    : 'border-slate-200/80 bg-white/30'
          } rounded-xl px-5 py-4 font-bold text-slate-700 transition-[border-color,background-color,color] duration-200`}
      >
        {pendingReq && (
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-1 bg-amber-400 rounded-l-xl" />
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            {questionType === 'boolean' ? (
              <Select
                variant="ui"
                value={value === true || value === 'true' ? 'true' : value === false || value === 'false' ? 'false' : ''}
                onChange={(e) => updateQuestionField(fieldKey, questionType, e.target.value)}
                onBlur={() => validateFieldOnBlur(fieldKey)}
                disabled={fieldDisabled}
              >
                <option value="">Select...</option>
                {booleanSelectOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            ) : questionType === 'select' && searchable ? (
              !hasResolvedOptions ? (
                <Select
                  variant="ui"
                  value=""
                  disabled
                >
                  <option value="">No options configured</option>
                </Select>
              ) : (
                <SearchableSelect
                  value={String(value ?? '')}
                  onChange={(next) => updateQuestionField(fieldKey, questionType, next)}
                  onBlur={() => validateFieldOnBlur(fieldKey)}
                  options={resolvedSelectOptions}
                  placeholder="Select..."
                  searchPlaceholder="Type to search..."
                  disabled={fieldDisabled}
                />
              )
            ) : questionType === 'select' && hasResolvedOptions ? (
              <Select
                variant="ui"
                value={(() => {
                  const v = String(value ?? '');
                  if ((v === 'true' || value === true) && resolvedOptions.includes('Yes')) return 'Yes';
                  if ((v === 'false' || value === false) && resolvedOptions.includes('No')) return 'No';
                  return v;
                })()}
                onChange={(e) => updateQuestionField(fieldKey, questionType, e.target.value)}
                onBlur={() => validateFieldOnBlur(fieldKey)}
                disabled={fieldDisabled}
              >
                <option value="">Select...</option>
                {resolvedSelectOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </Select>
            ) : questionType === 'select' ? (
              <Select
                variant="ui"
                value=""
                disabled
              >
                <option value="">No options configured</option>
              </Select>
            ) : questionType === 'multiselect' && hasResolvedOptions ? (
              <MultiSearchableSelect
                values={Array.isArray(value) ? value.map((v) => String(v)) : []}
                onChange={(next) => updateQuestionField(fieldKey, questionType, next)}
                onBlur={() => validateFieldOnBlur(fieldKey)}
                options={resolvedSelectOptions}
                placeholder="Select options…"
                searchPlaceholder="Type to search…"
                disabled={fieldDisabled}
              />
            ) : questionType === 'textarea' ? (
              <Textarea
                value={String(value ?? '')}
                onChange={(e) => updateQuestionField(fieldKey, questionType, e.target.value)}
                onBlur={() => validateFieldOnBlur(fieldKey)}
                className="min-h-[96px] bg-transparent disabled:bg-transparent"
                disabled={fieldDisabled}
              />
            ) : questionType === 'currency' ? (
              <MoneyInput
                name={fieldKey}
                aria-label={question.label}
                value={formatCurrencyInputValue(value)}
                onValueChange={(next) => {
                  const nextDigits = next.replace(/[^\d]/g, '');
                  updateQuestionField(fieldKey, questionType, nextDigits);
                }}
                onBlur={() => validateFieldOnBlur(fieldKey)}
                maxDecimals={0}
                disabled={fieldDisabled}
                variant="ui"
                align="left"
              />
            ) : (
              <Input
                type={questionType === 'date' ? 'date' : questionType === 'number' ? 'number' : 'text'}
                name={fieldKey}
                aria-label={question.label}
                value={String(value ?? '')}
                onChange={(e) => updateQuestionField(fieldKey, questionType, e.target.value)}
                onBlur={() => validateFieldOnBlur(fieldKey)}
                variant="ui"
                disabled={fieldDisabled}
              />
            )}
          </div>

          {uwLane && (
            <span
              title={uwMsgs.length ? uwMsgs.join(' ') : 'Triggered by underwriting automation'}
              className={`shrink-0 px-2.5 py-1 rounded-xl text-[10px] font-black tracking-widest ${uwLane === 'red' ? 'bg-rose-100/70 text-rose-900' : 'bg-amber-100/70 text-amber-900'
                }`}
            >
              {uwLane.toUpperCase()}
            </span>
          )}

          {chip && (chip.kind !== 'pos' || chip.pts !== 0) && (
            <span
              title={`Impact: ${chip.pts >= 0 ? '+' : ''}${chip.pts} • ${chip.why} • Confidence: ${chip.conf}`}
              className={`shrink-0 px-2.5 py-1 rounded-xl text-[10px] font-black tracking-widest ${chip.kind === 'pos'
                ? 'bg-brand-primary/10 text-brand-primary'
                : chip.kind === 'neg'
                  ? 'bg-slate-100 text-slate-700'
                  : chip.kind === 'warn'
                    ? 'bg-amber-100/70 text-amber-900'
                    : 'bg-slate-100 text-slate-500'
                }`}
            >
              {chip.kind === 'miss' ? '?' : chip.pts >= 0 ? `+${chip.pts}` : `${chip.pts}`}
            </span>
          )}
        </div>
      </div>

      {fieldError ? (
        <div className="mt-2 text-[11px] font-semibold text-red-600">
          {fieldError}
        </div>
      ) : null}

      {pendingReq ? (
        <div className="mt-2 text-[10px] font-black uppercase tracking-widest text-amber-600 space-y-1">
          <div>Follow-up linked ({pendingState === 'draft' ? 'draft' : 'sent'})</div>
          <div className="font-bold normal-case tracking-normal text-amber-700/90">
            {String(asRecord(pendingReq).type || 'Ask for more detail')} - {String(asRecord(pendingReq).fieldKey || fieldKey)}
          </div>
        </div>
      ) : sentMeta ? (
        <div className="mt-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
          Follow-up sent • {formatDateUI(sentMeta.sentAt, { withTime: true })}
        </div>
      ) : null}
      {fieldFollowUpEnabled && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="h-8 px-3 rounded-xl text-[10px] font-black uppercase tracking-widest"
            onClick={() => {
              openFollowUp({
                questionLabel: question.label,
                fieldKey,
                stepKey: stepKeyForPart,
              });
            }}
          >
            Follow-up
          </Button>
        </div>
      )}
      {!fieldDisabled ? null : (
        <span className={isEmpty ? 'text-slate-300 italic font-semibold hidden' : 'hidden'}>{displayText}</span>
      )}
    </div>
  );
}

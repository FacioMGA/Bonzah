import React, { useMemo } from 'react';
import { Button, Select, Toast } from '@/src/shared/ui';
import type { DevelopmentType, Worksheet } from '../model/worksheetTypes';
import { ClaimActivityTimeline } from './ClaimActivityTimeline';

type Props = {
  worksheet: Worksheet;
  commandType: DevelopmentType;
  setCommandType: (next: DevelopmentType) => void;
  renderDevelopmentForm: () => React.ReactNode;
  applyDevelopment: () => Promise<void> | void;
  busy: boolean;
  applyLoadingLabel: string;
  applySuccessMessage: string;
  onDismissApplySuccess: () => void;
  lastApplyTick: number;
  showDevelopmentComposer: boolean;
  setShowDevelopmentComposer: (next: boolean) => void;
  developmentTypes: ReadonlyArray<{ value: DevelopmentType; label: string }>;
  paymentInlineError?: string;
};

const ACTION_GROUPS = {
  FINANCIAL: 'Financial',
  HANDLING: 'Handling',
  DOCUMENTATION: 'Documentation',
} as const;

function actionGroup(value: DevelopmentType): keyof typeof ACTION_GROUPS {
  if (
    value === 'SET_RESERVE'
    || value === 'ADJUST_RESERVE'
    || value === 'ADD_PAYMENT'
    || value === 'SET_RECOVERY_EXPECTED'
    || value === 'ADD_RECOVERY_RECEIVED'
  ) return 'FINANCIAL';
  if (
    value === 'CREATE_APPOINTMENT'
    || value === 'DENY_CLAIM'
    || value === 'CLOSE'
    || value === 'REOPEN'
  ) return 'HANDLING';
  return 'DOCUMENTATION';
}

export function ClaimTimelineTab(props: Props) {
  const {
    worksheet,
    commandType,
    setCommandType,
    renderDevelopmentForm,
    applyDevelopment,
    busy,
    applyLoadingLabel,
    applySuccessMessage,
    onDismissApplySuccess,
    lastApplyTick,
    showDevelopmentComposer,
    setShowDevelopmentComposer,
    developmentTypes,
    paymentInlineError = '',
  } = props;
  const applyLabel = commandType === 'SET_RESERVE'
    ? 'Apply reserve update'
    : commandType === 'ADJUST_RESERVE'
      ? 'Apply reserve adjustment'
      : commandType === 'ADD_PAYMENT'
        ? 'Apply payment'
        : commandType === 'SET_RECOVERY_EXPECTED'
          ? 'Apply recovery expectation'
          : commandType === 'ADD_RECOVERY_RECEIVED'
            ? 'Apply recovery receipt'
            : commandType === 'CREATE_APPOINTMENT'
              ? 'Apply appointment'
              : commandType === 'DENY_CLAIM'
                ? 'Apply denial'
                : commandType === 'CLOSE'
                  ? 'Apply closure'
                  : commandType === 'REOPEN'
                    ? 'Apply reopen'
                    : commandType === 'ADD_CLAIM_NOTE'
                      ? 'Add note'
                      : commandType === 'ADD_CLAIM_EVIDENCE'
                        ? 'Upload evidence'
      : 'Apply activity';

  const groupedTypes = useMemo(() => {
    const grouped: Record<keyof typeof ACTION_GROUPS, Array<{ value: DevelopmentType; label: string }>> = {
      FINANCIAL: [],
      HANDLING: [],
      DOCUMENTATION: [],
    };
    for (const type of developmentTypes) {
      grouped[actionGroup(type.value)].push(type);
    }
    return grouped;
  }, [developmentTypes]);
  const isPaymentBlocked = commandType === 'ADD_PAYMENT' && Boolean(paymentInlineError);

  return (
    <div className="space-y-5">
      <Toast
        message={applySuccessMessage}
        isVisible={Boolean(applySuccessMessage)}
        onClose={onDismissApplySuccess}
        type="success"
        duration={2000}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,58%)_minmax(0,42%)] xl:h-[calc(100vh-305px)] xl:min-h-[560px] xl:max-h-[780px]">
        <aside className="self-start">
          <section id="claims-activity-action-panel" className="rounded-3xl bg-white p-5 space-y-4 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
            <div className="text-xs font-black uppercase tracking-wider text-slate-500">Take action</div>

            {!showDevelopmentComposer ? (
              <Button
                onClick={() => setShowDevelopmentComposer(true)}
                disabled={developmentTypes.length === 0}
                className="h-[56.5px] min-w-[220px] px-8 text-sm font-black tracking-tight rounded-xl"
              >
                + Add action
              </Button>
            ) : null}

            {developmentTypes.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
                No actions are available in the current intake state.
              </div>
            ) : null}

            {showDevelopmentComposer ? (
              <>
                <div className="space-y-4">
                  <div className="w-full">
                    <Select
                      variant="ui"
                      value={commandType}
                      onChange={(e) => setCommandType(e.target.value as DevelopmentType)}
                    >
                      <optgroup label="Recent">
                        <option value={commandType}>
                          {developmentTypes.find((item) => item.value === commandType)?.label || applyLabel}
                        </option>
                      </optgroup>
                      {(Object.keys(ACTION_GROUPS) as Array<keyof typeof ACTION_GROUPS>).map((groupKey) => (
                        groupedTypes[groupKey].length ? (
                          <optgroup key={groupKey} label={ACTION_GROUPS[groupKey]}>
                            {groupedTypes[groupKey].map((item) => (
                              <option key={item.value} value={item.value}>{item.label}</option>
                            ))}
                          </optgroup>
                        ) : null
                      ))}
                    </Select>
                  </div>
                  {renderDevelopmentForm()}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setShowDevelopmentComposer(false)}
                    className="h-[56.5px] px-8 text-sm font-black tracking-tight rounded-xl"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void applyDevelopment()}
                    isLoading={busy}
                    disabled={isPaymentBlocked}
                    className="h-[56.5px] px-8 text-sm font-black tracking-tight rounded-xl inline-flex items-center gap-2"
                  >
                    {!busy ? (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : null}
                    {busy ? (applyLoadingLabel || 'Applying…') : applyLabel}
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm font-semibold text-slate-600">
                Select an action to update this claim.
              </div>
            )}
          </section>
          {worksheet.complianceGaps.length > 0 ? (
            <section className="mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <div className="text-xs font-black uppercase tracking-wider text-amber-700">Reporting Health</div>
              <ul className="mt-2 space-y-1">
                {worksheet.complianceGaps.map((gap) => (
                  <li key={gap} className="text-sm font-semibold text-amber-900">{gap}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>

        <section className="space-y-3 min-w-0 xl:h-full xl:overflow-hidden">
          <div className="text-xs font-black uppercase tracking-wider text-slate-500">Claim activity</div>
          <div className="xl:h-[calc(100%-24px)] xl:overflow-auto pr-1">
            <ClaimActivityTimeline
              events={worksheet.timeline}
              emptyMessage="No claim activity yet. Actions taken on this claim will appear here."
              highlightVersion={lastApplyTick}
            />
          </div>
        </section>
      </div>
    </div>
  );
}


import {
  homeInformationStepIds,
  homeInformationSubsectionByStepId,
} from '../quoteWizard.constants';

export interface HomeInformationStageProgressProps {
  currentStepId: string;
}

/**
 * Customer-facing progress inside Home journey stage one. It intentionally
 * reflects the existing form sequence instead of navigating it: validation,
 * autosave and resume routing remain owned by the Home wizard flow.
 */
export function HomeInformationStageProgress({ currentStepId }: HomeInformationStageProgressProps) {
  const currentIndex = homeInformationStepIds.indexOf(currentStepId);
  if (currentIndex < 0) return null;

  const currentLabel = homeInformationSubsectionByStepId[currentStepId];
  return (
    <section aria-label="Quotation information progress" className="max-w-3xl">
      <p className="mb-5 text-sm font-medium text-slate-500">
        {currentLabel} — {currentIndex + 1} of {homeInformationStepIds.length}
      </p>
      <div className="ui-tabsbar gap-6" aria-label="Quotation information sections">
        {homeInformationStepIds.map((stepId) => {
          const label = homeInformationSubsectionByStepId[stepId];
          const active = stepId === currentStepId;
          return (
            <span
              key={stepId}
              aria-current={active ? 'step' : undefined}
              className={`ui-tab ${active ? 'ui-tab-active' : 'ui-tab-inactive'} pb-3 text-[10px] font-semibold uppercase tracking-wide`}
            >
              {label}
            </span>
          );
        })}
      </div>
    </section>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';

type FieldErrors = Record<string, string | undefined>;

export function useFnolGuidedFlowCore<TForm extends Record<string, unknown>>(args: {
  totalSteps: number;
  canContinueByStep: Record<number, boolean>;
  computedFieldErrors: FieldErrors;
  groupedFieldSources?: Record<string, Array<keyof TForm>>;
  formState: TForm;
  setFormState: React.Dispatch<React.SetStateAction<TForm>>;
}) {
  const {
    totalSteps,
    canContinueByStep,
    computedFieldErrors,
    groupedFieldSources = {},
    setFormState,
  } = args;

  const [step, setStep] = useState(1);
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [changedFields, setChangedFields] = useState<Partial<Record<keyof TForm, boolean>>>({});

  useEffect(() => {
    setStep((prev) => Math.min(prev, totalSteps));
  }, [totalSteps]);

  const setFormTracked = useCallback<React.Dispatch<React.SetStateAction<TForm>>>((updater) => {
    setFormState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      const changed: Partial<Record<keyof TForm, boolean>> = {};
      (Object.keys(next) as Array<keyof TForm>).forEach((key) => {
        if (!Object.is(prev[key], next[key])) changed[key] = true;
      });
      if (Object.keys(changed).length > 0) {
        setChangedFields((prevChanged) => ({ ...prevChanged, ...changed }));
      }
      return next;
    });
  }, [setFormState]);

  const shouldShowFieldError = useCallback((fieldKey: string): boolean => {
    if (showValidationErrors) return true;
    if (changedFields[fieldKey as keyof TForm]) return true;
    return (groupedFieldSources[fieldKey] || []).some((source) => Boolean(changedFields[source]));
  }, [showValidationErrors, changedFields, groupedFieldSources]);

  const visibleFieldErrors = useMemo<FieldErrors>(() => {
    const next: FieldErrors = {};
    for (const [key, value] of Object.entries(computedFieldErrors || {})) {
      if (!value) continue;
      if (shouldShowFieldError(key)) next[key] = value;
    }
    return next;
  }, [computedFieldErrors, shouldShowFieldError]);

  const nextStep = useCallback(() => {
    const canContinue = canContinueByStep[step] ?? true;
    if (!canContinue) {
      setShowValidationErrors(true);
      return;
    }
    setStep((prev) => Math.min(totalSteps, prev + 1));
  }, [canContinueByStep, step, totalSteps]);

  const prevStep = useCallback(() => {
    setStep((prev) => Math.max(1, prev - 1));
  }, []);

  return {
    step,
    setStep,
    nextStep,
    prevStep,
    showValidationErrors,
    setShowValidationErrors,
    changedFields,
    setChangedFields,
    setFormTracked,
    visibleFieldErrors,
  };
}

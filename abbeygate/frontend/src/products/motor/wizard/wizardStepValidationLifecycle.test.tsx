/* @vitest-environment happy-dom */
import React, { useEffect, useRef } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { describe, expect, it } from 'vitest';
import type { QuoteData } from './types';
import { initialQuoteData } from './quoteWizard.constants';
import { collectErrorEntries, dedupeErrorEntries } from '@/src/shared/lib/wizard/utils/errors';
import {
  applyWizardStepErrors,
  reconcileAdditionalDriverFieldError,
  reconcileWizardStepErrors,
  validateWizardStep,
} from './wizardStepValidation';

type HarnessApi = {
  form: UseFormReturn<QuoteData>;
  continueStep: (step: number) => void;
  blurField: (step: number, field: string) => void;
  changeField: (step: number, field: string, value: unknown) => void;
  summaryFields: () => string[];
  fieldMessage: (field: string) => string;
};

function isoDateOffset(days: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function createValidStep3Data(): QuoteData {
  return {
    ...initialQuoteData,
    vehicleLocation: 'Cyprus',
    countryOfRegistration: 'Cyprus',
    coverRequired: 'Comprehensive',
    renewalDate: isoDateOffset(10),
    make: 'Toyota',
    model: 'Corolla',
    year: 2020,
    fuelType: 'Petrol',
    cabrio: 'No',
    numberOfSeats: 5,
    engineSize: 1800,
    vehicleType: 'Car',
    parking: 'Drive',
    modified: false,
    vehicleValue: 15000,
    kmsPerYear: '10,000',
    ncb: '1 Year',
    vehicleUse: 'social',
    infoTrueAndAccurate: true,
    fairProcessingAccepted: true,
  };
}

function createValidStep2Data(): QuoteData {
  return {
    ...initialQuoteData,
    proposer: {
      ...initialQuoteData.proposer,
      occupation: 'Engineer',
      whereDidYouHear: 'Google',
      dateOfBirth: '1990-01-01',
    },
    licenseYears: 10,
    licenseType: 'Full',
    licenseIssuedIn: 'United Kingdom',
    hasClaims: false,
    hasConvictions: false,
    hasAdditionalDrivers: false,
  };
}

function Harness({ defaultValues, onReady }: { defaultValues: QuoteData; onReady: (api: HarnessApi) => void }) {
  const form = useForm<QuoteData>({
    defaultValues,
    mode: 'onBlur',
    shouldUnregister: false,
  });
  const latestErrorsRef = useRef(form.formState.errors);
  latestErrorsRef.current = form.formState.errors;

  useEffect(() => {
    onReady({
      form,
      continueStep: (step) => {
        applyWizardStepErrors(form, validateWizardStep(step, form.getValues()));
      },
      blurField: (step, field) => {
        reconcileWizardStepErrors({
          form,
          currentStep: step,
          changedField: field,
          mode: 'blur',
        });
      },
      changeField: (step, field, value) => {
        form.setValue(field as never, value as never, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
        const handledAdditionalDriver = reconcileAdditionalDriverFieldError({
          form,
          changedField: field,
          mode: 'change',
          hasFieldError: Boolean(form.getFieldState(field as keyof QuoteData).error),
        });
        if (handledAdditionalDriver) return;
        reconcileWizardStepErrors({
          form,
          currentStep: step,
          changedField: field,
          mode: 'change',
        });
      },
      summaryFields: () =>
        dedupeErrorEntries(collectErrorEntries(latestErrorsRef.current))
          .map((entry) => entry.field)
          .sort(),
      fieldMessage: (field) => String(form.getFieldState(field as keyof QuoteData).error?.message || ''),
    });
  }, [form, onReady]);

  return null;
}

async function flushFormUpdate(fn: () => void): Promise<void> {
  await act(async () => {
    fn();
    await Promise.resolve();
  });
}

describe('wizard step validation lifecycle', () => {
  it('shows step errors on Continue, clears date error immediately on valid change, and hides summary when last error is fixed', async () => {
    let api: HarnessApi | null = null;
    const initial = { ...createValidStep3Data(), renewalDate: '2000-01-01' };
    render(<Harness defaultValues={initial} onReady={(next) => { api = next; }} />);
    await waitFor(() => expect(api).toBeTruthy());

    await flushFormUpdate(() => api!.continueStep(2));
    expect(api!.fieldMessage('renewalDate')).toContain('Renewal date must be today or later');
    expect(api!.summaryFields()).toContain('renewalDate');

    await flushFormUpdate(() => api!.changeField(2, 'renewalDate', isoDateOffset(10)));
    expect(api!.fieldMessage('renewalDate')).toBe('');
    expect(api!.summaryFields()).not.toContain('renewalDate');
    expect(api!.summaryFields()).toEqual([]);
  });

  it('shows blur-time validation without spamming unrelated fields', async () => {
    let api: HarnessApi | null = null;
    const initial = { ...createValidStep3Data(), model: '' };
    render(<Harness defaultValues={initial} onReady={(next) => { api = next; }} />);
    await waitFor(() => expect(api).toBeTruthy());

    await flushFormUpdate(() => api!.blurField(2, 'model'));

    expect(api!.fieldMessage('model')).toContain('Please select vehicle model');
    expect(api!.summaryFields()).toContain('model');
    expect(api!.summaryFields()).not.toContain('engineSize');
  });

  it('clears conditional field errors when condition toggles off', async () => {
    let api: HarnessApi | null = null;
    const initial = { ...createValidStep3Data(), parking: 'Other', parkingOther: '' };
    render(<Harness defaultValues={initial} onReady={(next) => { api = next; }} />);
    await waitFor(() => expect(api).toBeTruthy());

    await flushFormUpdate(() => api!.continueStep(2));
    expect(api!.fieldMessage('parkingOther')).toContain('Please specify parking location');
    expect(api!.summaryFields()).toContain('parkingOther');

    await flushFormUpdate(() => api!.changeField(2, 'parking', 'Drive'));
    expect(api!.fieldMessage('parkingOther')).toBe('');
    expect(api!.summaryFields()).not.toContain('parkingOther');
  });

  it('clears select/grouped driving-history error immediately after correction', async () => {
    let api: HarnessApi | null = null;
    const initial = { ...createValidStep2Data(), licenseIssuedIn: '' };
    render(<Harness defaultValues={initial} onReady={(next) => { api = next; }} />);
    await waitFor(() => expect(api).toBeTruthy());

    await flushFormUpdate(() => api!.continueStep(3));
    expect(api!.fieldMessage('licenseIssuedIn')).toContain('Please select where your license was issued');

    await flushFormUpdate(() => api!.changeField(3, 'licenseIssuedIn', 'Cyprus'));
    expect(api!.fieldMessage('licenseIssuedIn')).toBe('');
  });

  it('revalidates programmatic setValue updates for previously invalid fields', async () => {
    let api: HarnessApi | null = null;
    const initial = { ...createValidStep3Data(), engineSize: 0 };
    render(<Harness defaultValues={initial} onReady={(next) => { api = next; }} />);
    await waitFor(() => expect(api).toBeTruthy());

    await flushFormUpdate(() => api!.continueStep(2));
    expect(api!.fieldMessage('engineSize')).toContain('Please enter engine size between 300 and 6000 cc');

    await flushFormUpdate(() => api!.changeField(2, 'engineSize', 1800));
    expect(api!.fieldMessage('engineSize')).toBe('');
  });

  it('clears nested additional-driver error immediately after correction', async () => {
    let api: HarnessApi | null = null;
    const initial: QuoteData = {
      ...createValidStep2Data(),
      additionalDrivers: [
        { firstName: '', lastName: 'Smith', dateOfBirth: '1992-02-02' },
      ],
    };
    render(<Harness defaultValues={initial} onReady={(next) => { api = next; }} />);
    await waitFor(() => expect(api).toBeTruthy());

    await flushFormUpdate(() => {
      api!.form.setError('additionalDrivers.0.firstName', {
        type: 'manual',
        message: 'First name is required',
      });
    });
    expect(api!.fieldMessage('additionalDrivers.0.firstName')).toContain('First name is required');

    await flushFormUpdate(() => api!.changeField(3, 'additionalDrivers.0.firstName', 'Jane'));
    expect(api!.fieldMessage('additionalDrivers.0.firstName')).toBe('');
    expect(api!.summaryFields()).not.toContain('additionalDrivers.0.firstName');
  });
});

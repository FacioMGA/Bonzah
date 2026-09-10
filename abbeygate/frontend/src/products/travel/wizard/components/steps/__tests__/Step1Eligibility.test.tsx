/* @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Step1Eligibility } from '../Step1Eligibility';

// Travel Step 1 — objective expat eligibility (ADR-0025).
// The wizard captures seven objective answers; the test pins the
// conditional rendering contract (otherNationality only when
// hasOtherNationality === true) which controls the customer's
// downstream eligibility path.

function Harness({ children, defaultValues }: { children: ReactNode; defaultValues?: Record<string, unknown> }) {
  const form = useForm({
    defaultValues: defaultValues ?? {
      eligibility: {
        countryOfResidence: '',
        nationality: '',
        hasOtherNationality: undefined,
        otherNationality: '',
        residenceDuration: '',
        willRemainResident: undefined,
        residencyStatus: '',
        legallyPermittedToReside: undefined,
        informationAccurate: false,
      },
    },
    mode: 'onBlur',
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe('Travel Step1Eligibility (ADR-0025)', () => {
  it('renders the section card title and the canonical seven questions', () => {
    render(<Harness><Step1Eligibility /></Harness>);
    expect(screen.queryAllByText(/Eligibility/i).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/current country of residence/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/^What is your nationality\?$/i)).toBeInTheDocument();
    expect(screen.getByText(/hold any other nationality/i)).toBeInTheDocument();
    expect(screen.queryAllByText(/residency status/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/legally permitted to reside/i)).toBeInTheDocument();
  });

  it('hides the otherNationality picker until the user answers YES to hasOtherNationality', () => {
    render(
      <Harness defaultValues={{ eligibility: { hasOtherNationality: false } }}>
        <Step1Eligibility />
      </Harness>,
    );
    expect(screen.queryByText(/select your other nationality/i)).toBeNull();
  });

  it('places declaration confirmations after the Lloyd\'s policy text (ABY-519)', () => {
    const { container } = render(<Harness><Step1Eligibility /></Harness>);
    const policyText = container.textContent || '';
    const accuracyIndex = policyText.indexOf('information provided is accurate');
    const lloydsIndex = policyText.indexOf('Lloyd\'s Insurance Company');
    const legalIndex = policyText.indexOf('Read, Understood And Agree');
    expect(lloydsIndex).toBeGreaterThan(-1);
    expect(accuracyIndex).toBeGreaterThan(lloydsIndex);
    expect(legalIndex).toBeGreaterThan(accuracyIndex);
  });

  it('reveals the otherNationality picker when hasOtherNationality === true', () => {
    render(
      <Harness defaultValues={{ eligibility: { hasOtherNationality: true } }}>
        <Step1Eligibility />
      </Harness>,
    );
    expect(screen.getByText(/select your other nationality/i)).toBeInTheDocument();
  });
});

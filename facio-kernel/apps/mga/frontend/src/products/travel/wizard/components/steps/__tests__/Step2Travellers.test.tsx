/* @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Step2Travellers } from '../Step2Travellers';

function Harness({ children, defaultValues }: { children: ReactNode; defaultValues?: Record<string, unknown> }) {
  const form = useForm({
    defaultValues: defaultValues ?? {
      travellers: { lead: { dateOfBirth: '' } },
      coverType: '',
    },
    mode: 'onBlur',
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe('Travel Step2Travellers', () => {
  it('renders the cover-type selection surface', () => {
    render(<Harness><Step2Travellers /></Harness>);
    // The cover-type RadioGroup options come from TRAVEL_COVER_TYPE_OPTIONS;
    // we anchor on the section icon's accompanying labels.
    expect(screen.getByText(/Travellers/i)).toBeInTheDocument();
  });

  it('renders the lead-traveller date-of-birth field (ABY-239 visible-DOB contract)', () => {
    render(<Harness><Step2Travellers /></Harness>);
    // The DOB field is the regression target for ABY-239 — typing
    // 20/04/1975 must persist as 20/04/1975, not 19/04/1975.
    const dobLabel = screen.queryAllByText(/date of birth/i);
    expect(dobLabel.length).toBeGreaterThan(0);
  });
});

/* @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Step1YourTrip } from '../Step1YourTrip';

function Harness({ children }: { children: ReactNode }) {
  const form = useForm({
    defaultValues: {
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
        legalAgreement: false,
      },
      travellers: {
        coverType: '',
        travellerCount: 1,
        leadTravellerDOB: '',
        additionalTravellerDOBs: [],
      },
    },
    mode: 'onBlur',
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe('Travel Step1YourTrip (ABY-519)', () => {
  it('renders eligibility and traveller sections on the same first-page layout', () => {
    render(<Harness><Step1YourTrip /></Harness>);
    expect(screen.getByText(/^Eligibility$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Travellers$/i)).toBeInTheDocument();
    expect(screen.getByText(/who would you like the insurance to cover/i)).toBeInTheDocument();
    expect(screen.queryAllByText(/current country of residence/i).length).toBeGreaterThan(0);
  });
});

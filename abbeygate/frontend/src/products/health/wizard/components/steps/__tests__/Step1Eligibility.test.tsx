/* @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Step1Eligibility } from '../Step1Eligibility';

const { getOperatingCountryNameMock } = vi.hoisted(() => ({
  getOperatingCountryNameMock: vi.fn<() => string | null>(),
}));

vi.mock('@/src/shared/lib/tenant/operatingCountry', () => ({
  getOperatingCountryName: getOperatingCountryNameMock,
}));

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
        informationAccurate: undefined,
        legalAgreement: false,
      },
    },
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe('Health Step1Eligibility residency declaration (ABY-361)', () => {
  beforeEach(() => {
    getOperatingCountryNameMock.mockReset();
  });

  it('refers to Portugal on the Portugal operating tenant', () => {
    getOperatingCountryNameMock.mockReturnValue('Portugal');

    render(<Harness><Step1Eligibility /></Harness>);

    expect(screen.getByText(/legally resident in Portugal/i)).toBeInTheDocument();
    expect(screen.getByText(/support of my immigration application in Portugal/i)).toBeInTheDocument();
    expect(screen.queryByText(/Republic of Cyprus/i)).toBeNull();
  });

  it('uses selected-country wording when no operating tenant country is known', () => {
    getOperatingCountryNameMock.mockReturnValue(null);

    render(<Harness><Step1Eligibility /></Harness>);

    expect(screen.getByText(/legally resident in the country selected above/i)).toBeInTheDocument();
    expect(screen.queryByText(/Republic of Cyprus/i)).toBeNull();
  });
});

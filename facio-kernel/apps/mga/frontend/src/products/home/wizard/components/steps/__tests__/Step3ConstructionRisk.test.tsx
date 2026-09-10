/* @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  HOME_NO_CLAIMS_DISCOUNT_LABEL,
  HOME_NO_CLAIMS_DISCOUNT_OPTIONS,
} from '@facio/products';
import { Step3ConstructionRisk } from '../Step3ConstructionRisk';

function Harness({ children }: { children: ReactNode }) {
  const form = useForm({
    defaultValues: {
      construction: { yearBuilt: '', noClaimsDiscount: '', previousClaims: '', increasedExcess: '' },
      risk: {},
      property: {},
      proposer: {},
    },
    mode: 'onBlur',
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe('Home Step3ConstructionRisk', () => {
  it('renders the construction + risk section', () => {
    render(<Harness><Step3ConstructionRisk /></Harness>);
    expect(screen.queryAllByText(/construction|risk/i).length).toBeGreaterThan(0);
  });

  it('renders ABY-487 years claim free label and caps options at 4 years', () => {
    const { container } = render(<Harness><Step3ConstructionRisk /></Harness>);

    expect(screen.getByText(HOME_NO_CLAIMS_DISCOUNT_LABEL)).toBeTruthy();

    const ncdSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.textContent === '4 years claim free'),
    );

    expect(ncdSelect).toBeTruthy();
    const optionLabels = Array.from(ncdSelect!.options)
      .map((option) => option.textContent?.trim())
      .filter((label) => label && label !== 'Select');

    expect(optionLabels).toEqual(HOME_NO_CLAIMS_DISCOUNT_OPTIONS.map((option) => option.label));
    expect(optionLabels).not.toContain('5+ years claim free');
  });
});

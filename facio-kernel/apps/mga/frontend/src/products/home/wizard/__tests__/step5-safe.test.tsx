/* @vitest-environment happy-dom */
/**
 * Section C — Step 5 must ask for a safe only when the customer insures
 * Specified High Risk Items (Beazley AB106 Safe Conditions). When they do,
 * the safe confirmation is shown; when a safe is confirmed, the safe-details
 * field is shown.
 */
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it } from 'vitest';
import { Step5Security } from '../components/steps/Step5Security';

function Harness({ defaults }: { defaults: Record<string, unknown> }) {
  const form = useForm<Record<string, unknown>>({ defaultValues: defaults, mode: 'onChange' });
  return (
    <FormProvider {...form}>
      <Step5Security />
    </FormProvider>
  );
}

describe('Step5Security — Section C safe', () => {
  it('does not show the safe question without specified high risk items', () => {
    render(<Harness defaults={{ coverage: { allRiskJewellery: 0, specifiedItems: [] }, security: {} }} />);
    expect(screen.queryByText(/safe at the premises for the specified high risk items/i)).toBeNull();
  });

  it('shows the safe confirmation when a high risk items amount is entered', () => {
    render(<Harness defaults={{ coverage: { allRiskJewellery: 5000 }, security: {} }} />);
    expect(screen.getByText(/safe at the premises for the specified high risk items/i)).toBeTruthy();
    // Safe details only appear once the safe is confirmed.
    expect(screen.queryByText(/Safe details/i)).toBeNull();
  });

  it('shows the safe-details field once a safe is confirmed', () => {
    render(
      <Harness
        defaults={{
          coverage: { specifiedItems: [{ description: 'Ring', sumInsured: 2000 }] },
          security: { safeOnPremises: true },
        }}
      />,
    );
    expect(screen.getByText(/Safe details/i)).toBeTruthy();
  });
});

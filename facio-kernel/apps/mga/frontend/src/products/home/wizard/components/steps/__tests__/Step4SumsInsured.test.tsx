/* @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { FieldValues } from 'react-hook-form';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Step4SumsInsured } from '../Step4SumsInsured';

// Pin the host-derived operating tenant to Portugal so the holiday-home
// domicile rule is exercised deterministically.
vi.mock('@/src/shared/lib/tenant/operatingCountry', () => ({
  getOperatingCountryFromHost: () => 'PT',
  getOperatingCountryName: () => 'Portugal',
}));

function Harness({ children, defaultValues }: { children: ReactNode; defaultValues?: FieldValues }) {
  const form = useForm({
    defaultValues: defaultValues ?? {
      coverage: { specifiedItems: [] },
      usage: {},
    },
    mode: 'onBlur',
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe('Home Step4SumsInsured', () => {
  it('renders the sums-insured section card', () => {
    render(<Harness><Step4SumsInsured /></Harness>);
    expect(screen.queryAllByText(/sums insured|buildings|contents/i).length).toBeGreaterThan(0);
  });

  it('locks usage.permanentHome to holiday home when domiciled outside the operating country', () => {
    render(
      <Harness defaultValues={{ coverage: { specifiedItems: [] }, usage: {}, proposer: { domicileCountry: 'United Kingdom' } }}>
        <Step4SumsInsured />
      </Harness>,
    );
    expect(screen.getByText('Holiday home')).toBeInTheDocument();
    expect(screen.getByText(/holiday home only/i)).toBeInTheDocument();
  });

  it('shows the normal use-of-property choice for a resident proposer', () => {
    render(
      <Harness defaultValues={{ coverage: { specifiedItems: [] }, usage: {}, proposer: { domicileCountry: 'Portugal' } }}>
        <Step4SumsInsured />
      </Harness>,
    );
    expect(screen.queryByText(/holiday home only/i)).toBeNull();
  });

  it('hides accidental damage and high-risk cover when the property is a holiday home', () => {
    render(
      <Harness defaultValues={{
        coverage: { specifiedItems: [], accidentalDamageBuildings: true, accidentalDamageContents: true },
        usage: { permanentHome: false },
      }}>
        <Step4SumsInsured />
      </Harness>,
    );
    expect(screen.queryByText('Accidental damage')).toBeNull();
    expect(screen.queryByLabelText(/accidental damage for buildings/i)).toBeNull();
    expect(screen.queryByText(/High Risk Items \(e\.g\./i)).toBeNull();
    expect(screen.queryByText('All Risks Unspecified')).toBeNull();
    expect(screen.queryByText('List high risk items')).toBeNull();
    expect(screen.getByText('Solar panel cover')).toBeInTheDocument();
  });

  it('shows accidental damage and high-risk cover for a permanent home', () => {
    render(
      <Harness defaultValues={{
        coverage: { specifiedItems: [] },
        usage: { permanentHome: true },
      }}>
        <Step4SumsInsured />
      </Harness>,
    );
    expect(screen.getByText('Accidental damage')).toBeInTheDocument();
    expect(screen.getByText(/High Risk Items \(e\.g\./i)).toBeInTheDocument();
    expect(screen.getByText('All Risks Unspecified')).toBeInTheDocument();
    expect(screen.getByText('List high risk items')).toBeInTheDocument();
  });
});

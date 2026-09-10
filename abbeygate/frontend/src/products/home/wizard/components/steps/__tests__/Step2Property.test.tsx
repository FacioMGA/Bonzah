/* @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Step2Property } from '../Step2Property';

vi.mock('@/src/shared/components/AddressAutocomplete', () => ({
  default: () => <div data-testid="address-autocomplete-stub" />,
}));

// Operating tenant is host-derived; pin it to Portugal so the holiday-home
// domicile rule is exercised deterministically (happy-dom host is localhost).
vi.mock('@/src/shared/lib/tenant/operatingCountry', () => ({
  getOperatingCountryFromHost: () => 'PT',
  getOperatingCountryName: () => 'Portugal',
}));

function Harness({ children, defaultValues }: { children: ReactNode; defaultValues?: Record<string, unknown> }) {
  const form = useForm({
    defaultValues: defaultValues ?? {
      property: { sameAsProposer: undefined, address: {}, propertyType: '' },
    },
    mode: 'onBlur',
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe('Home Step2Property', () => {
  it('renders the property section card', () => {
    render(<Harness><Step2Property /></Harness>);
    expect(screen.queryAllByText(/property/i).length).toBeGreaterThan(0);
  });

  it('shows the address autocomplete when the property address differs from the proposer', () => {
    render(
      <Harness defaultValues={{ property: { sameAsProposer: false, address: {}, propertyType: '' } }}>
        <Step2Property />
      </Harness>,
    );
    expect(screen.getByTestId('address-autocomplete-stub')).toBeInTheDocument();
  });

  it('locks the property to a holiday home when domiciled outside the operating country', () => {
    render(
      <Harness defaultValues={{ proposer: { domicileCountry: 'United Kingdom' }, property: { address: {}, propertyType: '' } }}>
        <Step2Property />
      </Harness>,
    );
    // The Yes/No "Permanent Home" picker is replaced by a locked notice.
    expect(screen.getByText('Holiday home')).toBeInTheDocument();
    expect(screen.getByText(/can only be insured as a holiday home/i)).toBeInTheDocument();
  });

  it('allows the normal permanent/holiday choice for a resident proposer', () => {
    render(
      <Harness defaultValues={{ proposer: { domicileCountry: 'Portugal' }, property: { address: {}, propertyType: '' } }}>
        <Step2Property />
      </Harness>,
    );
    expect(screen.queryByText(/can only be insured as a holiday home/i)).toBeNull();
    expect(screen.getByText('Property use')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Permanent home' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Holiday home' })).toBeInTheDocument();
  });

  it('renders bedrooms as a dropdown for the full canonical range', () => {
    render(<Harness><Step2Property /></Harness>);

    const bedrooms = screen.getByRole('combobox', { name: 'Bedrooms' });
    expect(bedrooms).toHaveValue('');
    expect(screen.getAllByRole('option').map((option) => option.getAttribute('value')))
      .toEqual(expect.arrayContaining(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '20']));
    expect(screen.queryByRole('option', { name: '21' })).toBeNull();
  });

  it('labels floor area as covered area', () => {
    render(<Harness><Step2Property /></Harness>);

    expect(screen.getByText('Covered area (sqm)')).toBeInTheDocument();
    expect(screen.queryByText('Floor area (sqm)')).toBeNull();
  });
});

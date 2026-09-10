/* @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TravelQuoteSidebar } from '../../TravelQuoteSidebar';
import { Step4PlanPicker } from '../Step4PlanPicker';
import { Step6DetailsAndDeclarations } from '../Step6DetailsAndDeclarations';

beforeEach(() => {
  vi.stubEnv('VITE_DEFAULT_REGION_CODE', undefined);
  vi.stubEnv('VITE_DEFAULT_COUNTRY', undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function Harness({ children }: { children: ReactNode }) {
  const form = useForm({ defaultValues: {
    trip: { planType: 'annual_multi_trip', countryOfResidence: 'Spain', destinations: ['europe'], startDate: '2026-09-10', endDate: '2027-09-09' },
    travellers: { coverType: 'single', leadTravellerDOB: '1990-01-01' },
    quote: { selectedPlan: 'silver' },
    proposer: { address: { country: 'Spain' } },
    declarations: {},
    addons: {},
  } });
  return <FormProvider {...form}>{children}</FormProvider>;
}

const surfaces = [
  { name: 'sidebar', render: () => <TravelQuoteSidebar areaLabel="Europe" planType="annual_multi_trip" coverLevelLabel="Silver" coveringLabel="Single" startDate="10/09/2026" endDate="09/09/2027" showDocs showContact={false} /> },
  { name: 'plan picker', render: () => <Step4PlanPicker loading={false} quoteResponse={{ status: 'QUOTED', planOptions: { silver: { premium: 100, breakdown: {} }, gold: { premium: 150, breakdown: {} }, platinum: { premium: 200, breakdown: {} } } }} onRate={vi.fn()} /> },
  { name: 'declarations', render: () => <Step6DetailsAndDeclarations quoteResponse={null} /> },
];

describe.each(surfaces)('Travel Terms of Business in $name', (surface) => {
  it.each([
    ['cy.abbeygate.com', 'cyprus/terms/TermsAndConditionsCyprus.pdf'],
    ['gr.abbeygate.com', 'greece/terms/TermsAndConditionsGreece.pdf'],
    ['pt.abbeygate.com', 'portugal/terms/TermsAndConditionsPortugal.pdf'],
    ['cy.staging.abbeygate.com', 'cyprus/terms/TermsAndConditionsCyprus.pdf'],
    ['gr.staging.abbeygate.com', 'greece/terms/TermsAndConditionsGreece.pdf'],
    ['pt.staging.abbeygate.com', 'portugal/terms/TermsAndConditionsPortugal.pdf'],
    ['abbeygate-cy.facio.io', 'cyprus/terms/TermsAndConditionsCyprus.pdf'],
    ['abbeygate-gr.facio.io', 'greece/terms/TermsAndConditionsGreece.pdf'],
    ['abbeygate-pt.facio.io', 'portugal/terms/TermsAndConditionsPortugal.pdf'],
  ])('resolves the actual %s browser host despite Spain residence', (hostname, path) => {
    vi.spyOn(window.location, 'hostname', 'get').mockReturnValue(hostname);
    render(<Harness>{surface.render()}</Harness>);
    const links = screen.getAllByRole('link', { name: 'Terms of Business' });
    for (const link of links) {
      expect(link).toHaveAttribute('href', `https://www.abbeygate.com/assets/policies/${path}`);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it.each(['abbeygate-es.facio.io', 'unknown.example.invalid', 'localhost'])('omits %s terms when no approved tenant is resolved and build defaults are unset', (hostname) => {
    vi.spyOn(window.location, 'hostname', 'get').mockReturnValue(hostname);
    render(<Harness>{surface.render()}</Harness>);
    expect(screen.queryByRole('link', { name: /Terms of Business|TOBA/ })).not.toBeInTheDocument();
  });
});

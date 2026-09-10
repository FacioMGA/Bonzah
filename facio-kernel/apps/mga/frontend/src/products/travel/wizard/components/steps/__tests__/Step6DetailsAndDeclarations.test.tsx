/* @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Step6DetailsAndDeclarations } from '../Step6DetailsAndDeclarations';

function Harness({
  defaultValues,
  children,
}: {
  defaultValues: Record<string, unknown>;
  children: ReactNode;
}) {
  const form = useForm({ defaultValues, mode: 'onBlur', shouldUnregister: false });
  return <FormProvider {...form}>{children}</FormProvider>;
}

const baseDefaults = {
  trip: { planType: 'single_trip', destinations: ['Greece'], startDate: '2026-06-01', endDate: '2026-06-15' },
  travellers: { coverType: 'single', leadTravellerDOB: '1990-01-01' },
  quote: { selectedPlan: 'silver' },
  addons: {},
  proposer: {
    firstName: '',
    lastName: '',
    email: '',
    confirmEmail: '',
    phone: '',
    idType: '',
    idNumber: '',
    address: { line1: '', line2: '', city: '', province: '', postcode: '', country: '' },
    marketingConsent: '',
    feedbackConsent: '',
  },
  declarations: {
    medicalNotice: false,
    howToClaimReview: false,
    personalDataConsent: false,
    contractConsent: false,
  },
};

describe('Travel Step6 — shared-primitive convergence (Phase 6i + 6j)', () => {
  it('renders the four declaration checkboxes via the shared Checkbox primitive', () => {
    const { container } = render(
      <Harness defaultValues={baseDefaults}>
        <Step6DetailsAndDeclarations quoteResponse={null} />
      </Harness>,
    );

    const required = [
      'declarations.medicalNotice',
      'declarations.howToClaimReview',
      'declarations.personalDataConsent',
      'declarations.contractConsent',
    ];
    for (const name of required) {
      const node = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      expect(node, `expected ${name} to be rendered as a checkbox`).not.toBeNull();
      expect(node?.type).toBe('checkbox');
    }
  });

  it('renders contact-preferences yes/no choices via the shared RadioGroup', () => {
    const { container } = render(
      <Harness defaultValues={baseDefaults}>
        <Step6DetailsAndDeclarations quoteResponse={null} />
      </Harness>,
    );

    const marketingRadios = container.querySelectorAll<HTMLInputElement>(
      'input[type="radio"][name="proposer.marketingConsent"]',
    );
    const feedbackRadios = container.querySelectorAll<HTMLInputElement>(
      'input[type="radio"][name="proposer.feedbackConsent"]',
    );
    expect(marketingRadios.length).toBe(2);
    expect(feedbackRadios.length).toBe(2);

    const marketingValues = Array.from(marketingRadios).map((r) => r.value).sort();
    expect(marketingValues).toEqual(['false', 'true']);
  });

  it('renders the personal-details + address fields through shared FormField/Input primitives', () => {
    const { container } = render(
      <Harness defaultValues={baseDefaults}>
        <Step6DetailsAndDeclarations quoteResponse={null} />
      </Harness>,
    );

    expect(container.querySelector('input[name="proposer.firstName"]')).not.toBeNull();
    expect(container.querySelector('input[name="proposer.lastName"]')).not.toBeNull();
    expect(container.querySelector('input[name="proposer.email"]')).not.toBeNull();
    expect(container.querySelector('input[name="proposer.address.line2"]')).not.toBeNull();
    expect(container.querySelector('select[name="proposer.idType"]')).not.toBeNull();
  });

  it('renders the SectionCard chrome via the shared PolicyHolderStep mount', () => {
    render(
      <Harness defaultValues={baseDefaults}>
        <Step6DetailsAndDeclarations quoteResponse={null} />
      </Harness>,
    );
    expect(screen.getByText('Your Demands and Needs')).toBeInTheDocument();
    expect(screen.getByText('Very Important Notice')).toBeInTheDocument();
    // ABY-65: the empty "Your Details" section card was removed because
    // it duplicated the PolicyHolderStep's own "Personal Details" header.
    // The lead-traveller DOB reminder now renders inline beneath the
    // PolicyHolderStep mount, not in its own card.
    expect(screen.queryByText('Your Details')).toBeNull();
    expect(screen.getByText(/Lead traveller's date of birth/)).toBeInTheDocument();
    // PolicyHolderStep renders these section titles (Phase 6j).
    expect(screen.getByText('Personal Details')).toBeInTheDocument();
    expect(screen.getByText('Contact Information')).toBeInTheDocument();
    expect(screen.getByText('Identification')).toBeInTheDocument();
    expect(screen.getByText('Your Contact Preferences')).toBeInTheDocument();
    expect(screen.getByText('Declaration')).toBeInTheDocument();
  });

  it('does not render any inline DeclCheckbox / YesNoRadio adapters', () => {
    const moduleSource = Step6DetailsAndDeclarations.toString();
    expect(moduleSource).not.toContain('DeclCheckbox');
    expect(moduleSource).not.toContain('YesNoRadio');
  });

  it('does not render inline personal-details inputs (proposer.* fields are owned by PolicyHolderStep)', () => {
    const { container } = render(
      <Harness defaultValues={baseDefaults}>
        <Step6DetailsAndDeclarations quoteResponse={null} />
      </Harness>,
    );
    // The <PolicyHolderStep /> mount registers proposer.firstName etc.; the
    // inline JSX that previously duplicated them must be gone.
    const personalDetailsHeading = screen.getByText('Personal Details');
    expect(personalDetailsHeading).toBeInTheDocument();
    expect(container.querySelector('input[name="proposer.idNumber"]')).not.toBeNull();
  });

  it('displays the lead traveller DOB in UK DD/MM/YYYY without timezone drift (ABY-239)', () => {
    // 1975-04-20 stored as ISO date-only used to render as
    // `19/04/1975` for any user west of UTC because Step6 had its
    // own naive `new Date(iso) + toLocaleDateString('en-GB')`
    // formatter. The shared formatter in
    // `../../formatTravelDateForDisplay` splits the literal ISO
    // string so the displayed day matches the stored day.
    render(
      <Harness
        defaultValues={{
          ...baseDefaults,
          travellers: { coverType: 'single', leadTravellerDOB: '1975-04-20' },
        }}
      >
        <Step6DetailsAndDeclarations quoteResponse={null} />
      </Harness>,
    );

    expect(screen.getByText(/20\/04\/1975/)).toBeInTheDocument();
    expect(screen.queryByText(/19\/04\/1975/)).toBeNull();
  });

  it('displays additional traveller DOBs in UK DD/MM/YYYY without timezone drift (ABY-239)', () => {
    render(
      <Harness
        defaultValues={{
          ...baseDefaults,
          travellers: {
            coverType: 'couple',
            travellerCount: 2,
            leadTravellerDOB: '1975-04-20',
            additionalTravellerDOBs: ['1988-06-20'],
            additionalTravellers: [{}],
          },
        }}
      >
        <Step6DetailsAndDeclarations quoteResponse={null} />
      </Harness>,
    );

    expect(screen.getByText(/Traveller 2 — DOB 20\/06\/1988/)).toBeInTheDocument();
  });

  it('renders selected addons with prices from the canonical breakdown.lines (ABY-264)', () => {
    // ABY-264 — sidebar now reads `quoteResponse.primaryOption.breakdown.lines`
    // (the canonical TravelBreakdownLine[] emitted by the rate
    // calculator). One line per addon, in catalogue order, plus a
    // dedicated admin-fee line and a total line. Every consumer of the
    // travel breakdown reads this same shape, so labels and amounts
    // never drift between the wizard, the BO Premium tab and the PDF.
    const gadgetOnlyQuote: Record<string, unknown> = {
      status: 'QUOTED',
      primaryOption: {
        annualPremium: 123.75,
        breakdown: {
          adminFee: 5,
          lines: [
            { code: 'base', label: 'Base premium', amount: 100, kind: 'base' },
            { code: 'addon.gadget', label: 'Gadget', amount: 18.75, kind: 'addon' },
            { code: 'fee.admin', label: 'Admin fee', amount: 5, kind: 'fee' },
            { code: 'total', label: 'Total', amount: 123.75, kind: 'total' },
          ],
        },
      },
    };
    render(
      <Harness
        defaultValues={{
          ...baseDefaults,
          addons: { gadget: true },
        }}
      >
        <Step6DetailsAndDeclarations quoteResponse={gadgetOnlyQuote} />
      </Harness>,
    );

    expect(screen.getAllByText('Gadget').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/€18\.75/).length).toBeGreaterThan(0);
  });

  it('renders multiple selected addons with prices in canonical catalogue order', () => {
    const multiAddonQuote: Record<string, unknown> = {
      status: 'QUOTED',
      primaryOption: {
        annualPremium: 164.25,
        breakdown: {
          adminFee: 5,
          lines: [
            { code: 'base', label: 'Base premium', amount: 95, kind: 'base' },
            { code: 'addon.winterSports', label: 'Winter Sports', amount: 20.0, kind: 'addon' },
            { code: 'addon.businessCover', label: 'Business Cover', amount: 25.5, kind: 'addon' },
            { code: 'addon.gadget', label: 'Gadget', amount: 18.75, kind: 'addon' },
            { code: 'fee.admin', label: 'Admin fee', amount: 5, kind: 'fee' },
            { code: 'total', label: 'Total', amount: 164.25, kind: 'total' },
          ],
        },
      },
    };
    render(
      <Harness
        defaultValues={{
          ...baseDefaults,
          addons: { gadget: true, winterSports: true, businessCover: true },
        }}
      >
        <Step6DetailsAndDeclarations quoteResponse={multiAddonQuote} />
      </Harness>,
    );

    expect(screen.getAllByText('Winter Sports').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Business Cover').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Gadget').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/€20\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/€25\.50/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/€18\.75/).length).toBeGreaterThan(0);
  });

  it('renders an explicit "Admin fee" line on every step (ABY-264 — reverses ABY-246)', () => {
    // ABY-264 — the client confirmed that surfacing admin fee only on
    // the payment step was the root cause of customer confusion ("the
    // math doesn't add up"). The sidebar must show base → addons →
    // admin fee → total on every step, identical to the payment step.
    // This intentionally inverts the earlier ABY-246 decision; the
    // calculator's `breakdown.lines` is the single source of truth and
    // includes a dedicated `fee.admin` line, so consumers do NOT need
    // to filter it out.
    const quoteWithFee: Record<string, unknown> = {
      status: 'QUOTED',
      primaryOption: {
        annualPremium: 51.42,
        breakdown: {
          adminFee: 7,
          lines: [
            { code: 'base', label: 'Base premium', amount: 24.42, kind: 'base' },
            { code: 'addon.wedding', label: 'Wedding', amount: 20, kind: 'addon' },
            { code: 'fee.admin', label: 'Admin fee', amount: 7, kind: 'fee' },
            { code: 'total', label: 'Total', amount: 51.42, kind: 'total' },
          ],
        },
      },
    };
    render(
      <Harness
        defaultValues={{
          ...baseDefaults,
          addons: { wedding: true },
        }}
      >
        <Step6DetailsAndDeclarations quoteResponse={quoteWithFee} />
      </Harness>,
    );

    // Both desktop and mobile sidebar render the admin-fee line.
    expect(screen.getAllByText(/Admin fee/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/€7\.00/).length).toBeGreaterThan(0);
  });

  it('renders Total === breakdown.lines total + base + addon + admin fee identity (ABY-264)', () => {
    // The customer reconciliation everyone reads — same identity
    // shown on every step, the payment step, the BO Premium tab and
    // the PDF schedule:
    //   base + addons (sum) + tax + admin fee === total
    //   24.42 + 20.00 + 0 + 7.00              === 51.42
    const quoteRated: Record<string, unknown> = {
      status: 'QUOTED',
      primaryOption: {
        annualPremium: 51.42,
        breakdown: {
          adminFee: 7,
          lines: [
            { code: 'base', label: 'Base premium', amount: 24.42, kind: 'base' },
            { code: 'addon.wedding', label: 'Wedding', amount: 20, kind: 'addon' },
            { code: 'fee.admin', label: 'Admin fee', amount: 7, kind: 'fee' },
            { code: 'total', label: 'Total', amount: 51.42, kind: 'total' },
          ],
        },
      },
    };
    render(
      <Harness
        defaultValues={{
          ...baseDefaults,
          addons: { wedding: true },
        }}
      >
        <Step6DetailsAndDeclarations quoteResponse={quoteRated} />
      </Harness>,
    );

    expect(screen.getAllByText(/€24\.42/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/€20\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/€7\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/€51\.42/).length).toBeGreaterThan(0);
  });

  it('renders additional traveller identity fields before payment', () => {
    const { container } = render(
      <Harness
        defaultValues={{
          ...baseDefaults,
          travellers: {
            coverType: 'couple',
            travellerCount: 2,
            leadTravellerDOB: '1990-01-01',
            additionalTravellerDOBs: ['1992-02-02'],
            additionalTravellers: [{}],
          },
        }}
      >
        <Step6DetailsAndDeclarations quoteResponse={null} />
      </Harness>,
    );

    expect(screen.getByText(/Traveller 2/)).toBeInTheDocument();
    expect(container.querySelector('input[name="travellers.additionalTravellers.0.firstName"]')).not.toBeNull();
    expect(container.querySelector('input[name="travellers.additionalTravellers.0.lastName"]')).not.toBeNull();
    expect(container.querySelector('select[name="travellers.additionalTravellers.0.idType"]')).not.toBeNull();
    expect(container.querySelector('input[name="travellers.additionalTravellers.0.idNumber"]')).not.toBeNull();
  });
});

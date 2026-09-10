/* @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Step5Options } from '../Step5Options';

// Travel Step 5 — addon picker (ABY-241/242). The sidebar is
// production UI but is exercised separately; we stub it so this test
// stays a focused contract on the addon-card surface.
vi.mock('../../TravelQuoteSidebar', () => ({
  TravelQuoteSidebar: () => <aside data-testid="travel-quote-sidebar-stub" />,
}));

function Harness({ children, addons }: { children: ReactNode; addons?: Record<string, boolean> }) {
  const form = useForm({
    defaultValues: {
      addons: addons ?? {},
      trip: { planType: 'single_trip', destinations: ['Spain'], startDate: '2026-06-01', endDate: '2026-06-15' },
      travellers: { coverType: 'single' },
      quote: { selectedPlan: 'silver' },
    },
    mode: 'onBlur',
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe('Travel Step5Options', () => {
  it('renders the section card title and at least one addon card', () => {
    render(<Harness><Step5Options quoteResponse={null} /></Harness>);
    // SectionCard renders the addon picker chrome.
    expect(screen.queryAllByText(/options|enhance|add/i).length).toBeGreaterThan(0);
  });

  it('shows the selected state on an addon when its key is true in form values', () => {
    render(
      <Harness addons={{ winterSports: true }}>
        <Step5Options quoteResponse={null} />
      </Harness>,
    );
    // Pre-selected addons display "Added" on their toggle button
    // (canonical addon keys come from travelAddons.ts).
    const added = screen.queryAllByText(/added/i);
    expect(added.length).toBeGreaterThan(0);
  });

  it('shows net addon price with "(plus tax)" when quoteResponse.addonPrices is present', () => {
    render(
      <Harness>
        <Step5Options quoteResponse={{ addonPrices: { golfCover: 10 } }} />
      </Harness>,
    );
    expect(screen.getByText(/\+€10\.00 \(plus tax\)/i)).toBeTruthy();
  });

  it('does not show "(plus tax)" when addon price is missing from quoteResponse', () => {
    render(
      <Harness>
        <Step5Options quoteResponse={null} />
      </Harness>,
    );
    expect(screen.queryByText(/\(plus tax\)/i)).toBeNull();
  });
});

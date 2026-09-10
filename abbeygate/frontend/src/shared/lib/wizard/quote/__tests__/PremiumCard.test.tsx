/* @vitest-environment happy-dom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PremiumCard } from '../PremiumCard';
import type { QuoteHeroHeaderVariants } from '../QuoteHeroHeader';

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => (props: Record<string, unknown>) => {
      const { children, ...rest } = props as { children?: React.ReactNode };
      void rest;
      return <div>{children}</div>;
    },
  }),
}));

const variants: QuoteHeroHeaderVariants = {
  hidden: { opacity: 0, y: 0 },
  visible: () => ({ opacity: 1, y: 0 }),
};

describe('PremiumCard', () => {
  it('renders the formatted annual premium and inclusions', () => {
    render(
      <PremiumCard
        variants={variants}
        title="Comprehensive Coverage"
        annualPremium={870}
        currency="EUR"
        inclusions={[{ label: 'Comprehensive Protection' }, { label: 'Legal Liability & Assistance' }]}
        actions={{ primaryLabel: 'Secure this price', onPrimary: () => undefined }}
      />,
    );

    expect(screen.getByText('Comprehensive Coverage')).toBeTruthy();
    expect(screen.getByText('€870.00')).toBeTruthy();
    expect(screen.getByText('Comprehensive Protection')).toBeTruthy();
    expect(screen.getByText('Legal Liability & Assistance')).toBeTruthy();
  });

  it('invokes the primary action on click', () => {
    const onPrimary = vi.fn();
    render(
      <PremiumCard
        variants={variants}
        title="Comprehensive Coverage"
        annualPremium={1000}
        currency="EUR"
        inclusions={[{ label: 'Cover' }]}
        actions={{ primaryLabel: 'Secure this price', onPrimary }}
      />,
    );

    fireEvent.click(screen.getByText('Secure this price'));
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });
});

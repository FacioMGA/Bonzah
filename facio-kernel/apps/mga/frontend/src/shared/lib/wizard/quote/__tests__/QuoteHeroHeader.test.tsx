/* @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuoteHeroHeader, type QuoteHeroHeaderVariants } from '../QuoteHeroHeader';

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

describe('QuoteHeroHeader', () => {
  it('renders eyebrow, headline and subline', () => {
    render(
      <QuoteHeroHeader
        eyebrow="Online Quote Ready"
        headline="Your Motor Insurance Quote"
        subline="Tailored cover for your Mazda CX-5"
        statusLabel="Active"
        variants={variants}
      />,
    );

    expect(screen.getByText('Online Quote Ready')).toBeTruthy();
    expect(screen.getByText('Your Motor Insurance Quote')).toBeTruthy();
    expect(screen.getByText('Tailored cover for your Mazda CX-5')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('hides the status chip when statusLabel is omitted', () => {
    render(
      <QuoteHeroHeader
        eyebrow="Your home is covered"
        headline="Your Home Insurance Quote"
        subline="Tailored protection for your home in Limassol"
        variants={variants}
      />,
    );

    expect(screen.queryByText('Status')).toBeNull();
  });
});

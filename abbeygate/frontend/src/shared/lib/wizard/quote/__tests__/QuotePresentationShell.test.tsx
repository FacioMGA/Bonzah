/* @vitest-environment happy-dom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuotePresentationShell } from '../QuotePresentationShell';

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => ({ children }: { children?: React.ReactNode }) => {
      return <div>{children}</div>;
    },
  }),
}));

const baseProps = {
  quoteResponse: { reference: 'AQ-123', status: 'referral' },
  hero: { eyebrow: 'Motor', headline: 'Quote', subline: 'Test' },
  background: { from: '#fff', via: '#fff', to: '#fff' },
  slots: { primary: <div>Primary quote content</div> },
};

describe('QuotePresentationShell referral slot', () => {
  it('renders product-owned, non-bindable referral information', () => {
    render(
      <QuotePresentationShell
        {...baseProps}
        slots={{
          ...baseProps.slots,
          referral: <div>Indicative annual premium €1,234.00</div>,
        }}
      />,
    );

    expect(screen.getByText('Indicative annual premium €1,234.00')).toBeTruthy();
    expect(screen.queryByText('Primary quote content')).toBeNull();
  });

  it('does not invent referral content when a product does not opt in', () => {
    render(<QuotePresentationShell {...baseProps} />);

    expect(screen.queryByText(/indicative annual premium/i)).toBeNull();
  });
});

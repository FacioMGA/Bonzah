/* @vitest-environment happy-dom */
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuoteSuccessCelebration } from '../QuoteSuccessCelebration';

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => (props: Record<string, unknown>) => {
      const { children, ...rest } = props as { children?: React.ReactNode };
      void rest;
      return <div data-celebration-particle="">{children}</div>;
    },
  }),
}));

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
});

describe('QuoteSuccessCelebration', () => {
  it('renders nothing when variant is "none"', () => {
    const { container } = render(
      <QuoteSuccessCelebration variant="none" triggerKey="ABC123" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders confetti particles for the "confetti" variant on first trigger', () => {
    const { container } = render(
      <QuoteSuccessCelebration variant="confetti" triggerKey="ABC123" />,
    );
    expect(container.querySelectorAll('[data-celebration-particle]').length).toBeGreaterThan(0);
  });

  it('does not re-fire for the same triggerKey within the same session', () => {
    const first = render(
      <QuoteSuccessCelebration variant="confetti" triggerKey="ABC123" />,
    );
    expect(first.container.querySelectorAll('[data-celebration-particle]').length).toBeGreaterThan(0);
    first.unmount();

    const second = render(
      <QuoteSuccessCelebration variant="confetti" triggerKey="ABC123" />,
    );
    expect(second.container.firstChild).toBeNull();
  });
});

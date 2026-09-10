/* @vitest-environment happy-dom */
import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QuoteLoadingGate } from '../QuoteLoadingGate';

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => (props: Record<string, unknown>) => {
      const { children, ...rest } = props as { children?: React.ReactNode };
      void rest;
      return <div>{children}</div>;
    },
  }),
}));

describe('QuoteLoadingGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reveals immediately when minDelayMs is 0 and ready is true (Home flow)', () => {
    render(
      <QuoteLoadingGate
        triggerKey="home-quote-1"
        ready={true}
        minDelayMs={0}
        title="Calculating…"
      >
        <div>QUOTE_BODY</div>
      </QuoteLoadingGate>,
    );

    // First render must skip the loader entirely — Home rates upstream so
    // there's no need to flash a 3s loader on the quote step.
    expect(screen.getByText('QUOTE_BODY')).toBeTruthy();
    expect(screen.queryByText('Calculating…')).toBeNull();
  });

  it('holds back children until min delay elapses (Motor flow)', () => {
    render(
      <QuoteLoadingGate
        triggerKey="motor-quote-1"
        ready={true}
        minDelayMs={3000}
        title="Calculating your quote…"
      >
        <div>QUOTE_BODY</div>
      </QuoteLoadingGate>,
    );

    expect(screen.getByText('Calculating your quote…')).toBeTruthy();
    expect(screen.queryByText('QUOTE_BODY')).toBeNull();

    act(() => { vi.advanceTimersByTime(3000); });

    expect(screen.getByText('QUOTE_BODY')).toBeTruthy();
  });

  it('keeps the loader while ready is false even after min delay', () => {
    render(
      <QuoteLoadingGate
        triggerKey="motor-rate-1"
        ready={false}
        minDelayMs={3000}
        title="Calculating…"
      >
        <div>QUOTE_BODY</div>
      </QuoteLoadingGate>,
    );

    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByText('QUOTE_BODY')).toBeNull();
  });
});

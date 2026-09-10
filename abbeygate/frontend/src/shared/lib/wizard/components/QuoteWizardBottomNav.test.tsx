/* @vitest-environment happy-dom */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuoteWizardBottomNav } from './QuoteWizardBottomNav';

function renderNav(overrides: Partial<Parameters<typeof QuoteWizardBottomNav>[0]> = {}) {
  const onNext = vi.fn();
  const onBack = vi.fn();
  render(
    <QuoteWizardBottomNav
      canBack
      canNext
      hoverNav={null}
      isSubmitting={false}
      onHoverNavChange={vi.fn()}
      onBack={onBack}
      onNext={onNext}
      nextLabel="Submit request"
      {...overrides}
    />,
  );
  return { onBack, onNext };
}

describe('QuoteWizardBottomNav', () => {
  it('keeps the primary action visible but disabled when nextDisabled is set', () => {
    const { onNext } = renderNav({ nextDisabled: true });
    const button = screen.getByRole('button', { name: /submit request/i });

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onNext).not.toHaveBeenCalled();
  });
});

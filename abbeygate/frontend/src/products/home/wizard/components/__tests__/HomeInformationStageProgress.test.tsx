/* @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomeInformationStageProgress } from '../HomeInformationStageProgress';

describe('HomeInformationStageProgress', () => {
  it('keeps the five short sections visible inside the first customer journey stage', () => {
    render(<HomeInformationStageProgress currentStepId="construction-risk" />);

    expect(screen.getByText('Construction — 3 of 5')).toBeVisible();
    expect(screen.getByText('Your details')).toBeVisible();
    expect(screen.getByText('Property')).toBeVisible();
    expect(screen.getByText('Construction')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Sums insured')).toBeVisible();
    expect(screen.getByText('Security')).toBeVisible();
  });

  it('does not render outside the information stage', () => {
    const { container } = render(<HomeInformationStageProgress currentStepId="your-quote" />);
    expect(container).toBeEmptyDOMElement();
  });
});

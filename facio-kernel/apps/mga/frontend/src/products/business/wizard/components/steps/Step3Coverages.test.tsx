/* @vitest-environment happy-dom */

import { fireEvent, render } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Step3Coverages } from './Step3Coverages';

function Harness({ children }: { children: ReactNode }) {
  const form = useForm({
    defaultValues: {
      coverage: {
        publicLiability: 'yes',
        publicLiabilityLimit: 900000,
        employersLiability: '',
        businessInterruption: '',
        legalAssistance: '',
      },
    },
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

function inputFor(container: HTMLElement, field: string): HTMLInputElement {
  const node = container.querySelector(`[data-field="${field}"] input`);
  if (!(node instanceof HTMLInputElement)) throw new Error(`Missing input for ${field}`);
  return node;
}

describe('Step3Coverages', () => {
  it('formats EUR limits with thousands separators while keeping raw numeric input', () => {
    const { container } = render(
      <Harness>
        <Step3Coverages />
      </Harness>,
    );

    const limit = inputFor(container, 'coverage.publicLiabilityLimit');
    expect(limit.value).toBe('900,000');

    fireEvent.focus(limit);
    fireEvent.change(limit, { target: { value: '1000000' } });
    expect(limit.value).toBe('1,000,000');
  });
});

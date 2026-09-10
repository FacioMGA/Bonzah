/* @vitest-environment happy-dom */
import { fireEvent, render } from '@testing-library/react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { describe, expect, it } from 'vitest';
import { Step4SumsInsured } from '../components/steps/Step4SumsInsured';

type HomeStepValues = {
  coverage: {
    buildings?: number;
    contents?: number;
  };
  usage: Record<string, boolean | undefined>;
};

function Harness() {
  const form = useForm<HomeStepValues>({ defaultValues: { coverage: {}, usage: {} }, mode: 'onChange' });
  const buildings = useWatch({ control: form.control, name: 'coverage.buildings' });
  const contents = useWatch({ control: form.control, name: 'coverage.contents' });
  return (
    <FormProvider {...form}>
      <Step4SumsInsured />
      <output data-testid="buildings-value">{String(buildings ?? '')}</output>
      <output data-testid="contents-value">{String(contents ?? '')}</output>
    </FormProvider>
  );
}

function typeDigits(input: HTMLInputElement, digits: string): void {
  fireEvent.focus(input);
  for (let length = 1; length <= digits.length; length += 1) {
    const typed = digits.slice(0, length);
    fireEvent.change(input, { target: { value: typed, selectionStart: typed.length } });
    expect(input.value).toBe(typed);
  }
}

describe('Step4SumsInsured — Home online sums', () => {
  it('accepts and preserves seven-digit buildings and six-digit contents values', () => {
    const { container, getByTestId } = render(<Harness />);
    const buildings = container.querySelector<HTMLInputElement>('[data-field="coverage.buildings"] input');
    const contents = container.querySelector<HTMLInputElement>('[data-field="coverage.contents"] input');
    expect(buildings).not.toBeNull();
    expect(contents).not.toBeNull();

    typeDigits(buildings!, '1500000');
    typeDigits(contents!, '100000');

    expect(getByTestId('buildings-value').textContent).toBe('1500000');
    expect(getByTestId('contents-value').textContent).toBe('100000');

    fireEvent.blur(buildings!);
    fireEvent.blur(contents!);
    expect(buildings!.value).toBe('1,500,000');
    expect(contents!.value).toBe('100,000');
  });
});

/* @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { PolicyHolderStep, type PolicyHolderStepProps } from '../PolicyHolderStep';

function Harness({
  defaultValues = {},
  children,
}: {
  defaultValues?: Record<string, unknown>;
  children: ReactNode;
}) {
  const form = useForm({ defaultValues, mode: 'onBlur', shouldUnregister: false });
  return <FormProvider {...form}>{children}</FormProvider>;
}

function renderStep(props: PolicyHolderStepProps = {}, defaults?: Record<string, unknown>) {
  return render(
    <Harness defaultValues={defaults}>
      <PolicyHolderStep {...props} />
    </Harness>,
  );
}

describe('PolicyHolderStep — nested (proposer.*) mode', () => {
  it('renders the standard personal-details + contact + marketing sections', () => {
    renderStep();
    expect(screen.getByText('Personal Details')).toBeInTheDocument();
    expect(screen.getByText('Contact Information')).toBeInTheDocument();
    expect(screen.getByText('Marketing & Privacy')).toBeInTheDocument();
    expect(screen.queryByText('Identification')).not.toBeInTheDocument();
  });

  it('registers proposer.* paths for the rendered fields', () => {
    const { container } = renderStep();
    const names = Array.from(container.querySelectorAll<HTMLInputElement>('input[name]')).map(
      (el) => el.name,
    );
    expect(names).toContain('proposer.firstName');
    expect(names).toContain('proposer.lastName');
    expect(names).toContain('proposer.email');
    expect(names).toContain('proposer.address.city');
    expect(names).toContain('proposer.address.postcode');
    expect(names).toContain('proposer.address.country');
    expect(names).toContain('proposer.marketingConsent');
  });

  it('renders dateOfBirth, NIF, and nationality when included', () => {
    const { container } = renderStep({
      include: { dateOfBirth: true, nationality: true, nif: true, marketingConsent: true },
    });
    const dobInput = container.querySelector<HTMLInputElement>('input[name="proposer.dateOfBirth"]');
    const nifInput = container.querySelector<HTMLInputElement>('input[name="proposer.nif"]');
    expect(dobInput).not.toBeNull();
    // ABY-68 swapped the legacy `<input type="date">` for the
    // `<DateInput>` primitive: the DOM input is now `type="text"` with
    // `inputMode="numeric"` (so iOS / Android show the right keyboard
    // and the marker.io feedback is satisfied), while the form state
    // continues to round-trip ISO `YYYY-MM-DD`.
    expect(dobInput?.type).toBe('text');
    expect(dobInput?.getAttribute('data-date-input')).toBe('true');
    expect(nifInput).not.toBeNull();
    expect(screen.getByText('Nationality')).toBeInTheDocument();
  });

  it('omits the marketing section when include.marketingConsent is false', () => {
    renderStep({ include: { marketingConsent: false } });
    expect(screen.queryByText('Marketing & Privacy')).not.toBeInTheDocument();
  });

  it('renders afterContactSlot between contact and marketing sections', () => {
    const { container } = renderStep({
      afterContactSlot: <div>Joint proposer slot</div>,
    });
    const text = container.textContent || '';
    expect(text.indexOf('Contact Information')).toBeLessThan(text.indexOf('Joint proposer slot'));
    expect(text.indexOf('Joint proposer slot')).toBeLessThan(text.indexOf('Marketing & Privacy'));
  });
});

describe('PolicyHolderStep — Identification section (Travel adapter)', () => {
  it('renders the Identification block when include.idType is true', () => {
    const { container } = renderStep({ include: { idType: true, marketingConsent: false } });
    expect(screen.getByText('Identification')).toBeInTheDocument();
    expect(container.querySelector('select[name="proposer.idType"]')).not.toBeNull();
    expect(container.querySelector('input[name="proposer.idNumber"]')).not.toBeNull();
  });

  it('exposes the two canonical ID-type options (passport, id_card) and no others', () => {
    const { container } = renderStep({ include: { idType: true, marketingConsent: false } });
    const select = container.querySelector<HTMLSelectElement>('select[name="proposer.idType"]');
    expect(select).not.toBeNull();
    const optionValues = Array.from(select!.querySelectorAll('option'))
      .filter((o) => (o as HTMLOptionElement).value !== '')
      .map((o) => (o as HTMLOptionElement).value);
    expect(optionValues).toEqual(['passport', 'id_card']);
  });
});

describe('PolicyHolderStep — confirmEmail extension (Phase 6f)', () => {
  it('does NOT render proposer.confirmEmail by default', () => {
    const { container } = renderStep();
    expect(container.querySelector('input[name="proposer.confirmEmail"]')).toBeNull();
  });

  it('renders proposer.confirmEmail when include.confirmEmail is true', () => {
    const { container } = renderStep({
      include: { confirmEmail: true, marketingConsent: false },
    });
    const confirm = container.querySelector<HTMLInputElement>('input[name="proposer.confirmEmail"]');
    expect(confirm).not.toBeNull();
    expect(confirm?.type).toBe('email');
    expect(screen.getByText('Confirm email')).toBeInTheDocument();
  });
});

describe('PolicyHolderStep — marketing consent uses shared Checkbox', () => {
  it('renders the marketing consent input as a checkbox (not a hand-rolled HTML input)', () => {
    const { container } = renderStep();
    const consent = container.querySelector<HTMLInputElement>('input[name="proposer.marketingConsent"]');
    expect(consent).not.toBeNull();
    expect(consent?.type).toBe('checkbox');
  });
});

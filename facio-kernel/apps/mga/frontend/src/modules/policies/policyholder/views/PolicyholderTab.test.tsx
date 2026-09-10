/* @vitest-environment happy-dom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Policyholder } from './PolicyholderTab';

vi.mock('@facio/products', () => ({
  normalizePostCodeForCountry: (value: string) => value,
  validatePostCodeForCountry: () => null,
}));

vi.mock('@/src/shared/components/AddressAutocomplete', () => ({
  default: ({ value, onChange, placeholder, disabled }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
  }) => (
    <input
      aria-label={placeholder || 'Address'}
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ),
}));

vi.mock('@/src/shared/ui', () => ({
  Button: ({ variant: _variant, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
    <button {...props} />
  ),
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & {
    variant?: string;
    onValueChange?: (value: string) => void;
  }>(({ variant: _variant, onValueChange, onChange, ...props }, ref) => (
    <input
      ref={ref}
      {...props}
      onChange={(event) => {
        onChange?.(event);
        onValueChange?.(event.currentTarget.value);
      }}
    />
  )),
  SearchableSelect: ({ value, onChange, disabled, 'aria-label': ariaLabel }: {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <select
      aria-label={ariaLabel || 'Searchable select'}
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      <option value="" />
      <option value="Cyprus">Cyprus</option>
      <option value="United Kingdom">United Kingdom</option>
    </select>
  ),
  PhoneInputField: ({ value, onChange, name, disabled, 'aria-label': ariaLabel }: {
    value: string;
    onChange: (value: string) => void;
    name?: string;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <input
      aria-label={ariaLabel || name || 'Phone'}
      disabled={disabled}
      name={name}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ),
}));

function baseProps(overrides: Partial<React.ComponentProps<typeof Policyholder>> = {}): React.ComponentProps<typeof Policyholder> {
  return {
    selectedPortfolio: {
      id: 'policy-1',
      status: 'DRAFT',
      productType: 'MOTOR',
      quoteData: {
        proposer: {
          firstName: 'Primary',
          lastName: 'Holder',
          address: {},
        },
      },
    },
    setSelectedPortfolio: vi.fn(),
    isEditing: true,
    setIsEditing: vi.fn(),
    formErrors: {},
    validateField: vi.fn(),
    clearFieldError: vi.fn(),
    setFieldError: vi.fn(),
    showValidation: false,
    readOnly: false,
    endorsementFieldChanged: vi.fn(() => false),
    loading: false,
    handleSavePolicy: vi.fn(),
    handleSavePolicyHolder: vi.fn(),
    handleCancelPolicyHolder: vi.fn(),
    loadPolicyDetails: vi.fn(),
    countryOptions: [
      { value: 'Cyprus', label: 'Cyprus' },
      { value: 'United Kingdom', label: 'United Kingdom' },
    ],
    ...overrides,
  };
}

describe('PolicyholderTab additional policy holders', () => {
  it('initializes policyHolders as an array when adding from a non-array value', () => {
    const setSelectedPortfolio = vi.fn();
    render(
      <Policyholder
        {...baseProps({
          setSelectedPortfolio,
          selectedPortfolio: {
            id: 'policy-1',
            status: 'DRAFT',
            productType: 'MOTOR',
            quoteData: {
              proposer: { firstName: 'Primary', lastName: 'Holder', address: {} },
              policyHolders: { firstName: 'Not array' },
            },
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '+ Policy holder' }));

    expect(setSelectedPortfolio).toHaveBeenCalledWith(expect.objectContaining({
      quoteData: expect.objectContaining({
        policyHolders: [{ firstName: 'Not array' }, { address: {} }],
      }),
    }));
  });

  it('updates additional holder fields under quoteData.policyHolders', () => {
    const setSelectedPortfolio = vi.fn();
    render(
      <Policyholder
        {...baseProps({
          setSelectedPortfolio,
          selectedPortfolio: {
            id: 'policy-1',
            status: 'DRAFT',
            productType: 'MOTOR',
            quoteData: {
              proposer: { firstName: 'Primary', lastName: 'Holder', address: {} },
              policyHolders: [{ address: {} }],
            },
          },
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText('Policy holder 2 first name'), { target: { value: 'Ada' } });

    expect(setSelectedPortfolio).toHaveBeenCalledWith(expect.objectContaining({
      quoteData: expect.objectContaining({
        policyHolders: [expect.objectContaining({ firstName: 'Ada' })],
      }),
    }));
  });

  it('does not expose additional policyholders for travel policies', () => {
    render(
      <Policyholder
        {...baseProps({
          selectedPortfolio: {
            id: 'policy-1',
            status: 'DRAFT',
            productType: 'TRAVEL',
            quoteData: {
              proposer: { firstName: 'Primary', lastName: 'Holder', address: {} },
            },
          },
        })}
      />,
    );

    expect(screen.queryByRole('button', { name: '+ Policy holder' })).toBeNull();
  });
});

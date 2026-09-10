/* @vitest-environment happy-dom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import AddressAutocomplete from '../AddressAutocomplete';

type GoogleWindow = typeof window & {
  google?: unknown;
};

const fetchAutocompleteSuggestions = vi.fn();

function installGooglePlacesStub() {
  (window as GoogleWindow).google = {
    maps: {
      places: {
        AutocompleteSessionToken: class AutocompleteSessionToken {},
        AutocompleteSuggestion: {
          fetchAutocompleteSuggestions,
        },
      },
    },
  };
}

function ControlledAddress({ initialValue = '', disabled = false }: { initialValue?: string; disabled?: boolean }) {
  const [value, setValue] = useState(initialValue);
  return (
    <AddressAutocomplete
      value={value}
      onChange={setValue}
      onAddressSelect={vi.fn()}
      placeholder="Search address"
      disabled={disabled}
    />
  );
}

describe('AddressAutocomplete', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchAutocompleteSuggestions.mockResolvedValue({
      suggestions: [
        {
          placePrediction: {
            placeId: 'place-1',
            mainText: { text: '1 Seafront Road' },
            secondaryText: { text: 'Hollywood, UK' },
          },
        },
      ],
    });
    installGooglePlacesStub();
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchAutocompleteSuggestions.mockReset();
    delete (window as GoogleWindow).google;
  });

  it('does not open suggestions for a hydrated value', async () => {
    render(<ControlledAddress initialValue="1 Seafront Ave" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(fetchAutocompleteSuggestions).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('does not fetch suggestions while disabled', async () => {
    render(<ControlledAddress initialValue="1 Seafront Ave" disabled />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(fetchAutocompleteSuggestions).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('fetches and opens suggestions after the user types', async () => {
    render(<ControlledAddress />);

    fireEvent.change(screen.getByPlaceholderText('Search address'), {
      target: { value: '1 Seafront Ave' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(fetchAutocompleteSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ input: '1 Seafront Ave' }),
    );
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});

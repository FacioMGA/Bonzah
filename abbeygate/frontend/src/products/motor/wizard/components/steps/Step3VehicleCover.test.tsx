/* @vitest-environment happy-dom */
import React from 'react';
import { act } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Step3VehicleCover } from './Step3VehicleCover';
import type { QuoteData } from '../../types';
import { initialQuoteData } from '../../quoteWizard.constants';

const vehicleApiMock = vi.hoisted(() => ({
  getAllMakeOptions: vi.fn(),
  getModelOptionsForMake: vi.fn(),
  getVariantOptions: vi.fn(),
  getVariantEnrichment: vi.fn(),
}));

vi.mock('../../services/vehicleApi', () => ({
  vehicleApi: vehicleApiMock,
}));

vi.mock('@/src/shared/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function renderWithForm(defaultValues: QuoteData, onReady?: (form: ReturnType<typeof useForm<QuoteData>>) => void) {
  function Wrapper() {
    const form = useForm<QuoteData>({
      defaultValues,
      mode: 'onBlur',
      shouldUnregister: false,
    });
    onReady?.(form);
    return (
      <FormProvider {...form}>
        <Step3VehicleCover />
      </FormProvider>
    );
  }
  return render(<Wrapper />);
}

describe('Step3VehicleCover trim lookup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vehicleApiMock.getAllMakeOptions.mockResolvedValue([{ value: 'Toyota', label: 'Toyota' }]);
    vehicleApiMock.getModelOptionsForMake.mockResolvedValue([{ value: 'Corolla', label: 'Corolla' }]);
    vehicleApiMock.getVariantOptions.mockResolvedValue([
      {
        variantId: 'toyota-corolla-2020-icon-hybrid',
        label: 'Icon Hybrid 1.8 Petrol',
        make: 'Toyota',
        model: 'Corolla',
        year: 2020,
        fuelType: 'Hybrid',
        engineSizeCc: 1798,
        numberOfSeats: 5,
        vehicleType: 'Car',
      },
    ]);
  });

  it('pins the native picker so cover cannot start before today', () => {
    renderWithForm(initialQuoteData);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const minRenewalISO = today.toISOString().slice(0, 10);
    const picker = screen.getByLabelText(/open policy start date picker/i) as HTMLInputElement;
    expect(picker.type).toBe('date');
    expect(picker.min).toBe(minRenewalISO);
  });

  it('shows the trim/specification dropdown when make, model, and year have variant options', async () => {
    renderWithForm({
      ...initialQuoteData,
      vehicleType: 'Car',
      make: 'Toyota',
      model: 'Corolla',
      year: 2020,
    });

    await waitFor(() => {
      expect(vehicleApiMock.getVariantOptions).toHaveBeenCalledWith(
        { make: 'Toyota', model: 'Corolla', year: 2020 },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    expect(await screen.findByText('Specification')).toBeInTheDocument();
  });

  it('does not suppress trim lookup when vehicle type is the default car value', async () => {
    renderWithForm({
      ...initialQuoteData,
      make: 'Toyota',
      model: 'Corolla',
      year: 2020,
    });

    await waitFor(() => {
      expect(vehicleApiMock.getVariantOptions).toHaveBeenCalled();
    });
    expect(await screen.findByText('Specification')).toBeInTheDocument();
  });

  it.each([
    ['Van to 3.5 tons', 'Van'],
    ['Motorcaravan', 'Caravan'],
    ['Motorbike', 'Motorcycle'],
  ])('hydrates the vehicle category switch from saved vehicleType %s', async (vehicleType, categoryLabel) => {
    renderWithForm({
      ...initialQuoteData,
      vehicleType: vehicleType as QuoteData['vehicleType'],
      make: '',
      model: '',
      year: 0,
    });

    expect(screen.getByRole('button', { name: categoryLabel })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Car' })).toHaveAttribute(
      'aria-pressed',
      categoryLabel === 'Car' ? 'true' : 'false',
    );
  });

  it('updates the vehicle category switch after async session hydration resets the form', async () => {
    let formApi!: ReturnType<typeof useForm<QuoteData>>;
    renderWithForm({ ...initialQuoteData, vehicleType: 'Car' }, (form) => {
      formApi = form;
    });

    expect(screen.getByRole('button', { name: 'Car' })).toHaveAttribute('aria-pressed', 'true');

    act(() => {
      formApi?.reset({ ...initialQuoteData, vehicleType: 'Van to 3.5 tons' });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Van' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('lets customers enter a manual specification when their trim is missing', async () => {
    vehicleApiMock.getVariantOptions.mockResolvedValue([]);

    renderWithForm({
      ...initialQuoteData,
      vehicleType: 'Car',
      make: 'Toyota',
      model: 'Corolla',
      year: 2020,
    });

    const manualInput = await screen.findByPlaceholderText('Enter model and trim manually') as HTMLInputElement;
    act(() => {
      fireEvent.change(manualInput, { target: { value: 'BMW 1 Series E80 116i' } });
    });

    expect(manualInput.value).toBe('BMW 1 Series E80 116i');
  });

  // ABY-275 / ABY-274 — Marker.io reports (Uriel, 2026-05-24): when
  // CarDog returns a non-empty model list but the customer's specific
  // model is not in it, the SearchableSelect would render "No results
  // found." with no escape hatch. The empty-list case (models.length
  // === 0) already drops to a manual `<Input>`; this test pins the
  // populated-list escape hatch — a "Can't find your model?" button
  // that toggles the same manual entry path.
  it('lets customers enter a manual model when CarDog returns a non-empty list that does not include their car (ABY-275)', async () => {
    vehicleApiMock.getModelOptionsForMake.mockResolvedValue([
      { value: 'Corolla', label: 'Corolla' },
      { value: 'RAV4', label: 'RAV4' },
    ]);

    renderWithForm({
      ...initialQuoteData,
      vehicleType: 'Car',
      make: 'Toyota',
      model: '',
      year: 2024,
    });

    // Wait until models have loaded into the dropdown before looking
    // for the toggle (it only renders alongside the populated
    // SearchableSelect, not while loading).
    await waitFor(() => {
      expect(vehicleApiMock.getModelOptionsForMake).toHaveBeenCalledWith('Toyota', expect.anything());
    });

    const manualToggle = await screen.findByRole('button', {
      name: "Can't find your model? Click here to enter it manually",
    });
    act(() => {
      fireEvent.click(manualToggle);
    });

    const manualInput = await screen.findByPlaceholderText("Can't find your model? Type it here...") as HTMLInputElement;
    act(() => {
      fireEvent.change(manualInput, { target: { value: 'Hilux GR Sport' } });
    });
    expect(manualInput.value).toBe('Hilux GR Sport');

    // The escape hatch should also offer a way back to the dropdown
    // so the customer is not stuck typing if they realise their
    // model was in the list after all.
    expect(await screen.findByRole('button', { name: 'Back to model list' })).toBeInTheDocument();
  });

  it('lets customers enter a manual make and model when the catalogue has no make match (ABY-511)', async () => {
    let formApi!: ReturnType<typeof useForm<QuoteData>>;
    renderWithForm({
      ...initialQuoteData,
      vehicleType: 'Car',
      make: '',
      model: '',
      year: 2024,
    }, (form) => {
      formApi = form;
    });

    const manualMakeToggle = await screen.findByRole('button', {
      name: "Can't find your make? Click here to enter it manually",
    });
    act(() => {
      fireEvent.click(manualMakeToggle);
    });

    const manualMake = await screen.findByPlaceholderText("Can't find your make? Type it here...") as HTMLInputElement;
    act(() => {
      fireEvent.change(manualMake, { target: { value: 'Rivian' } });
    });
    expect(manualMake.value).toBe('Rivian');

    const manualModel = await screen.findByPlaceholderText("Can't find your model? Type it here...") as HTMLInputElement;
    act(() => {
      fireEvent.change(manualModel, { target: { value: 'R1S' } });
    });
    expect(manualModel.value).toBe('R1S');
    expect(await screen.findByRole('button', { name: 'Back to make list' })).toBeInTheDocument();
    expect(formApi.getValues('__meta')?.vehicleEnrichment).toEqual(
      expect.objectContaining({ manualMake: true }),
    );
  });
});

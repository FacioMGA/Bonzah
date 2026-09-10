import { Bike, Bus, Car, Loader2, Truck } from 'lucide-react';
import { FormField } from '@/src/shared/ui';
import { WizardInput as Input, WizardSelect as Select } from '@/src/shared/ui';
import { WizardSearchableSelect as SearchableSelect } from '@/src/shared/ui';
import { SectionCard } from '@/src/shared/ui';
import type { QuoteData } from '../../types';
import { useEffect, useState } from 'react';
import type { VehicleEnrichmentFieldKey } from '../../services/vehicleApi';
import { SegmentedSwitch, type SegmentedOption } from './SegmentedSwitch';

// Trim picker repopulates these. Identity changes (make/model) must clear
// every enrichment-driven field so a stale `Yes` cabrio from a previous
// vehicle cannot leak into the new one. Drop a field from this list and
// the new enrichment merge will be blocked by user-edited stale values.
const FIELDS_RESET_ON_IDENTITY_CHANGE = [
  'fuelType',
  'numberOfSeats',
  'engineSize',
  'cabrio',
  'vehicleValue',
] as const satisfies ReadonlyArray<VehicleEnrichmentFieldKey>;

type IdentityResetField = (typeof FIELDS_RESET_ON_IDENTITY_CHANGE)[number];

const FIELD_RESET_VALUE: Record<IdentityResetField, unknown> = {
  fuelType: '',
  numberOfSeats: 0,
  engineSize: 0,
  cabrio: '',
  vehicleValue: 0,
};

type SelectOption = { value: string; label: string };
type VehicleTypeKind = 'car' | 'motorcycle' | 'caravan' | 'van';
type VehicleEnrichmentMeta = {
  manualMake?: boolean;
  manualSpecification?: string;
};

function isVehicleEnrichmentMeta(value: unknown): value is VehicleEnrichmentMeta {
  return typeof value === 'object' && value !== null;
}

type Props = {
  data: QuoteData;
  errors: Record<string, string>;
  makes: SelectOption[];
  models: SelectOption[];
  makesLoading: boolean;
  modelsLoading: boolean;
  yearOptions: SelectOption[];
  vinLookupLoading: boolean;
  vinLookupMessage: string;
  showTrimSelector: boolean;
  variantStatus: 'idle' | 'loading' | 'found' | 'none';
  variantSelectOptions: SelectOption[];
  activeVariantId: string;
  variantLookupError: string;
  enrichmentMessage: string;
  variantSlowLoadingHint: boolean;
  canUseTrimLookup: boolean;
  onChange: <K extends keyof QuoteData & string>(field: K, value: QuoteData[K]) => void;
  onUserChange: <K extends keyof QuoteData & string>(field: K, value: QuoteData[K]) => void;
  onVinChange: (vin: string) => void;
  onVinBlurLookup: () => void;
  onSelectVariant: (variantId: string) => void;
  clearSelectedVariant: () => void;
  suggestVehicle: (make: string, model: string, source: string, vin?: string) => Promise<void>;
};

export function vehicleTypeKindFromQuoteValue(value: unknown): VehicleTypeKind {
  const vt = String(value || '').toLowerCase();
  if (vt.includes('motorbike') || vt.includes('motorcycle')) return 'motorcycle';
  if (vt.includes('motorcaravan') || vt.includes('caravan')) return 'caravan';
  if (vt.includes('van')) return 'van';
  return 'car';
}

export function Step3VehicleIdentitySection(props: Props) {
  const storedVehicleMeta = props.data.__meta?.vehicleEnrichment;
  const vehicleMeta = isVehicleEnrichmentMeta(storedVehicleMeta) ? storedVehicleMeta : {};

  // ABY-511 — make/model catalogues are enrichment aids, not a constraint on
  // the risk identity. Persist the operator/customer's explicit manual mode so
  // a saved non-catalogue make reopens as an editable value instead of a
  // select that cannot represent it.
  const [manualMakeMode, setManualMakeMode] = useState(() => Boolean(vehicleMeta.manualMake));
  // ABY-150 — derive initial manual mode from the persisted manualSpecification
  // value so the UI is consistent after the component remounts (e.g. navigating
  // away from the step and back). Local `false` default resets on every remount,
  // making the trim dropdown reappear even after the user chose manual entry.
  const [manualSpecificationMode, setManualSpecificationMode] = useState(() => {
    return Boolean(String(vehicleMeta.manualSpecification || '').trim());
  });

  // ABY-178 — when no variants are found for the selected make/model/year,
  // automatically enter manual specification mode so the user doesn't have
  // to discover the "Didn't find your specification?" link themselves.
  // ABY-181 — reset manual mode when a new lookup starts (make/model/year
  // changed), keeping the state honest across tab/vehicle changes.
  useEffect(() => {
    if (props.variantStatus === 'none') {
      setManualSpecificationMode(true);
    }
  }, [props.variantStatus]);

  const vehicleTypeOptions: SegmentedOption<VehicleTypeKind>[] = [
    { id: 'car', label: 'Car', icon: Car },
    { id: 'motorcycle', label: 'Motorcycle', icon: Bike },
    { id: 'caravan', label: 'Motorhome / Motor Caravan', icon: Bus },
    { id: 'van', label: 'Van', icon: Truck },
  ];

  const [vehicleTypeKind, setVehicleTypeKind] = useState<VehicleTypeKind>(() =>
    vehicleTypeKindFromQuoteValue(props.data.vehicleType)
  );

  useEffect(() => {
    setVehicleTypeKind(vehicleTypeKindFromQuoteValue(props.data.vehicleType));
  }, [props.data.vehicleType]);

  const setVehicleTypeQuick = (kind: VehicleTypeKind) => {
    setVehicleTypeKind(kind);
    const mapped =
      kind === 'car'
        ? 'Car'
        : kind === 'motorcycle'
          ? 'Motorbike'
          : kind === 'caravan'
            ? 'Motorcaravan'
            : 'Van to 3.5 tons';
    props.onUserChange('vehicleType', mapped);
    // ABY-181 — switching vehicle category resets the manual specification
    // state so a previously entered car spec doesn't leak into a motorcycle.
    setManualSpecificationMode(false);
    setManualSpecification('');
    if (kind !== 'car') {
      props.clearSelectedVariant();
    }
  };
  const manualSpecification = String(vehicleMeta.manualSpecification || '');

  // ABY-179 — the session loads asynchronously AFTER this component first mounts.
  // On first mount props.data.__meta is still the empty initialQuoteData default,
  // so manualSpecificationMode initialises to false even if the saved session had
  // it set to true. Sync it whenever the underlying persisted value arrives or
  // changes so the manual entry state is restored correctly after a page refresh.
  useEffect(() => {
    if (manualSpecification && !manualSpecificationMode) {
      setManualSpecificationMode(true);
    }
  }, [manualSpecification]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (vehicleMeta.manualMake && !manualMakeMode) {
      setManualMakeMode(true);
    }
  }, [manualMakeMode, vehicleMeta.manualMake]);

  const setManualSpecification = (value: string) => {
    const rootMeta = props.data.__meta || {};
    props.onChange('__meta', {
      ...rootMeta,
      vehicleEnrichment: {
        ...vehicleMeta,
        manualSpecification: value,
      },
    });
  };

  const setManualMake = (enabled: boolean) => {
    const rootMeta = props.data.__meta || {};
    props.onChange('__meta', {
      ...rootMeta,
      vehicleEnrichment: {
        ...vehicleMeta,
        manualMake: enabled,
      },
    });
  };

  return (
    <SectionCard title="Your vehicle" icon={<Car className="w-6 h-6" />}>
      <div className="mb-4">
        <label className="block mb-2 text-[14px] font-semibold text-slate-400 tracking-tight">Vehicle Type</label>
        <SegmentedSwitch
          value={vehicleTypeKind}
          options={vehicleTypeOptions}
          onChange={(nextType) => setVehicleTypeQuick(nextType)}
        />
      </div>

      <div className="mb-4">
        <FormField
          label="VIN (optional)"
          error={props.errors.vin}
          tooltip="You can use a VIN to look up your vehicle. We will request its registration number only after you accept a quote."
          fieldKey="vin"
        >
          <Input
            value={String(props.data.vin || '')}
            onChange={(e) => props.onVinChange(String(e.target.value || '').toUpperCase().replace(/\s+/g, ''))}
            onBlur={props.onVinBlurLookup}
            error={!!props.errors.vin}
            placeholder="Enter VIN (17 characters)"
          />
        </FormField>
      </div>

      {props.vinLookupLoading ? (
        <div className="mb-4 mt-1 flex items-center gap-2 text-xs font-semibold text-slate-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Looking up vehicle details from VIN...
        </div>
      ) : null}
      {props.vinLookupMessage ? (
        <p className="mb-4 mt-1 text-xs font-semibold text-amber-700">{props.vinLookupMessage}</p>
      ) : null}

      <div className="my-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-semibold tracking-wide text-slate-500">or select your vehicle</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      <div className="grid grid-cols-1 gap-0 md:grid-cols-2 lg:grid-cols-3 md:gap-6">
        <FormField label="Make" required error={props.errors.make} fieldKey="make">
          {manualMakeMode ? (
            <>
              <Input
                value={String(props.data.make || '')}
                onChange={(e) => {
                  const nextMake = e.target.value;
                  if (nextMake !== props.data.make) {
                    props.onChange('model', '');
                    for (const field of FIELDS_RESET_ON_IDENTITY_CHANGE) {
                      props.onChange(field, FIELD_RESET_VALUE[field] as QuoteData[typeof field]);
                    }
                  }
                  props.onUserChange('make', nextMake);
                  props.clearSelectedVariant();
                }}
                placeholder="Can't find your make? Type it here..."
                className={props.errors.make ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : undefined}
              />
              <button
                type="button"
                className="mt-2 text-left text-xs font-semibold text-slate-500 underline-offset-4 hover:underline"
                onClick={() => {
                  setManualMakeMode(false);
                  setManualMake(false);
                }}
              >
                Back to make list
              </button>
            </>
          ) : (
            <>
              <SearchableSelect
                value={props.data.make}
                onChange={(value) => {
                  props.onUserChange('make', value);
                  props.clearSelectedVariant();
                  props.onChange('model', '');
                  for (const field of FIELDS_RESET_ON_IDENTITY_CHANGE) {
                    props.onChange(field, FIELD_RESET_VALUE[field] as QuoteData[typeof field]);
                  }
                }}
                options={props.makes}
                placeholder="Start typing make..."
                searchPlaceholder="Search car make..."
                loading={props.makesLoading}
                error={!!props.errors.make}
              />
              <button
                type="button"
                className="mt-2 text-left text-xs font-semibold text-brand-primary underline-offset-4 hover:underline"
                onClick={() => {
                  setManualMakeMode(true);
                  setManualMake(true);
                  props.clearSelectedVariant();
                  props.onChange('model', '');
                  for (const field of FIELDS_RESET_ON_IDENTITY_CHANGE) {
                    props.onChange(field, FIELD_RESET_VALUE[field] as QuoteData[typeof field]);
                  }
                }}
              >
                Can't find your make? Click here to enter it manually
              </button>
            </>
          )}
        </FormField>

        <FormField label="Model" required error={props.errors.model} fieldKey="model">
          {/* ABY-176 — when no make is selected render a non-interactive placeholder
              that explains why the model field cannot be activated yet. This avoids
              the confusing "I keep clicking it and nothing happens" behaviour caused
              by the invisible disabled attribute on the SearchableSelect input.
              ABY-177 — while models are loading show a disabled placeholder so
              there is no flash of SearchableSelect → text Input when the selected
              make turns out to have no models in the catalog. */}
          {!props.data.make ? (
            <div className="ui-select !h-controlLg flex items-center text-slate-400 text-[15px] font-medium cursor-not-allowed select-none px-4">
              Select make first
            </div>
          ) : props.data.make && props.modelsLoading ? (
            <Input
              value=""
              disabled
              placeholder="Loading models…"
            />
          ) : manualMakeMode || manualSpecificationMode || (props.data.make && !props.modelsLoading && props.models.length === 0) ? (
            <>
              <Input
                value={String(props.data.model || '')}
                onChange={(e) => props.onUserChange('model', e.target.value)}
                placeholder="Can't find your model? Type it here..."
                className={props.errors.model ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : undefined}
                onBlur={() => {
                  const m = String(props.data.make || '').trim();
                  const md = String(props.data.model || '').trim();
                  // Forward the VIN the user typed (Step 3 `data.vin`)
                  // when present so the catalogue-gap email carries
                  // the value CarDog failed to decode (Vin @ CarDog,
                  // 2026-06-02). Empty VIN is dropped at the suggest
                  // helper.
                  const vin = String(props.data.vin || '').trim();
                  if (m && md) void props.suggestVehicle(m, md, manualMakeMode ? 'manual_make_model_entry' : 'manual_model_entry', vin);
                }}
              />
              {/* ABY-275 — when models DID load (catalog returned a list)
                  but the user opted into manual entry, expose a way back
                  to the dropdown so they're not stuck typing if they
                  realise their model is in the list after all. */}
              {props.models.length > 0 && manualSpecificationMode ? (
                <button
                  type="button"
                  className="mt-2 text-left text-xs font-semibold text-slate-500 underline-offset-4 hover:underline"
                  onClick={() => setManualSpecificationMode(false)}
                >
                  Back to model list
                </button>
              ) : null}
            </>
          ) : (
            <>
              <SearchableSelect
                value={props.data.model}
                onChange={(value) => {
                  const prev = String(props.data.model || '');
                  props.onUserChange('model', value);
                  if (prev && prev !== value) {
                    props.clearSelectedVariant();
                    for (const field of FIELDS_RESET_ON_IDENTITY_CHANGE) {
                      props.onChange(field, FIELD_RESET_VALUE[field] as QuoteData[typeof field]);
                    }
                  }
                }}
                options={props.models}
                placeholder="Start typing model..."
                searchPlaceholder="Search model..."
                loading={props.modelsLoading}
                error={!!props.errors.model}
              />
              {/* ABY-275 / ABY-274 — Marker.io reports (Uriel, 2026-05-24)
                  on `/policies/.../#underwriting`: when the curated +
                  vPIC merge returns a non-empty list but the customer's
                  model is not in it, they were stuck inside the
                  SearchableSelect's "No results found." with no way to
                  proceed. The empty-list branch (above) already drops
                  to a manual `<Input>`; this button extends that escape
                  hatch to the populated-list case. Manual entry then
                  fires `suggestVehicle` on blur, which the backend
                  outboxes as `EMAIL.CARDOG_MODEL_SUGGESTION` so Sam at
                  CarDog gets notified about the catalog gap. */}
              <button
                type="button"
                className="mt-2 text-left text-xs font-semibold text-brand-primary underline-offset-4 hover:underline"
                onClick={() => {
                  setManualSpecificationMode(true);
                  props.clearSelectedVariant();
                }}
              >
                Can't find your model? Click here to enter it manually
              </button>
            </>
          )}
        </FormField>
        <FormField label="Year (of manufacture)" required error={props.errors.year} fieldKey="year">
          <Select
            value={props.data.year ? String(props.data.year) : ''}
            onChange={(e) => {
              props.clearSelectedVariant();
              props.onUserChange('year', parseInt(e.target.value, 10) || 0);
            }}
            error={!!props.errors.year}
            options={props.yearOptions}
          />
        </FormField>
      </div>

      {/* ABY-150 — only show trim selector when NOT in manual mode to avoid
          showing both the dropdown and the manual input simultaneously.
          Once the user clicks "Didn't find your specification?" the trim
          selector is replaced by the manual entry field so the UI state
          is unambiguous. */}
      {props.showTrimSelector && props.canUseTrimLookup && props.variantStatus !== 'loading' && !manualSpecificationMode ? (
        <FormField
          label="Specification"
          tooltip="Select your vehicle trim to pre-fill known details."
        >
          {props.variantStatus === 'found' && props.variantSelectOptions.length > 0 ? (
            <SearchableSelect
              value={props.activeVariantId}
              onChange={(value) => props.onSelectVariant(String(value || ''))}
              options={props.variantSelectOptions}
              placeholder="Search trim / variant…"
              searchPlaceholder="Type make, trim, engine, fuel, body..."
              disabled={!props.data.make || !props.data.model || !props.data.year}
            />
          ) : (
            <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500">
              No listed specification found for this make, model, and year.
            </p>
          )}
          <button
            type="button"
            className="mt-2 text-left text-xs font-semibold text-brand-primary underline-offset-4 hover:underline"
            onClick={() => {
              setManualSpecificationMode(true);
              props.clearSelectedVariant();
            }}
          >
            Didn't find your specification? Click here to add it manually
          </button>
        </FormField>
      ) : null}

      {manualSpecificationMode ? (
        <FormField
          label="Specification (manual entry)"
          tooltip="Enter the exact trim or specification when it is not available in the lookup list."
        >
          <Input
            value={manualSpecification}
            onChange={(e) => setManualSpecification(e.target.value)}
            placeholder="Enter model and trim manually"
          />
          <button
            type="button"
            className="mt-2 text-left text-xs font-semibold text-slate-500 underline-offset-4 hover:underline"
            onClick={() => {
              setManualSpecificationMode(false);
            }}
          >
            Search specification list instead
          </button>
        </FormField>
      ) : null}

      {props.showTrimSelector && props.canUseTrimLookup && props.variantStatus === 'loading' && !manualSpecificationMode ? (
        <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Looking up vehicle specifications…</span>
          {props.variantSlowLoadingHint ? (
            <span className="text-slate-400">(this is taking longer than usual)</span>
          ) : null}
        </div>
      ) : null}

      {/*
        ABY-69 — variantStatus === 'none' UX is intentionally silent now.
        Background:
          - ABY-52 originally added a "we couldn't find specifications…"
            banner for the empty-trim state because customers reported
            the previous SILENT empty as "trim select doesn't show up".
          - In practice the banner reads as a hard failure for popular
            make/model/year combos (the marker.io report cites Toyota
            and Hyundai trims), even though the UX-correct interpretation
            is "we don't have a trim catalog row for this; just keep
            filling the form by hand". Customers blamed our app for an
            upstream catalog gap, and operations got noisy support
            tickets for fully recoverable flows.
          - The vehicle detail fields (fuelType, vehicleType, seats,
            engine, value, etc.) ALWAYS render below this section
            regardless of trim lookup state, so the customer can always
            continue. We intentionally drop the banner and rely on the
            visible manual fields to communicate "type it in".
          - The empty-list root cause (CarDog credentials missing on a
            specific environment) still logs
            `vehicle_variant_lookup_failed` /
            `vehicle_enrichment.cardog_not_configured` server-side so
            ops can detect outages without the customer-facing copy
            screaming "broken".
      */}
    </SectionCard>
  );
}

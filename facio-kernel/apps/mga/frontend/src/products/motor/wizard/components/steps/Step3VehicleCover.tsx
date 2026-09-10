import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { QuoteData } from '../../types';
import { useFormContext, type FieldErrors } from 'react-hook-form';
import { FormField, SectionCard, WizardInput as Input, WizardSelect as Select } from '@/src/shared/ui';
import { Step3CoverAndUsageSection } from './Step3CoverAndUsageSection';
import { Step3VehicleSpecsSection } from './Step3VehicleSpecsSection';
import { vehicleApi, type VehicleEnrichmentFieldKey, type VehicleVariantOption } from '../../services/vehicleApi';
import { applyVehicleEnrichment, markVehicleFieldAsUserEdited } from '../../services/vehicleEnrichmentMerge';
import { variantOptionToEnrichmentResult } from '@facio/products';
import { Shield } from 'lucide-react';
import { logger } from '@/src/shared/lib/logger';
import { Step3VehicleIdentitySection } from './Step3VehicleIdentitySection';
import { Step3ContactAndDeclarationsSection } from './Step3ContactAndDeclarationsSection';
import {
  coverOptions,
  ENRICHMENT_TARGET_FIELDS,
  fuelTypeOptions,
  seatsOptions,
  vehicleKeptInOptions,
  vehicleTypeOptions,
  VIN_PATTERN,
  VARIANT_LOADING_HINT_DELAY_MS,
} from './step3VehicleCover.config';

// Step uses react-hook-form via <FormProvider /> in App.tsx.

export function Step3VehicleCover() {
  const { watch, setValue, resetField, formState, getValues } = useFormContext<QuoteData>();
  const data = watch();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // ABY-298: motor wizard policy-start-date upper bound. Aligned to the
  // canonical default `BinderProductAuthority.maxAdvanceInceptionDays`
  // (frontend/src/modules/binders/model/binderTypes.ts default = 90).
  // Customer-requested "up to 3 months in the future" matches that
  // default exactly. The wizard should ideally read this from the
  // session's active binder authority — see ABY-298 follow-up note;
  // until that contract is threaded through the public session
  // response, hardcoding to the canonical default keeps the wizard
  // and the binder authority in lockstep instead of arbitrarily
  // capping at 45 days.
  const maxAdvanceInceptionDays = 90;
  const maxStartDate = new Date(today);
  maxStartDate.setDate(maxStartDate.getDate() + maxAdvanceInceptionDays);
  const minRenewalISO = today.toISOString().slice(0, 10);
  const maxRenewalISO = maxStartDate.toISOString().slice(0, 10);
  const errors: Record<string, string> = {};
  const e = (formState.errors || {}) as FieldErrors<QuoteData>;
  const flattenErrorTree = (node: unknown, prefix: string): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (typeof record.message === 'string') {
      if (!errors[prefix]) errors[prefix] = record.message;
      return;
    }
    for (const [k, v] of Object.entries(record)) {
      if (k === 'ref' || k === 'type' || k === 'types' || k === 'root') continue;
      const nextKey = prefix ? `${prefix}.${k}` : k;
      flattenErrorTree(v, nextKey);
    }
  };
  for (const [k, v] of Object.entries(e)) {
    flattenErrorTree(v, k);
  }

  const onChange = useCallback(<K extends keyof QuoteData & string>(field: K, value: QuoteData[K]) => {
    setValue(
      field as Parameters<typeof setValue>[0],
      value as Parameters<typeof setValue>[1],
      { shouldDirty: true, shouldTouch: true, shouldValidate: true }
    );
  }, [setValue]);

  const onUserChange = useCallback(<K extends keyof QuoteData & string>(field: K, value: QuoteData[K]) => {
    if (ENRICHMENT_TARGET_FIELDS.has(field as VehicleEnrichmentFieldKey)) {
      const previousMeta = (((data.__meta as Record<string, unknown> | undefined)?.vehicleEnrichment as Record<string, unknown> | undefined)?.[field]) as Record<string, unknown> | undefined;
      const previousSource = String(previousMeta?.source || '');
      const previousValue = data[field];
      if (previousSource === 'cardog' && String(previousValue ?? '') !== String(value ?? '')) {
        logger.info({ event: 'vehicle_enrichment_field_overridden', field }, 'vehicle_enrichment');
      }
    }
    onChange(field, value);
    if (!ENRICHMENT_TARGET_FIELDS.has(field as VehicleEnrichmentFieldKey)) return;
    const nextQuoteData: QuoteData = { ...data };
    nextQuoteData[field] = value;
    const next = markVehicleFieldAsUserEdited(
      nextQuoteData,
      field as VehicleEnrichmentFieldKey
    );
    setValue('__meta', next.__meta, { shouldDirty: true, shouldTouch: false, shouldValidate: false });
  }, [data, onChange, setValue]);
  const currentYear = new Date().getFullYear();
  const effectiveFuelTypeOptions = data.modified ? fuelTypeOptions : fuelTypeOptions.filter((o) => o.value !== 'Other');

  const fmtInt = useMemo(
    () => new Intl.NumberFormat('en-IE', { maximumFractionDigits: 0 }),
    []
  );

  const parseDigitsInt = (raw: string): number => {
    const digits = String(raw || '').replace(/[^\d]/g, '');
    const n = parseInt(digits, 10);
    return Number.isFinite(n) ? n : 0;
  };

  // ABY-175 — if the session was saved with a past start date (e.g. the user
  // left the tab open overnight), clear it so the picker's min constraint
  // is honoured and the customer must pick a valid future date.
  useEffect(() => {
    if (!data.renewalDate) return;
    const d = new Date(data.renewalDate);
    if (Number.isNaN(d.getTime())) return;
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    if (d < todayMidnight) onChange('renewalDate', '');
  }, [data.renewalDate, onChange]);

  // Editing state for engine/power/vehicleValue lives in Step3VehicleSpecsSection.

  // Electric vehicles have no combustion-engine displacement. ADR-0102
  // uses `electricPowerKw` for their manufacturer maximum combined power;
  // engineSize remains zero and is never used as a rating sentinel.
  const isElectric = String(data.fuelType || '').trim() === 'Electric';
  useEffect(() => {
    if (isElectric) {
      if (data.engineSize !== 0) {
        onChange('engineSize', 0);
      }
    } else if (data.engineSize === 0) {
      // Clear the EV placeholder so the next ICE value is sourced explicitly.
      resetField('engineSize');
    }
  }, [data.engineSize, isElectric, onChange, resetField]);


  const yearOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [{ value: '', label: 'Select year…' }];
    for (let y = currentYear; y >= 1980; y--) opts.push({ value: String(y), label: String(y) });
    return opts;
  }, [currentYear]);
  const isMotorcycle = String(data.vehicleType || '').toLowerCase().includes('motorbike') || String(data.vehicleType || '').toLowerCase().includes('motorcycle');
  const isCaravan = String(data.vehicleType || '').toLowerCase().includes('motorcaravan') || String(data.vehicleType || '').toLowerCase().includes('caravan');
  const isVan = String(data.vehicleType || '').toLowerCase().includes('van');
  const isCabrioApplicable = !isMotorcycle && !isCaravan && !isVan;
  const isMotorcycleOver200cc = isMotorcycle && Number(data.engineSize || 0) > 200;

  // ABY-183 — motorcycles have at most 2 seats (rider + pillion).
  const effectiveSeatsOptions = useMemo(
    () => isMotorcycle ? seatsOptions.filter((o) => o.value === '' || Number(o.value) <= 2) : seatsOptions,
    [isMotorcycle],
  );
  useEffect(() => {
    if (!isMotorcycle) return;
    if (data.motorcycleRidersNamed === true) return;
    onChange('motorcycleRidersNamed', true);
  }, [data.motorcycleRidersNamed, isMotorcycle, onChange]);

  // Cabriolet cover applies only to passenger cars and 4x4/MPVs. The question
  // is hidden for motorbikes, vans and motorhomes/motor caravans, so pin the
  // canonical value to 'No' when the type changes.
  useEffect(() => {
    if (isCabrioApplicable) return;
    if (data.cabrio === 'No') return;
    onChange('cabrio', 'No');
  }, [data.cabrio, isCabrioApplicable, onChange]);

  // ABY-336 — clamp a previously-entered seat count down to the
  // motorbike maximum (2) when the vehicle type switches to motorbike,
  // so a stale 5-seat value from a car selection can't persist.
  useEffect(() => {
    if (!isMotorcycle) return;
    if (Number(data.numberOfSeats || 0) <= 2) return;
    onChange('numberOfSeats', 2);
  }, [data.numberOfSeats, isMotorcycle, onChange]);

  // ABY-323 — motorbikes are SD&P only; business / haulage classes are
  // not on the scheme. Pin the value so a stale business-use selection
  // from a car can't carry over when switching to a motorbike.
  useEffect(() => {
    if (!isMotorcycle) return;
    if (data.vehicleUse === 'SD&P') return;
    onChange('vehicleUse', 'SD&P');
  }, [data.vehicleUse, isMotorcycle, onChange]);

  // State for Makes and Models
  const [makes, setMakes] = useState<{ value: string; label: string }[]>([]);
  const [models, setModels] = useState<{ value: string; label: string }[]>([]);
  const [makesLoading, setMakesLoading] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [variantOptions, setVariantOptions] = useState<VehicleVariantOption[]>([]);
  const [variantLookupError, setVariantLookupError] = useState('');
  const persistedSelectedVariantId = String(
    (((data.__meta as Record<string, unknown> | undefined)?.vehicleEnrichment as Record<string, unknown> | undefined)?.selectedVariantId || '')
  ).trim();
  const [selectedVariantId, setSelectedVariantId] = useState(persistedSelectedVariantId);
  const [enrichmentMessage, setEnrichmentMessage] = useState('');
  const [variantStatus, setVariantStatus] = useState<'idle' | 'loading' | 'found' | 'none'>('idle');
  const [variantSlowLoadingHint, setVariantSlowLoadingHint] = useState(false);
  const [specAutofillHighlights, setSpecAutofillHighlights] = useState<Partial<Record<VehicleEnrichmentFieldKey, boolean>>>({});
  const specAutofillTimeouts = useRef<Partial<Record<VehicleEnrichmentFieldKey, number>>>({});
  const [vinLookupLoading, setVinLookupLoading] = useState(false);
  const [vinLookupMessage, setVinLookupMessage] = useState('');
  const activeVariantId = String(selectedVariantId || persistedSelectedVariantId || '').trim();
  const persistSelectedVariantId = useCallback((variantId: string) => {
    const rootMeta = ((getValues('__meta') as Record<string, unknown> | undefined) || {});
    const currentVehicleMeta = ((rootMeta.vehicleEnrichment as Record<string, unknown> | undefined) || {});
    const nextVehicleMeta: Record<string, unknown> = { ...currentVehicleMeta };
    const trimmed = String(variantId || '').trim();
    if (trimmed) {
      nextVehicleMeta.selectedVariantId = trimmed;
    } else {
      delete nextVehicleMeta.selectedVariantId;
    }
    setValue('__meta', { ...rootMeta, vehicleEnrichment: nextVehicleMeta }, { shouldDirty: true, shouldTouch: false, shouldValidate: false });
  }, [getValues, setValue]);

  const clearSelectedVariant = useCallback(() => {
    setSelectedVariantId('');
    persistSelectedVariantId('');
  }, [persistSelectedVariantId]);

  const pulseSpecAutofillField = useCallback((field: VehicleEnrichmentFieldKey) => {
    const existing = specAutofillTimeouts.current[field];
    if (existing) {
      window.clearTimeout(existing);
    }
    setSpecAutofillHighlights((prev) => ({ ...prev, [field]: true }));
    specAutofillTimeouts.current[field] = window.setTimeout(() => {
      setSpecAutofillHighlights((prev) => ({ ...prev, [field]: false }));
    }, 380);
  }, []);

  useEffect(() => {
    const timeouts = specAutofillTimeouts.current;
    return () => {
      for (const timeout of Object.values(timeouts)) {
        if (timeout) window.clearTimeout(timeout);
      }
    };
  }, []);

  // Load Makes on mount
  useEffect(() => {
    const controller = new AbortController();
    const loadMakes = async () => {
      setMakesLoading(true);
      try {
        const options = await vehicleApi.getAllMakeOptions({ signal: controller.signal });
        setMakes(options);
      } finally {
        setMakesLoading(false);
      }
    };
    loadMakes();

    return () => controller.abort();
  }, []);

  // Load Models when Make changes
  useEffect(() => {
    const controller = new AbortController();
    const loadModels = async () => {
      if (!data.make) {
        setModels([]);
        return;
      }

      setModelsLoading(true);
      try {
        const options = await vehicleApi.getModelOptionsForMake(data.make, { signal: controller.signal });
        setModels(options);
      } finally {
        setModelsLoading(false);
      }
    };

    if (data.make) {
      loadModels();
    } else {
      setModels([]);
    }

    return () => controller.abort();
  }, [data.make]);

  useEffect(() => {
    if (!selectedVariantId && persistedSelectedVariantId) {
      setSelectedVariantId(persistedSelectedVariantId);
    }
  }, [persistedSelectedVariantId, selectedVariantId]);

  const lastVariantLookupKeyRef = useRef('');
  useEffect(() => {
    const make = String(data.make || '').trim();
    const model = String(data.model || '').trim();
    const year = Number(data.year || 0);
    const lookupKey = `${make}|${model}|${year}`;

    if (!make || !model || !Number.isFinite(year) || year <= 0) {
      lastVariantLookupKeyRef.current = '';
      setVariantLookupError('');
      setVariantOptions([]);
      setVariantStatus('idle');
      setVariantSlowLoadingHint(false);
      return;
    }
    if (lastVariantLookupKeyRef.current === lookupKey) return;
    lastVariantLookupKeyRef.current = lookupKey;

    setVariantLookupError('');
    setVariantOptions([]);
    setVariantStatus('idle');
    setVariantSlowLoadingHint(false);

    const controller = new AbortController();
    const slowHintTimer = window.setTimeout(() => setVariantSlowLoadingHint(true), VARIANT_LOADING_HINT_DELAY_MS);
    setVariantStatus('loading');
    logger.info({ event: 'vehicle_variant_lookup_requested', make, model, year }, 'vehicle_enrichment');
    void vehicleApi.getVariantOptions({ make, model, year }, { signal: controller.signal })
      .then((options) => {
        setVariantOptions(options);
        setVariantStatus(options.length > 0 ? 'found' : 'none');
        if (activeVariantId && !options.some((option) => String(option.variantId || '') === activeVariantId)) {
          clearSelectedVariant();
        }
        logger.info({ event: 'vehicle_variant_lookup_succeeded', make, model, year, count: options.length }, 'vehicle_enrichment');
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name === 'AbortError') return;
        setVariantStatus('none');
        // Upstream variant providers can be intermittently unavailable.
        // Treat this as "no trims found" for UX continuity instead of a hard error banner.
        setVariantLookupError('');
        logger.warn({ event: 'vehicle_variant_lookup_failed', make, model, year, error: error instanceof Error ? error.message : 'unknown' }, 'vehicle_enrichment');
      })
      .finally(() => {
        window.clearTimeout(slowHintTimer);
        setVariantSlowLoadingHint(false);
      });

    return () => {
      window.clearTimeout(slowHintTimer);
      controller.abort();
    };
  }, [activeVariantId, clearSelectedVariant, data.make, data.model, data.year]);

  const applyVariantSelection = useCallback(async (variantId: string, source: 'cardog' | 'vin' = 'cardog') => {
    if (!variantId) return;
    setVariantLookupError('');
    setEnrichmentMessage('');
    logger.info({ event: 'vehicle_variant_selected', variantId }, 'vehicle_enrichment');

    // ABY-102 — explicit trim selection IS the user's intent to apply
    // those specs. The previous `window.confirm` produced "I selected
    // trim but the fields weren't filled" because (a) on mobile the
    // confirm appears under the soft keyboard and is dismissed by the
    // first tap outside it, and (b) the wording made customers think
    // "Cancel" meant "cancel the trim selection". For explicit
    // user-driven trim picks (`source === 'cardog'`) we now always
    // apply suggested values and surface the result in the inline
    // enrichment message banner so the user sees what changed.
    // VIN-driven background lookups still keep the explicit
    // confirmation prompt because the user did NOT choose those
    // values themselves.
    const conflictResolver = (fields: VehicleEnrichmentFieldKey[]) => {
      logger.info({ event: 'vehicle_enrichment_conflict_shown', fields, source }, 'vehicle_enrichment');
      if (source === 'cardog') {
        logger.info({ event: 'vehicle_enrichment_conflict_auto_accepted', fields }, 'vehicle_enrichment');
        return 'use_suggested' as const;
      }
      const accepted = window.confirm('We found different vehicle details from VIN. Use suggested values?');
      logger.info({ event: accepted ? 'vehicle_enrichment_conflict_accepted' : 'vehicle_enrichment_conflict_rejected', fields }, 'vehicle_enrichment');
      return accepted ? 'use_suggested' as const : 'keep_mine' as const;
    };

    const applyMergeResult = (result: ReturnType<typeof applyVehicleEnrichment>, mergeSource: 'cardog' | 'vin') => {
      const { nextQuoteData, appliedFields, conflictFields } = result;
      for (const field of appliedFields) {
        const nextValue = nextQuoteData[field];
        if (typeof nextValue === 'undefined') continue;
        setValue(field as keyof QuoteData, nextValue as QuoteData[keyof QuoteData], { shouldDirty: true, shouldTouch: true, shouldValidate: true });
        pulseSpecAutofillField(field);
      }
      setValue('__meta', nextQuoteData.__meta, { shouldDirty: true, shouldTouch: false, shouldValidate: false });
      if (mergeSource === 'cardog') persistSelectedVariantId(variantId);

      if (appliedFields.length > 0) {
        setEnrichmentMessage(mergeSource === 'vin'
          ? 'We found vehicle details from VIN and pre-filled known fields.'
          : '');
      } else if (conflictFields.length > 0) {
        setEnrichmentMessage('Some suggested vehicle details differ from what you entered. Your current values were kept.');
      } else {
        setEnrichmentMessage(
          mergeSource === 'vin'
            ? 'VIN lookup worked, but no extra vehicle fields were suggested.'
            : 'No additional vehicle fields were suggested for this trim.'
        );
      }
      logger.info({ event: 'vehicle_enrichment_applied', variantId, appliedFields, conflictFields }, 'vehicle_enrichment');
    };

    try {
      const currentQuoteData = getValues();
      const enrichment = await vehicleApi.getVariantEnrichment(variantId);
      applyMergeResult(
        applyVehicleEnrichment({ quoteData: currentQuoteData, enrichment, source, onConflict: conflictResolver }),
        source,
      );
    } catch (error) {
      if (source === 'vin') {
        setVinLookupMessage('We couldn’t identify all vehicle details from the VIN. You can continue manually.');
        logger.warn({ event: 'vehicle_variant_lookup_failed', variantId, error: error instanceof Error ? error.message : 'unknown' }, 'vehicle_enrichment');
        return;
      }
      // Cache miss / pod-local cache eviction / upstream rate limit: fall back to
      // the same canonical merge using the variant option payload that the
      // dropdown already showed. This guarantees the user sees the same fields
      // (fuelType, cabrio, …) the trim label promised, regardless of which path
      // we end up on.
      const fallbackOption = variantOptions.find((option) => String(option.variantId || '') === String(variantId || ''));
      if (fallbackOption) {
        const currentQuoteData = getValues();
        const enrichment = variantOptionToEnrichmentResult(fallbackOption);
        applyMergeResult(
          applyVehicleEnrichment({ quoteData: currentQuoteData, enrichment, source, onConflict: conflictResolver }),
          source,
        );
        logger.info({ event: 'vehicle_enrichment_applied_via_fallback', variantId }, 'vehicle_enrichment');
        return;
      }
      setVariantLookupError('We couldn’t apply vehicle suggestions right now. You can continue entering details manually.');
      logger.warn({ event: 'vehicle_variant_lookup_failed', variantId, error: error instanceof Error ? error.message : 'unknown' }, 'vehicle_enrichment');
    }
  }, [getValues, persistSelectedVariantId, pulseSpecAutofillField, setValue, variantOptions]);

  const handleVinBlurLookup = useCallback(async () => {
    const vinRaw = String(data.vin || '').toUpperCase().replace(/\s+/g, '');
    if (!vinRaw) return;
    if (!VIN_PATTERN.test(vinRaw)) {
      setVinLookupMessage('VIN must be 11-17 characters and cannot contain I, O, or Q.');
      return;
    }
    setVinLookupMessage('Looking up vehicle details from VIN...');
    setVinLookupLoading(true);
    await applyVariantSelection(vinRaw, 'vin');
    setVinLookupLoading(false);
  }, [applyVariantSelection, data.vin]);

  const variantSelectOptions = useMemo(() => {
    const toLabel = (option: VehicleVariantOption): string => {
      const trim = String(option.trimName || option.label || '').trim();
      const specs = [
        option.fuelType,
        option.transmission,
        option.bodyStyle || option.vehicleType,
        option.driveType,
        option.engineSizeCc ? `${option.engineSizeCc}cc` : '',
        option.numberOfSeats ? `${option.numberOfSeats} seats` : '',
      ]
        .map((part) => String(part || '').trim())
        .filter(Boolean);
      return [trim, specs.join(' · ')].filter(Boolean).join(' — ');
    };

    return variantOptions.map((option) => ({
      value: option.variantId,
      label: toLabel(option),
    }));
  }, [variantOptions]);

  // ABY-275 — `source` carries the wizard call-site label
  // ('manual_make_model_entry' / 'manual_model_entry' / 'manual_trim_entry')
  // so the backend can
  // route the EMAIL.CARDOG_MODEL_SUGGESTION outbox event with the
  // exact origin in the email body. We keep the parameter named
  // `source` (not `note`) because the prior name was misleading —
  // the backend's `note` field is reserved for free-form operator
  // commentary, not for call-site labels.
  // `vin` carries the value the user typed which CarDog failed to
  // decode — added 2026-06-02 per Vin @ CarDog so the catalogue-gap
  // email feeds their auto-catalogue automation. Pulled from the
  // wizard's Step 3 `data.vin` at the call site; omitted when blank
  // so existing manual-model-entry callers (no VIN in scope yet)
  // continue to work unchanged.
  const suggestVehicle = async (make: string, model: string, source?: string, vin?: string) => {
    try {
      const cleanVin = String(vin || '').trim().toUpperCase();
      await fetch('/api/public/vehicles/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ make, model, source, ...(cleanVin ? { vin: cleanVin } : {}) }),
      });
    } catch {
      // suggestions must never block UX
    }
  };

  const hasManualIdentity = Boolean(String(data.make || '').trim() && String(data.model || '').trim() && Number(data.year) > 0);
  const vehicleTypeValue = String(data.vehicleType || '').trim();
  const vehicleTypeValueLower = vehicleTypeValue.toLowerCase();

  // ABY-180 — the vehicle-type dropdown only shows options that belong to the
  // currently selected tab so users can't accidentally pick "Car" while on the
  // motorcycle tab or vice versa.
  const filteredVehicleTypeOptions = useMemo(() => {
    const vt = vehicleTypeValueLower;
    if (vt.includes('motorbike') || vt.includes('motorcycle')) {
      return vehicleTypeOptions.filter((o) => o.value === '' || o.value === 'Motorbike');
    }
    if (vt.includes('motorcaravan') || vt.includes('caravan')) {
      return vehicleTypeOptions.filter((o) => o.value === '' || o.value === 'Motorcaravan');
    }
    if (vt.includes('van') || vt.includes('pickup')) {
      return vehicleTypeOptions.filter((o) => o.value === '' || o.value === 'Van to 3.5 tons' || o.value === 'Pickup');
    }
    return vehicleTypeOptions;
  }, [vehicleTypeValueLower]);

  const isExplicitNonCarType =
    vehicleTypeValueLower.includes('motorbike') ||
    vehicleTypeValueLower.includes('motorcycle') ||
    vehicleTypeValueLower.includes('motorcaravan') ||
    vehicleTypeValueLower.includes('caravan') ||
    vehicleTypeValueLower.includes('van') ||
    vehicleTypeValueLower.includes('pickup');
  const canUseTrimLookup = !isExplicitNonCarType;
  const showTrimSelector = hasManualIdentity && canUseTrimLookup;
  return (
    <div className="max-w-4xl mx-auto px-5 py-2">
      <SectionCard title="Cover Details" icon={<Shield className="w-6 h-6" />}>
        <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-6">
          <FormField label="Where will the vehicle be kept?" required error={errors.vehicleLocation} fieldKey="vehicleLocation">
            <Select
              value={data.vehicleLocation}
              onChange={(e) => onChange('vehicleLocation', e.target.value)}
              error={!!errors.vehicleLocation}
              showValid={!errors.vehicleLocation && Boolean(data.vehicleLocation)}
              options={vehicleKeptInOptions}
            />
          </FormField>

          <FormField label="Cover Required" required error={errors.coverRequired} fieldKey="coverRequired">
            <Select
              value={data.coverRequired}
              onChange={(e) => onChange('coverRequired', e.target.value)}
              error={!!errors.coverRequired}
              showValid={!errors.coverRequired && Boolean(data.coverRequired)}
              options={coverOptions}
            />
          </FormField>

          <FormField
            label="Policy Start Date"
            required
            error={errors.renewalDate}
            tooltip="Cover starts at 00:01 on this date and expires at noon on the expiry date."
            fieldKey="renewalDate"
          >
            <Input
              type="date"
              min={minRenewalISO}
              max={maxRenewalISO}
              value={data.renewalDate}
              onValueChange={(next) => onChange('renewalDate', next)}
              error={!!errors.renewalDate}
              showValid={!errors.renewalDate && Boolean(data.renewalDate)}
              aria-label="Policy start date"
            />
          </FormField>
        </div>
      </SectionCard>

      <Step3VehicleIdentitySection
        data={data}
        errors={errors}
        makes={makes}
        models={models}
        makesLoading={makesLoading}
        modelsLoading={modelsLoading}
        yearOptions={yearOptions}
        vinLookupLoading={vinLookupLoading}
        vinLookupMessage={vinLookupMessage}
        showTrimSelector={showTrimSelector}
        variantStatus={variantStatus}
        variantSelectOptions={variantSelectOptions}
        activeVariantId={activeVariantId}
        variantLookupError={variantLookupError}
        enrichmentMessage={enrichmentMessage}
        variantSlowLoadingHint={variantSlowLoadingHint}
        canUseTrimLookup={canUseTrimLookup}
        onChange={onChange}
        onUserChange={onUserChange}
        onVinChange={(nextVin) => {
          onChange('vin', nextVin);
          setVinLookupMessage('');
        }}
        onVinBlurLookup={() => { void handleVinBlurLookup(); }}
        onSelectVariant={(variantId) => {
          setSelectedVariantId(variantId);
          persistSelectedVariantId(variantId);
          void applyVariantSelection(variantId);
        }}
        clearSelectedVariant={clearSelectedVariant}
        suggestVehicle={suggestVehicle}
      />

      <Step3VehicleSpecsSection
        data={data}
        errors={errors}
        fmtInt={fmtInt}
        parseDigitsInt={parseDigitsInt}
        specAutofillHighlights={specAutofillHighlights}
        effectiveFuelTypeOptions={effectiveFuelTypeOptions}
        effectiveSeatsOptions={effectiveSeatsOptions}
        filteredVehicleTypeOptions={filteredVehicleTypeOptions}
        canUseTrimLookup={canUseTrimLookup}
        isElectric={isElectric}
        isCaravan={isCaravan}
        isMotorcycle={isMotorcycle}
        isCabrioApplicable={isCabrioApplicable}
        onChange={onChange}
        onUserChange={onUserChange}
      />

      <Step3CoverAndUsageSection
        data={data}
        errors={errors}
        isMotorcycleOver200cc={isMotorcycleOver200cc}
        isMotorcycle={isMotorcycle}
        onChange={onChange}
      />

      <Step3ContactAndDeclarationsSection
        data={data}
        errors={errors}
        setValue={setValue}
        onChange={onChange}
      />
    </div>
  );
}

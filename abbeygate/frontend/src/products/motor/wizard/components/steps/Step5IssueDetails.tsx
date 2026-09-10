import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useFormContext } from 'react-hook-form';
import { AlertCircle, CheckCircle2, Hash, Plus, ScanLine, Trash2 } from 'lucide-react';
import { DateInput, FormField, PhoneInputField } from '@/src/shared/ui';
import { WizardButton as Button, WizardInput as Input, WizardSelect as Select } from '@/src/shared/ui';
import type { QuoteData } from '../../types';
import { REGION_CONFIG } from '../../config/region';
import { issueFieldKeyFromSlug } from '../../validation/driverValidation';
import { licenseYearsOptions } from '../../utils/licenseYears';
import { getNestedError } from '@/src/shared/lib/wizard/utils/errors';
import { SegmentedSwitch, type SegmentedOption } from './SegmentedSwitch';

type MissingField = {
  slug: string;
  label: string;
  customerHash?: string;
};

type ConditionalRequirement = {
  code: string;
  message: string;
  severity?: 'BLOCK' | 'WARN';
  details?: Record<string, unknown>;
};

interface Step5IssueDetailsProps {
  missingFields: MissingField[];
  conditionalRequirements: ConditionalRequirement[];
  checking: boolean;
}

type FieldKey = keyof QuoteData;

const errorAtPath = (errorsRoot: unknown, path: string): string | undefined =>
  getNestedError((errorsRoot ?? {}) as Record<string, unknown>, path);

// ABY-154/155 — issue-details missing-field renderer needs type hints so
// date-of-birth fields get a native date picker instead of a plain text
// box. Without `type="date"` the input looks like a blank unlabelled field
// (ABY-154) and the browser rejects hand-typed date strings on blur (ABY-155).
const DATE_FIELD_SUFFIXES = ['dateOfBirth', 'date_of_birth'];
function isDateField(key: string): boolean {
  const k = String(key || '');
  return DATE_FIELD_SUFFIXES.some((suffix) => k === suffix || k.endsWith(`.${suffix}`));
}

// ABY-235 — `validateMotorIssuanceStage` (per ABY-104) attaches the SAME
// "Provide either Registration number OR VIN" error to BOTH
// `registrationNumber` and `vin` when neither is filled. The post-quote
// issue-details step was rendering them as two independent required
// inputs; this helper detects that exact either-or pair so we can
// collapse them into one switched field that mirrors Step 3 Vehicle
// Cover's Registration / VIN segmented switch.
function isRegistrationKey(key: string): boolean {
  return key === 'registrationNumber';
}
function isVinKey(key: string): boolean {
  return key === 'vin';
}

const VEHICLE_IDENTIFIER_OPTIONS: SegmentedOption<'registration' | 'vin'>[] = [
  { id: 'registration', label: 'Registration', icon: Hash },
  { id: 'vin', label: 'VIN', icon: ScanLine },
];

function VehicleIdentifierField({
  registrationError,
  vinError,
}: {
  registrationError?: string;
  vinError?: string;
}) {
  const { setValue, watch, register } = useFormContext<QuoteData>();
  const registrationNumber = String(watch('registrationNumber') || '');
  const vin = String(watch('vin') || '');
  // ABY-235 — default to whichever side already has a value; otherwise
  // default to Registration (the canonical default per ABY-105 on Step 3).
  const [mode, setMode] = useState<'registration' | 'vin'>(() => {
    if (vin && !registrationNumber) return 'vin';
    return 'registration';
  });

  const activeError = mode === 'registration' ? registrationError : vinError;
  const activeFieldKey = mode === 'registration' ? 'registrationNumber' : 'vin';

  return (
    <div className="md:col-span-2">
      <div className="mb-2">
        <SegmentedSwitch
          value={mode}
          options={VEHICLE_IDENTIFIER_OPTIONS}
          onChange={(next) => {
            setMode(next);
            // Clear the OTHER side so the issue-readiness re-check
            // can drop both fields from missingFields as soon as the
            // selected one is filled (validateMotorIssuanceStage
            // accepts either-or — ABY-104).
            if (next === 'registration' && vin) {
              setValue('vin', '', { shouldDirty: true, shouldTouch: true, shouldValidate: false });
            }
            if (next === 'vin' && registrationNumber) {
              setValue('registrationNumber', '', { shouldDirty: true, shouldTouch: true, shouldValidate: false });
            }
          }}
        />
      </div>
      <FormField
        label={mode === 'registration' ? 'Registration number' : 'VIN'}
        required
        error={activeError}
        fieldKey={activeFieldKey}
      >
        <Input
          {...(mode === 'registration'
            ? register('registrationNumber', {
                setValueAs: (v) => String(v ?? '').toUpperCase(),
              })
            : register('vin', {
                setValueAs: (v) => String(v ?? '').toUpperCase().replace(/\s+/g, ''),
              }))}
          placeholder={mode === 'registration' ? 'e.g. KAA123' : 'Enter VIN (11-17 characters)'}
          showValid
        />
      </FormField>
      <p className="mt-2 text-xs font-medium text-slate-500">
        Either Registration number or VIN is fine — only one is required to issue.
      </p>
    </div>
  );
}

export function Step5IssueDetails({
  missingFields,
  conditionalRequirements,
  checking,
}: Step5IssueDetailsProps) {
  const { register, watch, control, formState } = useFormContext<QuoteData>();
  const errors = formState.errors;
  const { fields, append, remove } = useFieldArray({
    name: 'additionalDrivers',
  });
  const firstDriverSeededRef = useRef(false);
  const driverRestriction = watch('driverRestriction');
  // ABY-232 / ADR-0025: the named-drivers grid is only rendered when
  // the policy is on the NAMED_DRIVERS basis. For POLICYHOLDER_ONLY
  // and the two open modes (ANY_DRIVER_25_PLUS / ANY_DRIVER_40_PLUS)
  // the grid is hidden — Step2DrivingHistory's cascade-clear keeps
  // the array empty so we never accidentally surface stale rows in
  // documents / claims.
  const isNamedDriversMode = driverRestriction === 'NAMED_DRIVERS' || driverRestriction === undefined || driverRestriction === null;
  const hasAdditionalDrivers = isNamedDriversMode && watch('hasAdditionalDrivers') === true;
  const defaultPhoneCountry: React.ComponentProps<typeof PhoneInputField>['defaultCountry'] =
    REGION_CONFIG.defaultRegionCode === 'US' ? 'US' :
      REGION_CONFIG.defaultRegionCode === 'GB' ? 'GB' :
        REGION_CONFIG.defaultRegionCode === 'CY' ? 'CY' :
          REGION_CONFIG.defaultRegionCode === 'PT' ? 'PT' :
            REGION_CONFIG.defaultRegionCode === 'GR' ? 'GR' :
              REGION_CONFIG.defaultRegionCode === 'ES' ? 'ES' :
                undefined;

  const mappedMissingFields = useMemo(() => {
    return missingFields
      .map((field) => ({ ...field, key: issueFieldKeyFromSlug(field.slug) as FieldKey | null }))
      .filter((field): field is MissingField & { key: FieldKey } =>
        // additionalDrivers is an array field handled by the dedicated section below —
        // do not render it as a plain text input in the missing-fields grid.
        Boolean(field.key) && field.key !== ('additionalDrivers' as FieldKey),
      );
  }, [missingFields]);

  // ABY-235 — detect the canonical either-or pair from
  // validateMotorIssuanceStage (ABY-104) so we can render ONE switched
  // input instead of two parallel required text boxes.
  const hasRegistrationMissing = mappedMissingFields.some((field) => isRegistrationKey(String(field.key)));
  const hasVinMissing = mappedMissingFields.some((field) => isVinKey(String(field.key)));
  const showVehicleIdentifierSwitch = hasRegistrationMissing && hasVinMissing;
  const gridMissingFields = useMemo(() => {
    if (!showVehicleIdentifierSwitch) return mappedMissingFields;
    return mappedMissingFields.filter(
      (field) => !isRegistrationKey(String(field.key)) && !isVinKey(String(field.key)),
    );
  }, [mappedMissingFields, showVehicleIdentifierSwitch]);

  const unknownMissingFields = useMemo(
    () => missingFields.filter((field) => !issueFieldKeyFromSlug(field.slug)),
    [missingFields]
  );

  useEffect(() => {
    if (!hasAdditionalDrivers) {
      firstDriverSeededRef.current = false;
      return;
    }
    if (fields.length === 0 && !firstDriverSeededRef.current) {
      append({ firstName: '', lastName: '', dateOfBirth: '', licenseYears: '', email: '', telephone: '' });
      firstDriverSeededRef.current = true;
    }
  }, [append, fields.length, hasAdditionalDrivers]);

  return (
    <div className="max-w-4xl mx-auto px-5 py-8">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 text-amber-700" />
          <div>
            <h2 className="text-xl font-bold text-amber-900">Complete required details before payment</h2>
            <p className="mt-2 text-sm font-medium text-amber-800">
              Complete the missing details below, then save to continue to issuance.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-black uppercase tracking-wider text-slate-500">Required for issuance</h3>
        {showVehicleIdentifierSwitch ? (
          <div className="mt-4">
            <VehicleIdentifierField
              registrationError={errorAtPath(errors, 'registrationNumber')}
              vinError={errorAtPath(errors, 'vin')}
            />
          </div>
        ) : null}
        <div className="mt-4 grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-6">
          {gridMissingFields.map((field) => {
            const dateField = isDateField(String(field.key));
            return (
              <FormField
                key={field.slug}
                label={field.label}
                required
                error={errorAtPath(errors, String(field.key))}
                fieldKey={field.key}
              >
                {dateField ? (
                  // ABY-154/155 — date fields must use Controller so
                  // DateInput's ISO-string onChange reaches RHF. Using
                  // register() + type="date" routes through WizardDateInput
                  // which calls onValueChange (not onChange), so RHF never
                  // receives the update and the value is rejected on blur.
                  <Controller
                    name={field.key}
                    control={control}
                    render={({ field: f }) => (
                      <DateInput
                        name={f.name}
                        value={String(f.value || '')}
                        onChange={f.onChange}
                        onBlur={f.onBlur}
                        error={!!errorAtPath(errors, String(field.key))}
                        showValid
                        placeholder="DD/MM/YYYY"
                        variant="wizard"
                      />
                    )}
                  />
                ) : (
                  <Input
                    {...register(field.key)}
                    placeholder={field.label}
                    showValid
                  />
                )}
              </FormField>
            );
          })}
        </div>

        {unknownMissingFields.length > 0 ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Additional required fields</div>
            <div className="mt-2 space-y-1">
              {unknownMissingFields.map((field) => (
                <div key={field.slug} className="text-sm text-slate-700">
                  {field.label} <span className="text-xs text-slate-400">({field.slug})</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {hasAdditionalDrivers ? (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-black uppercase tracking-wider text-slate-600">Additional Drivers</h4>
              <Button
                type="button"
                className="inline-flex items-center justify-center rounded-full border border-[#0d4b7f] px-4 py-2 text-sm font-semibold text-[#0d4b7f] hover:bg-slate-50"
                onClick={() =>
                  append({
                    firstName: '',
                    lastName: '',
                    dateOfBirth: '',
                    licenseYears: '',
                    email: '',
                    telephone: '',
                  })
                }
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Driver
              </Button>
            </div>
            <div className="mt-3 space-y-4">
              {errorAtPath(errors, 'additionalDrivers') ? (
                <p className="text-xs font-semibold text-red-600">{errorAtPath(errors, 'additionalDrivers')}</p>
              ) : null}
              {fields.map((field, idx) => (
                <div key={field.id} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Driver {idx + 2}</div>
                    <Button
                      type="button"
                      onClick={() => remove(idx)}
                      variant="secondary"
                      className="text-slate-500 hover:text-red-600"
                      aria-label={`Remove driver ${idx + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <FormField
                      label="First name"
                      required
                      error={errorAtPath(errors, `additionalDrivers.${idx}.firstName`)}
                      fieldKey={`additionalDrivers.${idx}.firstName`}
                    >
                      <Input
                        {...register(`additionalDrivers.${idx}.firstName`)}
                        placeholder="First name"
                        error={Boolean(errorAtPath(errors, `additionalDrivers.${idx}.firstName`))}
                        showValid
                      />
                    </FormField>
                    <FormField
                      label="Last name"
                      required
                      error={errorAtPath(errors, `additionalDrivers.${idx}.lastName`)}
                      fieldKey={`additionalDrivers.${idx}.lastName`}
                    >
                      <Input
                        {...register(`additionalDrivers.${idx}.lastName`)}
                        placeholder="Last name"
                        error={Boolean(errorAtPath(errors, `additionalDrivers.${idx}.lastName`))}
                        showValid
                      />
                    </FormField>
                    <FormField
                      label="Date of birth"
                      required
                      error={errorAtPath(errors, `additionalDrivers.${idx}.dateOfBirth`)}
                      fieldKey={`additionalDrivers.${idx}.dateOfBirth`}
                    >
                      <Controller
                        name={`additionalDrivers.${idx}.dateOfBirth`}
                        control={control}
                        render={({ field: dobField }) => (
                          <DateInput
                            name={dobField.name}
                            value={String(dobField.value || '')}
                            onChange={dobField.onChange}
                            onBlur={dobField.onBlur}
                            error={Boolean(errorAtPath(errors, `additionalDrivers.${idx}.dateOfBirth`))}
                            showValid
                            placeholder="DD/MM/YYYY"
                            variant="wizard"
                          />
                        )}
                      />
                    </FormField>
                    <FormField
                      label="Years holding licence"
                      required
                      error={errorAtPath(errors, `additionalDrivers.${idx}.licenseYears`)}
                      fieldKey={`additionalDrivers.${idx}.licenseYears`}
                    >
                      <Select
                        {...register(`additionalDrivers.${idx}.licenseYears`, {
                          setValueAs: (v) => (v === '' ? '' : parseInt(String(v), 10)),
                        })}
                        error={Boolean(errorAtPath(errors, `additionalDrivers.${idx}.licenseYears`))}
                        showValid
                        options={licenseYearsOptions}
                      />
                    </FormField>
                    <FormField
                      label="Email (optional)"
                      error={errorAtPath(errors, `additionalDrivers.${idx}.email`)}
                      fieldKey={`additionalDrivers.${idx}.email`}
                    >
                      <Input
                        {...register(`additionalDrivers.${idx}.email`)}
                        placeholder="Email"
                        type="email"
                        error={Boolean(errorAtPath(errors, `additionalDrivers.${idx}.email`))}
                        showValid
                      />
                    </FormField>
                    <div className="md:col-span-2">
                      <FormField
                        label="Telephone (optional)"
                        error={errorAtPath(errors, `additionalDrivers.${idx}.telephone`)}
                        fieldKey={`additionalDrivers.${idx}.telephone`}
                      >
                        <Controller
                          name={`additionalDrivers.${idx}.telephone`}
                          control={control}
                          render={({ field: phoneField }) => (
                            <PhoneInputField
                              defaultCountry={defaultPhoneCountry}
                              value={phoneField.value || ''}
                              onChange={(v: string | undefined) => phoneField.onChange(v || '')}
                              onBlur={phoneField.onBlur}
                              error={Boolean(errorAtPath(errors, `additionalDrivers.${idx}.telephone`))}
                              placeholder="Telephone"
                            />
                          )}
                        />
                      </FormField>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {conditionalRequirements.length ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-700">Outstanding conditions</div>
            <ul className="mt-2 space-y-1">
              {conditionalRequirements.map((req) => (
                <li key={req.code} className="text-sm text-amber-800">{req.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {checking ? <div className="mt-4 text-xs font-semibold text-slate-500">Checking issue readiness...</div> : null}
      </div>

      {missingFields.length === 0 ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            All required fields are complete. You can continue to payment.
          </div>
        </div>
      ) : null}
    </div>
  );
}

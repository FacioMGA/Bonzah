/* @vitest-environment happy-dom */
/**
 * Regression test for bug #1 — Home wizard DOB silently rejected after
 * session hydration.
 *
 * Symptom (real user report): the policy-holder form shows a fully-filled
 * DOB with a green check, but clicking Continue surfaces
 * "Please enter your date of birth" in the error summary.
 *
 * Root-cause shape (see HomeQuoteWizard + WizardInput): RHF's
 * `form.reset(qd)` writes session data straight into the DOM input via
 * the registered ref, but `WizardInput`'s internal `liveValue` was
 * initialised once and never re-synced. The displayed checkmark and the
 * autosave path both leaned on `liveValue`, so a hydrated-but-untouched
 * DOB could end up persisted as `""` and rejected by the validator.
 *
 * What this test pins down:
 *   1. After session hydration via `form.reset(qd)`, the DOB DOM input
 *      reflects the hydrated value (proves the register/ref wiring is
 *      intact end-to-end).
 *   2. `validateForContext` for the `policy-holder` wizardStep — given
 *      `form.getValues()` exactly as it stands after hydration, with NO
 *      additional user interaction — does NOT report a DOB error.
 *
 * Both assertions failing on the same render is the bug. The first
 * assertion alone failing would mean the registration is broken; the
 * second alone failing would mean the validator (DOB) is broken. Keeping
 * them together documents the shape of the regression we're guarding.
 */
import { render } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateForContext, ValidationRegistry } from '@facio/validation/frontend';
import { homeValidationProfile } from '@facio/products';
import { PolicyHolderStep } from '../../../../shared/lib/wizard/steps/PolicyHolderStep';

beforeEach(() => {
  ValidationRegistry.register(homeValidationProfile);
});

afterEach(() => {
  ValidationRegistry._resetForTests();
});

interface HydratedHarnessProps {
  hydrate: Record<string, unknown>;
  onReady: (getValues: () => Record<string, unknown>) => void;
}

function HydratedHarness({ hydrate, onReady }: HydratedHarnessProps) {
  const form = useForm<Record<string, unknown>>({
    defaultValues: {
      proposer: {
        firstName: '', lastName: '', email: '', phone: '', dateOfBirth: '',
        nationality: '', domicileCountry: '', nif: '', marketingConsent: false,
        address: { line1: '', city: '', province: '', postcode: '', country: '' },
      },
    },
    mode: 'onChange',
  });

  // Mirror HomeQuoteWizard's hydration: form.reset(qd) after mount.
  useEffect(() => {
    form.reset(hydrate);
    onReady(() => form.getValues());
  }, [form, hydrate, onReady]);

  return (
    <FormProvider {...form}>
      <PolicyHolderStep
        include={{ dateOfBirth: true, nationality: true, domicileCountry: true, nif: true, marketingConsent: true }}
      />
    </FormProvider>
  );
}

describe('Home wizard — bug #1: hydrated DOB must validate without user interaction', () => {
  it('hydrated DOB is present in form state and passes policy-holder validation', async () => {
    const hydratedQuoteData = {
      proposer: {
        firstName: 'Uriel',
        lastName: 'Aharoni',
        email: 'uriel.aharony@gmail.com',
        phone: '+35712412414',
        dateOfBirth: '1987-04-18',
        nationality: 'Afghanistan',
        domicileCountry: 'Cyprus',
        nif: '124124124',
        marketingConsent: false,
        address: {
          line1: '20 HaKongres Street',
          city: 'Tel Aviv-Yafo',
          province: '',
          postcode: '5211801',
          country: 'Israel',
        },
      },
    };

    let capturedGetValues: (() => Record<string, unknown>) | null = null;
    const { container } = render(
      <HydratedHarness
        hydrate={hydratedQuoteData}
        onReady={(getValues) => { capturedGetValues = getValues; }}
      />,
    );

    // Wait for the post-mount hydration effect to flush.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(capturedGetValues, 'hydration effect did not run').not.toBeNull();

    const dobInput = container.querySelector<HTMLInputElement>('input[name="proposer.dateOfBirth"]');
    expect(dobInput, 'expected the date-of-birth input to be in the DOM').not.toBeNull();
    // Assertion 1: register/ref wiring delivered the hydrated value to
    // the actual DOM input. Since ABY-68 the field renders through the
    // `DateInput` primitive, which displays in `DD/MM/YYYY` while the
    // form state continues to hold ISO `YYYY-MM-DD` — both shapes are
    // checked so neither layer can silently drop the value.
    expect(dobInput?.value).toBe('18/04/1987');
    expect(capturedGetValues!()).toMatchObject({ proposer: { dateOfBirth: '1987-04-18' } });

    // Assertion 2: the validator the wizard uses on Continue, fed with
    // exactly what `form.getValues()` returns post-hydration, does not
    // report a DOB error.
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'policy-holder' },
      actor: 'customer',
      data: capturedGetValues!(),
    });

    expect(
      errors['proposer.dateOfBirth'],
      `unexpected DOB error after hydration; full errors=${JSON.stringify(errors)}`,
    ).toBeUndefined();
  });
});

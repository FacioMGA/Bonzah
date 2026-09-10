import { Controller, useFormContext } from 'react-hook-form';
import { Lock } from 'lucide-react';
import { hasSpecifiedHighRiskItems } from '@facio/products';
import { BooleanRadio, FormField, SectionCard, WizardTextarea as Textarea } from '@/src/shared/ui';
import { getNestedError } from '@/src/shared/lib/wizard/utils/errors';

/**
 * Home wizard step 5 — Security.
 *
 * This step exists because issuance/readiness requires security answers
 * for the issued document pack. We intentionally keep it tiny and explicit
 * rather than trying to infer the answers from other sections.
 *
 * ABY-90 / ABY-92 / ABY-93 — Yes/No questions render as the canonical
 * `BooleanRadio` (two side-by-side tiles) instead of a `<Select>`,
 * cutting one redundant tap per question.
 */
export function Step5Security() {
  const { control, formState: { errors }, register, watch } = useFormContext();
  const hasAdditionalSecurity = watch('security.additionalSecurity') === true;
  // Section C — when the customer insures Specified High Risk Items they
  // must confirm there is a safe (Beazley AB106 Safe Conditions).
  const hasSpecifiedHighRisk = hasSpecifiedHighRiskItems({
    coverage: {
      allRiskJewellery: watch('coverage.allRiskJewellery'),
      specifiedItems: watch('coverage.specifiedItems'),
    },
  });
  const hasSafe = watch('security.safeOnPremises') === true;
  const getErrorMessage = (path: string): string | undefined =>
    getNestedError(errors as Record<string, unknown>, path);

  const renderBooleanRadio = (path: string, label: string, required = true) => (
    <FormField label={label} required={required} error={getErrorMessage(path)} fieldKey={path}>
      <Controller
        name={path}
        control={control}
        render={({ field }) => (
          <BooleanRadio
            name={field.name}
            value={typeof field.value === 'boolean' ? field.value : undefined}
            onChange={(next) => field.onChange(next)}
            error={!!getErrorMessage(path)}
          />
        )}
      />
    </FormField>
  );

  return (
    <SectionCard title="Security" icon={<Lock className="w-5 h-5" />}>
      <p className="text-sm font-semibold text-slate-500 -mt-4 mb-2">Tell us about the locks and window security at the property.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {renderBooleanRadio(
          'security.doorsFiveLeverLocks',
          'Do all main external doors have a five-lever mortice or multi-lever deadlock (BS 3621 or local equivalent), and do all other external or patio doors have equivalent locks, key-operated security devices, or top-and-bottom bolts?',
        )}
        {renderBooleanRadio(
          'security.windowsSecured',
          'Do all easily accessible windows have key-operated locks, securely locked shutters, or metal grilles embedded into the wall?',
        )}
        {renderBooleanRadio(
          'security.additionalSecurity',
          'Is there other security at the premises?',
        )}
      </div>

      {hasAdditionalSecurity ? (
        <div className="mt-4">
          <FormField
            label="Other security details"
            required
            error={getErrorMessage('security.additionalSecurityDescription')}
            fieldKey="security.additionalSecurityDescription"
          >
            <Textarea
              rows={3}
              placeholder="For example: CCTV, monitored alarm, security patrols"
              error={!!getErrorMessage('security.additionalSecurityDescription')}
              {...register('security.additionalSecurityDescription')}
            />
          </FormField>
        </div>
      ) : null}

      {hasSpecifiedHighRisk ? (
        <div className="mt-6 space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-semibold text-amber-800">
            You have insured Specified High Risk Items, so these must be kept in a safe at the premises. Please confirm the safe below — the AB106 Safe Conditions clause is then added to your policy.
          </p>
          {renderBooleanRadio('security.safeOnPremises', 'Is there a safe at the premises for the specified high risk items?')}
          {hasSafe ? (
            <FormField
              label="Safe details"
              required
              error={getErrorMessage('security.safeDescription')}
              fieldKey="security.safeDescription"
            >
              <Textarea
                rows={3}
                placeholder="For example: floor-anchored safe in the master bedroom, over 100kg"
                error={!!getErrorMessage('security.safeDescription')}
                {...register('security.safeDescription')}
              />
            </FormField>
          ) : null}
        </div>
      ) : null}
    </SectionCard>
  );
}

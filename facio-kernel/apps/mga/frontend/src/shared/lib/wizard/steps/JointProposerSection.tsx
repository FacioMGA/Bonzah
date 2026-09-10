import { useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import { Button } from '@/src/shared/ui';
import { PolicyHolderStep, type PolicyHolderStepProps } from './PolicyHolderStep';

type UnknownRecord = Record<string, unknown>;

function holderRows(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.map((row) => (row && typeof row === 'object' && !Array.isArray(row) ? row as UnknownRecord : {}))
    : [];
}

export function JointProposerSection(props: Omit<PolicyHolderStepProps, 'pathPrefix'>) {
  const { watch, setValue } = useFormContext();
  const watchedPolicyHolders = watch('policyHolders');
  const policyHolders = useMemo(() => holderRows(watchedPolicyHolders), [watchedPolicyHolders]);

  const setPolicyHolders = (next: UnknownRecord[]) => {
    setValue('policyHolders', next, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
  };

  // ABY-234 — `mb-8` mirrors `SectionCard`'s bottom margin so the
  // "+ Add joint proposer" button breathes the same 32px before the
  // next section (Identification or Marketing & Privacy) as every
  // other section on the policy-holder step. Without it the button
  // collides with the next SectionCard's title.
  return (
    <div className="mt-8 mb-8 space-y-6">
      {policyHolders.map((_, index) => (
        <div key={index} className="rounded-3xl border border-slate-200 bg-white/70 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Joint Proposer</div>
              <div className="text-sm font-black text-slate-900">Joint proposer {index + 1}</div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setPolicyHolders(policyHolders.filter((__, holderIndex) => holderIndex !== index))}
              className="h-9 rounded-2xl px-4 text-[10px] font-black uppercase tracking-widest"
            >
              Remove
            </Button>
          </div>
          <PolicyHolderStep {...props} pathPrefix={`policyHolders.${index}`} />
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="md"
        onClick={() => setPolicyHolders([...policyHolders, { address: {} }])}
        className="h-11 rounded-2xl border-brand-primary/25 bg-brand-primary/5 px-5 text-[11px] font-black uppercase tracking-widest text-brand-primary hover:border-brand-primary/40 hover:bg-brand-primary/10"
      >
        + Add joint proposer
      </Button>
    </div>
  );
}

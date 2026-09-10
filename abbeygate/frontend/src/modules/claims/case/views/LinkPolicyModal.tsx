import React, { useMemo, useState } from 'react';
import { Modal } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { SearchableSelect } from '@/src/shared/ui';

type PolicyOption = { id: string; policyNumber: string; insuredName: string };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  busy: boolean;
  policies: PolicyOption[];
  onConfirm: (policyId: string) => void;
};

export function LinkPolicyModal({ isOpen, onClose, busy, policies, onConfirm }: Props) {
  const [policyId, setPolicyId] = useState('');
  const options = useMemo(
    () => policies.map((policy) => ({ value: policy.id, label: [policy.policyNumber, policy.insuredName].filter(Boolean).join(' • ') || policy.id })),
    [policies],
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Link to policy"
      allowOverflow
      actions={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => onConfirm(policyId)} disabled={!policyId} isLoading={busy}>Confirm link</Button>
        </>
      )}
    >
      <div className="space-y-3">
        <div className="text-sm font-semibold text-slate-700">Search and select the policy for this case.</div>
        <SearchableSelect
          value={policyId}
          onChange={setPolicyId}
          options={options}
          placeholder="Select policy"
          searchPlaceholder="Search by policy number or insured name"
          disabled={busy}
        />
      </div>
    </Modal>
  );
}


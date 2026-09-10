import React from 'react';
import type { JsonObject } from '@/src/modules/programs/components/StructuredJsonEditor';
import { ConfiguredUnderwritingEditor } from '@/src/modules/programs/configuration/ConfiguredUnderwritingEditor';

const fields = [
  { key: 'maxInsuredAge', label: 'Maximum insured age', description: 'Insured persons above this age cannot receive automatic cover.', kind: 'number' },
  { key: 'referInsuredAge', label: 'Insured age for referral', description: 'Insured persons at or above this age require review.', kind: 'number' },
  { key: 'allowedResidenceCountries', label: 'Allowed residence countries', description: 'Countries where Immigration Medical cover may be offered.', kind: 'string-list' },
] as const;

export function HealthUnderwritingEditor({ value, onChange }: { value: JsonObject; onChange: (next: JsonObject) => void }) {
  return <ConfiguredUnderwritingEditor title="Health" fields={[...fields]} value={value} onChange={onChange} />;
}

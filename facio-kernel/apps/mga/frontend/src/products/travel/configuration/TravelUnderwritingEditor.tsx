import React from 'react';
import type { JsonObject } from '@/src/modules/programs/components/StructuredJsonEditor';
import { ConfiguredUnderwritingEditor } from '@/src/modules/programs/configuration/ConfiguredUnderwritingEditor';

const fields = [
  { key: 'maxTravellerAge', label: 'Maximum traveller age', description: 'Travellers above this age cannot receive automatic cover.', kind: 'number' },
  { key: 'referTravellerAge', label: 'Traveller age for referral', description: 'Travellers at or above this age require review.', kind: 'number' },
  { key: 'minOnlinePolicyholderAge', label: 'Minimum online policyholder age', description: 'Policyholders below this age are referred.', kind: 'number' },
  { key: 'excludedDestinations', label: 'Excluded destinations', description: 'Destinations that cannot receive automatic cover.', kind: 'string-list' },
  { key: 'maxTripDurationDays', label: 'Maximum trip duration', description: 'Trips exceeding this number of days are referred.', kind: 'number' },
  { key: 'disallowMedicalInCountryOfResidence', label: 'Exclude medical cover in country of residence', description: 'Whether medical treatment in the customer’s country of residence is excluded.', kind: 'boolean' },
] as const;

export function TravelUnderwritingEditor({ value, onChange }: { value: JsonObject; onChange: (next: JsonObject) => void }) {
  return <ConfiguredUnderwritingEditor title="Travel" fields={[...fields]} value={value} onChange={onChange} />;
}

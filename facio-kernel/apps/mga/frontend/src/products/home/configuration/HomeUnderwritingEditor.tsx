import React from 'react';
import type { JsonObject } from '@/src/modules/programs/components/StructuredJsonEditor';
import { ConfiguredUnderwritingEditor } from '@/src/modules/programs/configuration/ConfiguredUnderwritingEditor';

const fields = [
  { key: 'allowedPropertyTypes', label: 'Allowed property types', description: 'Property types accepted by the automatic Home appetite.', kind: 'string-list' },
  { key: 'allowedRiskCountries', label: 'Allowed risk countries', description: 'Countries where the Home risk may be located.', kind: 'string-list' },
  { key: 'maxBuildingsSumInsured', label: 'Maximum buildings sum insured', description: 'Referral threshold for buildings.', kind: 'number', optional: true },
  { key: 'maxContentsSumInsured', label: 'Maximum contents sum insured', description: 'Referral threshold for contents.', kind: 'number', optional: true },
  { key: 'maxAllRisksUnspecifiedSumInsured', label: 'Maximum unspecified all-risks sum insured', description: 'Referral threshold for unspecified all-risks cover.', kind: 'number', optional: true },
  { key: 'maxSolarPanelsSumInsured', label: 'Maximum solar-panels sum insured', description: 'Referral threshold for solar panels.', kind: 'number', optional: true },
  { key: 'declineClaimsCountOver', label: 'Decline claims threshold', description: 'Claims count above this threshold is not automatically accepted.', kind: 'number' },
  { key: 'referClaimsCountAtLeast', label: 'Refer claims threshold', description: 'Claims count at or above this threshold requires review.', kind: 'number' },
  { key: 'combustibleConstructionRefer', label: 'Refer combustible construction', description: 'Whether combustible construction must be referred.', kind: 'boolean' },
  { key: 'greekPostcodeDecline', label: 'Excluded Greek postcodes', description: 'Postcodes that cannot receive an automatic quote.', kind: 'string-list' },
] as const;

export function HomeUnderwritingEditor({ value, onChange }: { value: JsonObject; onChange: (next: JsonObject) => void }) {
  return <ConfiguredUnderwritingEditor title="Home" fields={[...fields]} value={value} onChange={onChange} />;
}

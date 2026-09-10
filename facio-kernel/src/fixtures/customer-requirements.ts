import bonzahIntake from '../../tenant-packages/source-requirements/bonzah.json' with { type: 'json' };
import ueIntake from '../../tenant-packages/source-requirements/ue.json' with { type: 'json' };
import vuwIntake from '../../tenant-packages/source-requirements/vuw.json' with { type: 'json' };
import {
  requirementsProfileSchema,
  type ScopedRequirementsProfile,
} from '../contracts/requirements.js';
import { hash } from '../domain/canonical.js';

// Local source intake packages only. These are not customer configurations or golden cases.
// Legal entity, region, product and operating identifiers remain unassigned until configured.
export const customerRequirementsProfiles: ScopedRequirementsProfile[] = [
  { tenantId: 'bonzah-intake', source: bonzahIntake },
  { tenantId: 'ue-intake', source: ueIntake },
  { tenantId: 'vuw-intake', source: vuwIntake },
].map(({ tenantId, source }) => {
  const profile = requirementsProfileSchema.parse(source);
  return {
    scope: {
      workspaceId: 'local',
      tenantId,
      environment: 'development',
      operatingEntityId: 'unassigned',
    },
    profile,
    sourceProfileHash: hash(profile),
  };
});

import { ManifestRuntimeProductAdapter } from '../../modules/policy/domain/ManifestRuntimeProductAdapter.js';
import { healthProductRuntimeConfig } from './runtime.js';
import { HEALTH_ENDORSEMENT_GROUPS, HEALTH_ENDORSEMENT_TEMPLATES } from './endorsementTemplates.js';
import { HEALTH_DOCUMENT_PACK_CONTRACT } from './documents/documentPackContract.js';
import { staticIpidAssetFromContract } from '../shared/documents/productDocumentPackContract.js';
import type { EndorsementGroup, ProductIpidAsset } from '../../modules/policy/domain/productContracts.js';
import type { EndorsementTemplate } from '../../modules/mbe/domain/types.js';

/**
 * HEALTH (Brit Immigration Medical) product adapter.
 *
 * Thin wrapper that exposes the hand-curated endorsement catalog —
 * the heavy lifting (rating, UW, wording, doc-pack) is delegated to
 * `healthProductRuntimeConfig` via `ManifestRuntimeProductAdapter`.
 *
 * Endorsement catalog is hand-curated (not manifest-synthesised) so we
 * can carry the GHS `selectedWhen` rule on `HEALTH-GHS-EXTENSION`. The
 * MBE coverage resolver, BO Programs > Coverage tab, and PDF schedule
 * all consume this same catalog — one source of truth.
 */
export class HealthProductAdapter extends ManifestRuntimeProductAdapter {
  constructor() {
    super(healthProductRuntimeConfig);
  }

  // Single-asset Brit Immigration Health IPID; does not vary by territory.
  resolveIpidAsset(): ProductIpidAsset | null {
    return staticIpidAssetFromContract(HEALTH_DOCUMENT_PACK_CONTRACT);
  }

  getEndorsementCatalog(): EndorsementTemplate[] {
    return HEALTH_ENDORSEMENT_TEMPLATES;
  }

  getEndorsementTemplate(code: string): EndorsementTemplate | undefined {
    return HEALTH_ENDORSEMENT_TEMPLATES.find((template) => template.code === code);
  }

  getEndorsementGroups(): EndorsementGroup[] {
    return HEALTH_ENDORSEMENT_GROUPS.map((group) => ({ ...group, templates: [...group.templates] }));
  }
}

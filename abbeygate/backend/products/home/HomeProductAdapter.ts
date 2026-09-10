import { ManifestRuntimeProductAdapter } from '../../modules/policy/domain/ManifestRuntimeProductAdapter.js';
import { homeProductRuntimeConfig } from './runtime.js';
import { HOME_ENDORSEMENT_GROUPS, HOME_ENDORSEMENT_TEMPLATES } from './endorsementTemplates.js';
import { resolveHomeIpid } from './documents/policyWording.js';
import type { EndorsementGroup, ProductIpidAsset } from '../../modules/policy/domain/productContracts.js';
import type { EndorsementTemplate } from '../../modules/mbe/domain/types.js';

export class HomeProductAdapter extends ManifestRuntimeProductAdapter {
  constructor() {
    super(homeProductRuntimeConfig);
  }

  // Territory-aware (ADR-0048): Greece has its own IPID; CY/PT share the
  // combined Cyprus/Greece IPID. Throws for an unconfigured territory rather
  // than defaulting — the public route turns that into a 404.
  resolveIpidAsset(countryCode: string): ProductIpidAsset | null {
    const asset = resolveHomeIpid(countryCode);
    return { absolutePath: asset.staticPdfPath, filename: asset.filename };
  }

  getEndorsementCatalog(): EndorsementTemplate[] {
    return HOME_ENDORSEMENT_TEMPLATES;
  }

  getEndorsementTemplate(code: string): EndorsementTemplate | undefined {
    return HOME_ENDORSEMENT_TEMPLATES.find((template) => template.code === code);
  }

  getEndorsementGroups(): EndorsementGroup[] {
    return HOME_ENDORSEMENT_GROUPS.map((group) => ({ ...group, templates: [...group.templates] }));
  }
}


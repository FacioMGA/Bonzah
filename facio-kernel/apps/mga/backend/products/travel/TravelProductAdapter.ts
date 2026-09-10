import { ManifestRuntimeProductAdapter } from '../../modules/policy/domain/ManifestRuntimeProductAdapter.js';
import { travelProductRuntimeConfig } from './runtime.js';
import { TRAVEL_ENDORSEMENT_GROUPS, TRAVEL_ENDORSEMENT_TEMPLATES } from './endorsementTemplates.js';
import { resolveTravelIpid } from './documents/ipid.js';
import { parseRecord } from '../../platform/json/parseRecord.js';
import type {
  EndorsementGroup,
  ProductIpidAsset,
  ProductIpidSelectionContext,
  ProductQuoteEmailPresentation,
} from '../../modules/policy/domain/productContracts.js';
import type { EndorsementTemplate } from '../../modules/mbe/domain/types.js';

export class TravelProductAdapter extends ManifestRuntimeProductAdapter {
  constructor() {
    super(travelProductRuntimeConfig);
  }

  resolveIpidAsset(_countryCode: string, selection?: ProductIpidSelectionContext): ProductIpidAsset {
    const asset = resolveTravelIpid(selection);
    return { absolutePath: asset.staticPdfPath, filename: asset.filename };
  }

  buildQuoteEmailPresentation(quoteData: unknown): ProductQuoteEmailPresentation {
    const data = parseRecord(quoteData);
    const quote = parseRecord(data.quote);
    const trip = parseRecord(data.trip);
    const plan = String(quote.selectedPlan || '').trim().toLowerCase();
    const tripType = String(trip.planType || '').trim().toLowerCase();
    const planLabel = { silver: 'Silver', gold: 'Gold', platinum: 'Platinum' }[plan];
    const tripTypeLabel = { single_trip: 'Single Trip', annual_multi_trip: 'Annual Multi-Trip' }[tripType];
    if (!planLabel || !tripTypeLabel) {
      throw new Error('Travel quote email requires a selected plan and trip type');
    }
    return {
      coverLabel: `${planLabel} — ${tripTypeLabel}`,
      // Brit Travel policy wording: excess per insured person, per section;
      // Personal Liability carries the separate EUR 250 excess.
      excessLabel: '€100 per insured person per section (€250 Personal Liability)',
    };
  }

  getEndorsementCatalog(): EndorsementTemplate[] {
    return TRAVEL_ENDORSEMENT_TEMPLATES;
  }

  getEndorsementTemplate(code: string): EndorsementTemplate | undefined {
    return TRAVEL_ENDORSEMENT_TEMPLATES.find((template) => template.code === code);
  }

  getEndorsementGroups(): EndorsementGroup[] {
    return TRAVEL_ENDORSEMENT_GROUPS.map((group) => ({ ...group, templates: [...group.templates] }));
  }
}

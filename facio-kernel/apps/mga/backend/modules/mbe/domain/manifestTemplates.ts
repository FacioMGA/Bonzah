/**
 * Manifest-driven MBE template synthesis.
 *
 * For products other than MOTOR, the MBE endorsement catalog is not hand-curated
 * in `endorsementTemplates.ts` — instead it is derived from the product's
 * declarative `manifest.coverageCatalog` + `manifest.documentTypes`. This keeps
 * the BO coverage tab product-agnostic: a HOME policy shows HOME coverages,
 * a TRAVEL policy shows TRAVEL addons, etc.
 */
import type { EndorsementTemplate } from './types.js';
import type { CoverageSpec, ProductManifest } from '@facio/products';

function fieldTypeToUi(type: string): string {
  switch (type) {
    case 'currency':
      return 'currency';
    case 'number':
    case 'percent':
      return 'number';
    case 'boolean':
      return 'checkbox';
    case 'date':
      return 'date';
    case 'select':
      return 'select';
    case 'multiselect':
      return 'multiselect';
    case 'textarea':
      return 'textarea';
    default:
      return 'text';
  }
}

function scopeToMbeScope(scope: CoverageSpec['scope']): EndorsementTemplate['scope'] {
  // Manifest uses POLICY | RISK_OBJECT | OCCURRENCE; MBE scope union is
  // POLICY | VEHICLE | DRIVER | COVER. Treat RISK_OBJECT/OCCURRENCE as COVER
  // for non-motor products (they're per-coverage toggles, not motor-specific
  // vehicle/driver scopes).
  return scope === 'POLICY' ? 'POLICY' : 'COVER';
}

/**
 * Build an EndorsementTemplate list for a product from its manifest.
 * Each CoverageSpec becomes one COVERAGE-type template with a light rules shape;
 * consumers (MagicBService) treat these as simple "toggle + params" coverages.
 */
export function buildTemplatesFromManifest(manifest: ProductManifest): EndorsementTemplate[] {
  const productCode = String(manifest.productType || '').toLowerCase();
  return manifest.coverageCatalog.map<EndorsementTemplate>((spec) => ({
    id: `tmpl-${spec.code}`.toLowerCase(),
    program_code: `abbeygate_${productCode}`,
    code: spec.code,
    title: spec.label,
    summary: spec.description || spec.label,
    type: 'COVERAGE',
    scope: scopeToMbeScope(spec.scope),
    jurisdiction: ['CY'],
    legal_text: spec.description || spec.label,
    parameters_schema: {
      type: 'object',
      properties: Object.fromEntries(
        (spec.paramsSchema || []).map((f) => [f.path, { type: f.type === 'number' || f.type === 'currency' || f.type === 'percent' ? 'number' : 'string' }]),
      ),
      required: (spec.paramsSchema || []).filter((f) => f.required).map((f) => f.path),
    },
    default_params: Object.fromEntries(
      (spec.paramsSchema || []).map((f) => [f.path, undefined as unknown]),
    ),
    rules: {
      prerequisites: [],
      exclusions: [],
      effects: [],
      approval: { requires_underwriter: false },
    },
    option_defaults: { enabledByDefault: Boolean(spec.required) },
    ui: {
      group: spec.group || 'extras',
      help_text: spec.description || '',
      form_fields: (spec.paramsSchema || []).map((f) => ({
        name: f.path,
        label: f.label,
        type: fieldTypeToUi(f.type),
        required: Boolean(f.required),
        options: Array.isArray(f.options) ? f.options.map((o) => o.value) : undefined,
      })),
    },
    document_template: `${productCode}-${spec.code.toLowerCase()}.html`,
    requires_underwriter_approval: false,
    allowed_with: [],
    disallowed_with: [],
  }));
}

/** Build group list from manifest coverage codes grouped by `group` field. */
export function buildGroupsFromManifest(manifest: ProductManifest): Array<{ id: string; title: string; templates: string[] }> {
  const byGroup = new Map<string, string[]>();
  for (const spec of manifest.coverageCatalog) {
    const g = (spec.group || 'extras').toLowerCase();
    const list = byGroup.get(g) || [];
    list.push(spec.code);
    byGroup.set(g, list);
  }
  return Array.from(byGroup.entries()).map(([id, templates]) => ({
    id,
    title: id === 'core' ? 'Core Cover' : id.charAt(0).toUpperCase() + id.slice(1),
    templates,
  }));
}

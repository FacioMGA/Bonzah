import type { EndorsementTemplate } from '../../mbe/domain/types.js';
import type { ResolvedCoverageSet } from '../../mbe/domain/programProduct.js';
import type { CoverageSelectionSnapshot, TruthfulCoverageContract } from './coverageSelectionContract.js';
import type { EndorsementGroup } from '../domain/productContracts.js';
import type { ProductManifest } from '@facio/products';

type UnknownRecord = Record<string, unknown>;

type EndorsementInstanceLike = {
  code?: string;
  targetId?: string | null;
  premiumDelta?: number | null;
  status?: string | null;
};

export type CoverageOptionsViewTargetOption = {
  id: string;
  label: string;
};

export type CoverageOptionsViewItem = {
  code: string;
  label: string;
  summary?: string;
  selected: boolean;
  params: UnknownRecord;
  premiumImpact: number | null;
  status: 'active' | 'pending' | 'included' | 'available';
  configurable: boolean;
  scope: string;
  targetOptions: CoverageOptionsViewTargetOption[];
  helpText?: string;
  legalText?: string;
  formFields?: Array<{ name: string; label: string; type: string; required: boolean; options?: string[] }>;
  defaultParams?: UnknownRecord;
  disallowedWith?: string[];
};

export type CoverageOptionsViewSection = {
  id: string;
  title: string;
  items: CoverageOptionsViewItem[];
};

export type CoverageOptionsView = {
  sections: CoverageOptionsViewSection[];
  savedSelection: CoverageSelectionSnapshot;
  resolvedCoverageSet: ResolvedCoverageSet;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return String(value).trim().length > 0;
}

function readPath(source: unknown, path: string): unknown {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((current, part) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
      return (current as UnknownRecord)[part];
    }, source);
}

function buildTargetOptions(manifest: ProductManifest, quoteData: unknown): CoverageOptionsViewTargetOption[] {
  const qd = asRecord(quoteData);
  if (Array.isArray(qd.riskObjects)) {
    return qd.riskObjects.map((value, index) => {
      const record = asRecord(value);
      const id = String(record.id || `obj_${index}`);
      const label = Object.values(record).filter(hasMeaningfulValue).slice(0, 3).map(String).join(' · ') || id;
      return { id, label };
    });
  }
  if (Array.isArray(qd.vehicles)) {
    return qd.vehicles.map((value, index) => {
      const record = asRecord(value);
      const id = String(record.id || `obj_${index}`);
      const label = [record.make, record.model, record.registrationNumber].filter(hasMeaningfulValue).map(String).join(' · ') || id;
      return { id, label };
    });
  }
  if (manifest.insuredObject.cardinality !== 'one') return [];

  const parts = manifest.insuredObject.fields
    .map((field) => readPath(qd, field.path))
    .filter(hasMeaningfulValue)
    .slice(0, 3)
    .map(String);
  if (!parts.length) return [];
  return [{ id: 'primary', label: parts.join(' · ') }];
}

function isObjectScoped(scope: string): boolean {
  const normalized = String(scope || '').trim().toUpperCase();
  return normalized === 'VEHICLE' || normalized === 'RISK_OBJECT';
}

function toPublicScope(scope: string): string {
  const normalized = String(scope || '').trim().toUpperCase();
  return normalized === 'VEHICLE' ? 'RISK_OBJECT' : normalized;
}

function toPublicFormFields(template: EndorsementTemplate): Array<{ name: string; label: string; type: string; required: boolean; options?: string[] }> {
  return (template.ui?.form_fields || []).map((field) => ({
    ...field,
    name: field.name === 'target_vehicle_id' ? 'targetId' : field.name,
    type: field.type === 'vehicle_select' ? 'risk_object_select' : field.type,
  }));
}

function resolvedDefaultSelection(contract: TruthfulCoverageContract, code: string): boolean {
  if (Object.prototype.hasOwnProperty.call(contract.selected, code)) {
    return Boolean(contract.selected[code]);
  }
  return Boolean(contract.defaults.selected[code]);
}

function resolvedParams(contract: TruthfulCoverageContract, template: EndorsementTemplate): UnknownRecord {
  const saved = Object.prototype.hasOwnProperty.call(contract.params, template.code)
    ? asRecord(contract.params[template.code])
    : null;
  if (saved) return saved;
  const defaults = Object.prototype.hasOwnProperty.call(contract.defaults.params, template.code)
    ? asRecord(contract.defaults.params[template.code])
    : null;
  if (defaults) return defaults;
  return asRecord(template.default_params);
}

function toPublicParams(params: UnknownRecord): UnknownRecord {
  // PR6: target_vehicle_id / target_risk_object_id / target_object_id legacy
  // ID bridges removed. Every writer now emits `targetId` directly.
  return { ...params };
}

function resolveItemStatus(args: {
  template: EndorsementTemplate;
  selected: boolean;
  instancesByCode: Map<string, EndorsementInstanceLike>;
  contract: TruthfulCoverageContract;
}): CoverageOptionsViewItem['status'] {
  const inst = args.instancesByCode.get(args.template.code);
  if (String(inst?.status || '').toUpperCase() === 'APPLIED') return 'active';
  if (String(inst?.status || '').toUpperCase() === 'PENDING') return 'pending';
  if (args.selected && !Object.prototype.hasOwnProperty.call(args.contract.selected, args.template.code)) return 'included';
  return 'available';
}

export function buildCoverageOptionsView(args: {
  manifest: ProductManifest;
  groups: EndorsementGroup[];
  templates: EndorsementTemplate[];
  contract: TruthfulCoverageContract;
  activeInstances: EndorsementInstanceLike[];
  quoteData: unknown;
}): CoverageOptionsView {
  const allowedCodes = new Set<string>([
    ...Object.keys(args.contract.defaults.selected || {}),
    ...Object.keys(args.contract.selected || {}),
  ]);
  const filteredTemplates = args.templates.filter((template) => allowedCodes.has(template.code));
  const templateByCode = new Map(filteredTemplates.map((template) => [template.code, template]));
  const instancesByCode = new Map<string, EndorsementInstanceLike>();
  for (const inst of args.activeInstances) {
    const code = String(inst.code || '').trim();
    if (!code || instancesByCode.has(code)) continue;
    instancesByCode.set(code, inst);
  }
  const targetOptions = buildTargetOptions(args.manifest, args.quoteData);
  const seenCodes = new Set<string>();

  const sections: CoverageOptionsViewSection[] = args.groups
    .map((group) => {
      const items = group.templates
        .map((code) => templateByCode.get(String(code)))
        .filter((template): template is EndorsementTemplate => Boolean(template))
        .filter((template) => {
          if (seenCodes.has(template.code)) return false;
          seenCodes.add(template.code);
          return true;
        })
        .map<CoverageOptionsViewItem>((template) => {
          const selected = resolvedDefaultSelection(args.contract, template.code);
          const params = toPublicParams(resolvedParams(args.contract, template));
          const inst = instancesByCode.get(template.code);
          const formFields = toPublicFormFields(template);
          const publicScope = toPublicScope(template.scope);
          const objectScoped = isObjectScoped(publicScope);
          return {
            code: template.code,
            label: template.title,
            summary: template.summary || template.ui?.help_text || undefined,
            selected,
            params,
            premiumImpact: Number.isFinite(Number(inst?.premiumDelta)) ? Number(inst?.premiumDelta) : null,
            status: resolveItemStatus({ template, selected, instancesByCode, contract: args.contract }),
            configurable: formFields.length > 0 || (objectScoped && targetOptions.length > 1),
            scope: publicScope,
            targetOptions: objectScoped ? targetOptions : [],
            helpText: template.ui?.help_text,
            legalText: template.legal_text,
            formFields,
            defaultParams: toPublicParams(asRecord(template.default_params)),
            disallowedWith: template.disallowed_with || [],
          };
        });
      return {
        id: String(group.id),
        title: String(group.title || group.id),
        items,
      };
    })
    .filter((section) => section.items.length > 0);

  const ungrouped = filteredTemplates
    .filter((template) => !seenCodes.has(template.code))
    .map<CoverageOptionsViewItem>((template) => {
      const selected = resolvedDefaultSelection(args.contract, template.code);
      const params = toPublicParams(resolvedParams(args.contract, template));
      const inst = instancesByCode.get(template.code);
      const formFields = toPublicFormFields(template);
      const publicScope = toPublicScope(template.scope);
      const objectScoped = isObjectScoped(publicScope);
      return {
        code: template.code,
        label: template.title,
        summary: template.summary || template.ui?.help_text || undefined,
        selected,
        params,
        premiumImpact: Number.isFinite(Number(inst?.premiumDelta)) ? Number(inst?.premiumDelta) : null,
        status: resolveItemStatus({ template, selected, instancesByCode, contract: args.contract }),
        configurable: formFields.length > 0 || (objectScoped && targetOptions.length > 1),
        scope: publicScope,
        targetOptions: objectScoped ? targetOptions : [],
        helpText: template.ui?.help_text,
        legalText: template.legal_text,
        formFields,
        defaultParams: toPublicParams(asRecord(template.default_params)),
        disallowedWith: template.disallowed_with || [],
      };
    });

  if (ungrouped.length) {
    sections.push({
      id: 'ungrouped',
      title: 'Ungrouped',
      items: ungrouped,
    });
  }

  return {
    sections,
    savedSelection: args.contract,
    resolvedCoverageSet: args.contract.resolvedCoverageSet,
  };
}

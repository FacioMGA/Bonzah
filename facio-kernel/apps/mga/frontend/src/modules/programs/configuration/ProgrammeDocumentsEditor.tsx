import React from 'react';
import { Button, Input } from '@/src/shared/ui';
import type { JsonObject, JsonValue } from '@/src/modules/programs/components/StructuredJsonEditor';

const BRAND_FIELDS = [
  ['brokerDisplayName', 'Broker display name'],
  ['brokerLegalName', 'Broker legal name'],
  ['brokerAddressMultiline', 'Broker address (multiline)'],
  ['brokerAddressOneLine', 'Broker address (one line)'],
  ['brokerRegulatoryLine', 'Regulatory line'],
  ['uwTeamName', 'Underwriting team name'],
  ['coverholderStatement', 'Coverholder statement'],
  ['dataControllerName', 'Data controller name'],
] as const;
const MOTOR_BRAND_FIELDS = [
  ['greenCardAuthority', 'Green Card authority'],
  ['greenCardIssuerName', 'Green Card issuer name'],
  ['greenCardIssuerAddress', 'Green Card issuer address'],
  ['uwSignatureAsset', 'Underwriting signature asset key'],
] as const;

function asObject(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asDocumentTypes(value: JsonValue | undefined): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null;
}

type DocumentSource = { documentType: string; sourceId: string; sourceVersion: string };

function asDocumentSources(value: JsonValue | undefined): DocumentSource[] | null {
  if (!Array.isArray(value)) return null;
  const sources: DocumentSource[] = [];
  for (const entry of value) {
    const source = asObject(entry);
    if (!source || typeof source.documentType !== 'string' || typeof source.sourceId !== 'string' || typeof source.sourceVersion !== 'string') return null;
    sources.push({ documentType: source.documentType, sourceId: source.sourceId, sourceVersion: source.sourceVersion });
  }
  return sources;
}

function blankDocuments(productType: string): JsonObject {
  const brand = Object.fromEntries([...BRAND_FIELDS, ...(productType === 'MOTOR' ? MOTOR_BRAND_FIELDS : [])].map(([key]) => [key, '']));
  return { productKit: { schemaVersion: 1, programCode: '', brand }, issuedPack: { requiredTypes: [] }, sources: [] };
}

/** Shared typed editor for legal product-kit copy and the issued-policy pack. */
export function ProgrammeDocumentsEditor({ productType, value, onChange }: { productType: string; value: JsonObject; onChange: (next: JsonObject) => void }) {
  const productKit = asObject(value.productKit);
  const issuedPack = asObject(value.issuedPack);
  const brand = productKit ? asObject(productKit.brand) : null;
  const requiredTypes = issuedPack ? asDocumentTypes(issuedPack.requiredTypes) : null;
  const sources = asDocumentSources(value.sources);
  if (!productKit || !issuedPack || !brand || !requiredTypes || !sources || productKit.schemaVersion !== 1 || typeof productKit.programCode !== 'string') return <section className="space-y-3"><div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Document pack</h3><p className="mt-1 text-xs font-semibold text-slate-500">Legal and customer-facing wording is set per published programme. Nothing is filled from another programme or tenant.</p></div><Button type="button" variant="secondary" onClick={() => onChange(blankDocuments(productType))}>Start document-pack draft</Button></section>;
  const allBrandFields = [...BRAND_FIELDS, ...(productType === 'MOTOR' ? MOTOR_BRAND_FIELDS : [])];
  const updateKit = (next: JsonObject) => onChange({ ...value, productKit: next });
  const updateIssuedPack = (next: JsonObject) => onChange({ ...value, issuedPack: next });
  const updateSources = (next: DocumentSource[]) => onChange({ ...value, sources: next });
  return <section className="space-y-5"><div><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Document pack</h3><p className="mt-1 text-xs font-semibold text-slate-500">These published fields supply approved legal identity and issued-policy document selection.</p></div><div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Programme kit code</p><Input value={productKit.programCode as string} onChange={(event) => updateKit({ ...productKit, programCode: event.target.value })} aria-label="Document programme kit code" /></div><div className="grid grid-cols-1 gap-4 md:grid-cols-2">{allBrandFields.map(([key, label]) => <div className="space-y-2" key={key}><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p><Input value={typeof brand[key] === 'string' ? brand[key] : ''} onChange={(event) => updateKit({ ...productKit, brand: { ...brand, [key]: event.target.value } })} aria-label={label} /></div>)}</div><div className="space-y-3"><div><h4 className="text-xs font-black text-slate-800">Required issued documents</h4><p className="mt-1 text-xs font-semibold text-slate-500">Each type must be a registered document capability for this product. Publication validates the list.</p></div>{requiredTypes.map((type, index) => <div key={`document-${index}`} className="flex gap-3"><Input value={type} onChange={(event) => updateIssuedPack({ ...issuedPack, requiredTypes: requiredTypes.map((current, currentIndex) => currentIndex === index ? event.target.value : current) })} aria-label={`Required issued document ${index + 1}`} /><Button type="button" variant="ghost" size="sm" onClick={() => updateIssuedPack({ ...issuedPack, requiredTypes: requiredTypes.filter((_, currentIndex) => currentIndex !== index) })}>Remove</Button></div>)}<Button type="button" variant="secondary" size="sm" onClick={() => updateIssuedPack({ ...issuedPack, requiredTypes: [...requiredTypes, ''] })}>Add document type</Button></div><div className="space-y-3"><div><h4 className="text-xs font-black text-slate-800">Document sources</h4><p className="mt-1 text-xs font-semibold text-slate-500">Map every document type to its approved product source and version. This mapping is captured with each decision; a missing or mismatched source blocks publication and generation.</p></div>{sources.map((source, index) => <div key={`document-source-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3"><Input value={source.documentType} onChange={(event) => updateSources(sources.map((current, currentIndex) => currentIndex === index ? { ...current, documentType: event.target.value } : current))} aria-label={`Document source type ${index + 1}`} placeholder="Document type" /><Input value={source.sourceId} onChange={(event) => updateSources(sources.map((current, currentIndex) => currentIndex === index ? { ...current, sourceId: event.target.value } : current))} aria-label={`Document source capability ${index + 1}`} placeholder="Source capability" /><Input value={source.sourceVersion} onChange={(event) => updateSources(sources.map((current, currentIndex) => currentIndex === index ? { ...current, sourceVersion: event.target.value } : current))} aria-label={`Document source version ${index + 1}`} placeholder="Source version" /><Button type="button" variant="ghost" size="sm" onClick={() => updateSources(sources.filter((_, currentIndex) => currentIndex !== index))}>Remove</Button></div>)}<Button type="button" variant="secondary" size="sm" onClick={() => updateSources([...sources, { documentType: '', sourceId: '', sourceVersion: '' }])}>Add document source</Button></div></section>;
}

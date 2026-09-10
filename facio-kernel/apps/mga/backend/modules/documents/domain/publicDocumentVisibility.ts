export type ClientPublicDocumentInput = {
  docPack?: string | null;
  type?: string | null;
};

const PUBLIC_ISSUED_DOCUMENT_SUFFIXES = [
  '_CERTIFICATE_PDF',
  '_GREEN_CARD_PDF',
  '_SCHEDULE_PDF',
  '_STATEMENT_OF_FACT_PDF',
  '_IPID_PDF',
  '_POLICY_WORDING_PDF',
  '_EUROP_ASSISTANCE_PDF',
  '_WORDING_PDF',
] as const;

const CLIENT_PORTAL_ISSUED_DOCUMENT_SUFFIXES = [
  ...PUBLIC_ISSUED_DOCUMENT_SUFFIXES,
  '_MEDICAL_CARD_PDF',
] as const;

const CLIENT_PORTAL_ENDORSEMENT_DOCUMENT_SUFFIXES = [
  '_SCHEDULE_PDF',
] as const;

const BO_ONLY_DOCUMENT_TYPES = new Set([
  'CREDITSAFE_SANCTIONS_REPORT_PDF',
]);

export function isClientPublicDocument(doc: ClientPublicDocumentInput): boolean {
  const docPack = String(doc.docPack || '').toUpperCase();
  const type = String(doc.type || '').toUpperCase();
  const isPublicQuote = docPack === 'QUOTE_PACK' && type.endsWith('_QUOTE_PDF');
  const isPublicIssuedPolicyDoc =
    docPack === 'ISSUED_POLICY_PACK' &&
    PUBLIC_ISSUED_DOCUMENT_SUFFIXES.some((suffix) => type.endsWith(suffix));

  return isPublicQuote || isPublicIssuedPolicyDoc;
}

/**
 * Customer portal visibility is intentionally broader than an unauthenticated
 * public-link grant. The portal may serve every customer document declared by
 * issued and endorsement packs, while compliance evidence remains BO-only and
 * must never be exposed to the policyholder.
 */
export function isClientPortalDocument(doc: ClientPublicDocumentInput): boolean {
  const docPack = String(doc.docPack || '').toUpperCase();
  const type = String(doc.type || '').toUpperCase();
  if (BO_ONLY_DOCUMENT_TYPES.has(type)) return false;

  // A QUOTE_PACK is the canonical product-owned customer correspondence
  // boundary. Product contracts deliberately use their real document types
  // here (for example TRAVEL_CERTIFICATE_PDF and TRAVEL_IPID_PDF), rather
  // than a synthetic *_QUOTE_PDF type. Keep this authenticated portal grant
  // distinct from the narrower, expiring public-link predicate above.
  if (docPack === 'QUOTE_PACK') return true;
  if (docPack === 'ISSUED_POLICY_PACK') {
    return CLIENT_PORTAL_ISSUED_DOCUMENT_SUFFIXES.some((suffix) => type.endsWith(suffix));
  }
  if (docPack === 'ENDORSEMENT_PACK') {
    return CLIENT_PORTAL_ENDORSEMENT_DOCUMENT_SUFFIXES.some((suffix) => type.endsWith(suffix));
  }
  return false;
}

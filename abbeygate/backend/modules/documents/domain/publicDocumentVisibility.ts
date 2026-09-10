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

export function isClientPublicDocument(doc: ClientPublicDocumentInput): boolean {
  const docPack = String(doc.docPack || '').toUpperCase();
  const type = String(doc.type || '').toUpperCase();
  const isPublicQuote = docPack === 'QUOTE_PACK' && type.endsWith('_QUOTE_PDF');
  const isPublicIssuedPolicyDoc =
    docPack === 'ISSUED_POLICY_PACK' &&
    PUBLIC_ISSUED_DOCUMENT_SUFFIXES.some((suffix) => type.endsWith(suffix));

  return isPublicQuote || isPublicIssuedPolicyDoc;
}

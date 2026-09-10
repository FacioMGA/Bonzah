type UseCaseResult = {
  status: number;
  body: Record<string, unknown>;
};

export type PolicyDocumentListRow = {
  id: string;
  docPack: string | null;
  type: string | null;
  createdAt?: Date | string | null;
  status?: string | null;
  [key: string]: unknown;
};

export type ListPolicyDocumentsInput = {
  policyId: string;
  tenantId: string;
};

export type ListPolicyDocumentsRepoPort = {
  listDocumentsByPolicy(args: { policyId: string; tenantId: string }): Promise<PolicyDocumentListRow[]>;
};

export type ListPolicyDocumentsVisibilityPort = {
  isClientPublicDocument(doc: { docPack?: string | null; type?: string | null }): boolean;
};

const ISSUED_DOCUMENT_ORDER = [
  '_SCHEDULE_PDF',
  '_STATEMENT_OF_FACT_PDF',
  '_CERTIFICATE_PDF',
  '_GREEN_CARD_PDF',
  '_IPID_PDF',
  '_POLICY_WORDING_PDF',
  '_WORDING_PDF',
  '_EUROP_ASSISTANCE_PDF',
] as const;

function issuedDocumentRank(typeRaw: unknown): number {
  const type = String(typeRaw || '').toUpperCase();
  const index = ISSUED_DOCUMENT_ORDER.findIndex((suffix) => type.endsWith(suffix));
  return index >= 0 ? index : ISSUED_DOCUMENT_ORDER.length;
}

function timestamp(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const parsed = value ? new Date(String(value)).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareClientDocumentRows(a: PolicyDocumentListRow, b: PolicyDocumentListRow): number {
  const byPublicVisibility = Number(Boolean(b.publicUrl)) - Number(Boolean(a.publicUrl));
  if (byPublicVisibility !== 0) return byPublicVisibility;

  const aPack = String(a.docPack || '').toUpperCase();
  const bPack = String(b.docPack || '').toUpperCase();
  if (aPack === 'ISSUED_POLICY_PACK' && bPack === 'ISSUED_POLICY_PACK') {
    const byIssuedRank = issuedDocumentRank(a.type) - issuedDocumentRank(b.type);
    if (byIssuedRank !== 0) return byIssuedRank;
  }

  const byCreatedAtDesc = timestamp(b.createdAt) - timestamp(a.createdAt);
  if (byCreatedAtDesc !== 0) return byCreatedAtDesc;
  return String(a.filename || a.id).localeCompare(String(b.filename || b.id));
}

export async function listPolicyDocumentsUseCase(
  input: ListPolicyDocumentsInput,
  deps: {
    repo: ListPolicyDocumentsRepoPort;
    visibility: ListPolicyDocumentsVisibilityPort;
  }
): Promise<UseCaseResult> {
  const documents = await deps.repo.listDocumentsByPolicy({
    policyId: input.policyId,
    tenantId: input.tenantId,
  });
  const withPublicLinks = documents
    .map((doc) => ({
      ...doc,
      publicUrl: deps.visibility.isClientPublicDocument(doc) ? `/api/public/documents/${doc.id}` : null,
    }))
    .sort(compareClientDocumentRows);
  return { status: 200, body: { success: true, data: withPublicLinks } };
}

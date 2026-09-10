type UseCaseResult = {
  status: number;
  body: Record<string, unknown>;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as UnknownRecord;
}

function resolvePolicyholderEmail(args: {
  quoteData: UnknownRecord;
  policyHolderContactRaw: string;
}): string {
  const proposer = asRecord(args.quoteData.proposer);
  const quoteEmail = String(proposer.email || '').trim();
  if (quoteEmail) return quoteEmail;
  const raw = String(args.policyHolderContactRaw || '').trim();
  if (!raw) return '';
  try {
    const parsed = asRecord(JSON.parse(raw));
    const primary = asRecord(parsed.primary);
    return String(parsed.email || primary.email || '').trim();
  } catch {
    return raw.includes('@') ? raw : '';
  }
}

export type EmailPolicyDocumentsInput = {
  policyId: string;
  tenantId: string;
  documentIds: string[];
};

type PolicyDocumentRow = {
  id: string;
  filename: string | null;
  storageUri: string | null;
  type: string | null;
  docPack: string | null;
  status: string | null;
};

type PolicyRow = {
  id: string;
  policyNumber: string | null;
  quoteData: UnknownRecord;
  policyHolderName: string | null;
  policyHolderContactRaw: string;
};

export type EmailPolicyDocumentsRepoPort = {
  findPolicy(args: { policyId: string; tenantId: string }): Promise<PolicyRow | null>;
  findDocuments(args: { policyId: string; tenantId: string; documentIds: string[] }): Promise<PolicyDocumentRow[]>;
};

export type DocumentStorageGatewayPort = {
  fetchPdfBufferFromStorageUri(storageUri: string): Promise<Buffer | null>;
};

export type DocumentEmailGatewayPort = {
  sendRequestedDocumentsEmail(args: {
    toEmail: string;
    contactName: string;
    policyNumber: string;
    attachments: Array<{ filename: string; content: Buffer; contentType?: string }>;
    policyId?: string;
  }): Promise<boolean>;
};

export async function emailPolicyDocumentsUseCase(
  input: EmailPolicyDocumentsInput,
  deps: {
    repo: EmailPolicyDocumentsRepoPort;
    storage: DocumentStorageGatewayPort;
    notifications: DocumentEmailGatewayPort;
  }
): Promise<UseCaseResult> {
  const uniqueIds = Array.from(new Set(input.documentIds.map((x) => String(x).trim()).filter(Boolean)));
  if (uniqueIds.length === 0) {
    return { status: 400, body: { success: false, error: { code: 'BAD_REQUEST', message: 'documentIds is required' } } };
  }

  const policy = await deps.repo.findPolicy({ policyId: input.policyId, tenantId: input.tenantId });
  if (!policy) {
    return { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } } };
  }

  const toEmail = resolvePolicyholderEmail({
    quoteData: policy.quoteData,
    policyHolderContactRaw: policy.policyHolderContactRaw,
  });
  if (!toEmail) {
    return { status: 422, body: { success: false, error: { code: 'MISSING_EMAIL', message: 'Policyholder email not found' } } };
  }

  const proposer =
    policy.quoteData?.proposer && typeof policy.quoteData.proposer === 'object'
      ? (policy.quoteData.proposer as Record<string, unknown>)
      : {};
  const contactName =
    [String(proposer.firstName || '').trim(), String(proposer.lastName || '').trim()].filter(Boolean).join(' ').trim() ||
    String(policy.policyHolderName || '').trim() ||
    'there';

  const docs = await deps.repo.findDocuments({
    policyId: input.policyId,
    tenantId: input.tenantId,
    documentIds: uniqueIds,
  });
  if (docs.length === 0) {
    return { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: 'No matching documents found' } } };
  }

  const attachments: Array<{ filename: string; content: Buffer; contentType?: string }> = [];
  for (const doc of docs) {
    const status = String(doc.status || '').toUpperCase();
    if (status !== 'GENERATED') continue;
    const buffer = await deps.storage.fetchPdfBufferFromStorageUri(String(doc.storageUri || ''));
    if (!buffer) continue;
    attachments.push({
      filename: String(doc.filename || doc.type || 'Document.pdf'),
      content: buffer,
      contentType: 'application/pdf',
    });
  }

  if (attachments.length === 0) {
    return {
      status: 409,
      body: { success: false, error: { code: 'NOT_READY', message: 'Selected documents are not available to email yet' } },
    };
  }

  const ok = await deps.notifications.sendRequestedDocumentsEmail({
    toEmail,
    contactName,
    policyNumber: String(policy.policyNumber || input.policyId),
    attachments,
    policyId: input.policyId,
  });

  if (!ok) {
    return { status: 502, body: { success: false, error: { code: 'EMAIL_FAILED', message: 'Failed to send email' } } };
  }

  return { status: 200, body: { success: true, data: { sent: true, toEmail, count: attachments.length } } };
}

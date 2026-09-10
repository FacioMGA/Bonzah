export type PolicyDocLike = {
  id?: string | number | null;
  type?: string | null;
  status?: string | null;
  pack?: string | null;
  createdAt?: string | Date | null;
  riskTransactionId?: string | null;
};

export function generatedDocuments(docs: PolicyDocLike[]): PolicyDocLike[] {
  return docs.filter((d) => String(d?.status || 'GENERATED').toUpperCase() === 'GENERATED');
}

export function historyDocumentsForRiskTransaction(args: {
  docs: PolicyDocLike[];
  riskTransactionId: string;
  activeDocIds: Set<string>;
}): PolicyDocLike[] {
  const rtId = String(args.riskTransactionId || '').trim();
  if (!rtId) return [];
  return args.docs.filter((d) => {
    const docRt = String(d?.riskTransactionId || '').trim();
    if (docRt !== rtId) return false;
    const docId = String(d?.id || '').trim();
    const docType = String(d?.type || '').toUpperCase();
    if (!docId) return false;
    if (docType === 'MOTOR_ENDORSEMENT_SCHEDULE_PDF') return true;
    return !args.activeDocIds.has(docId);
  });
}

/** A quote PDF can never stand in for the exact retained issued version. */
export function documentForRole<T extends PolicyDocLike>(docs: T[], role: string, riskTransactionId: string | null): T | null {
  return docs.filter((doc) => String(doc.status || '').toUpperCase() === 'GENERATED'
    && String(doc.type || '').toUpperCase().includes(role.toUpperCase())
    && (riskTransactionId
      ? doc.pack === 'ISSUED_POLICY_PACK' && doc.riskTransactionId === riskTransactionId
      : doc.pack === 'QUOTE_PACK'))
    .sort((a,b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0] ?? null;
}

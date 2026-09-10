export type PolicyDocLike = {
  id?: string | number | null;
  type?: string | null;
  status?: string | null;
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

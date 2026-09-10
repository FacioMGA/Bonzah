import { useCallback, useEffect, useState } from 'react';
import { documentsApiClient } from '@/src/modules/policies/api/documentsApiClient';
import { getPolicyDocumentTypeLabel } from '@/src/modules/policies/model/policyDisplayLabels';

import { logger } from '@/src/shared/lib/logger';

type UnknownRecord = Record<string, unknown>;

type UsePolicyDocumentsTabArgs = {
  activeTab: string;
  selectedPolicyId?: string | null;
};

export function usePolicyDocumentsTab(args: UsePolicyDocumentsTabArgs) {
  const { activeTab, selectedPolicyId } = args;
  const [docs, setDocs] = useState<UnknownRecord[]>([]);

  const refreshPolicyDocuments = useCallback(async (policyId: string) => {
    try {
      const res = await documentsApiClient.listPolicyDocuments(policyId);
      if (res.success && res.data) {
        const docs = Array.isArray(res.data) ? res.data : [];
        setDocs(docs.map((d: UnknownRecord) => ({
          id: d.id,
          riskTransactionId: d.riskTransactionId || null,
          type: String(d.type || 'DOCUMENT'),
          pack: d.docPack || null,
          version: d.version || 1,
          status: d.status || 'GENERATED',
          title: d.filename || getPolicyDocumentTypeLabel(String(d.type || '')) || 'Document',
          createdAt: d.createdAt,
          url: d.storageUri || d.publicUrl || null,
          bordereauReady: d.bordereauReady,
          validationErrors: d.validationErrors,
          renderingInputsHash: d.renderingInputsHash,
        })));
      }
    } catch (err) {
      logger.error('Failed to load documents:', err);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'Documents') return;
    if (!selectedPolicyId) return;
    void refreshPolicyDocuments(String(selectedPolicyId));
  }, [activeTab, refreshPolicyDocuments, selectedPolicyId]);

  return {
    docs,
    refreshPolicyDocuments,
  };
}

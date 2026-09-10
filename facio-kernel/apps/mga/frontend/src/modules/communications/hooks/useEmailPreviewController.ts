import { useCallback, useEffect, useMemo, useState } from 'react';
import { emailPreviewApiClient } from '../api/emailPreviewApiClient';
import {
  EMAIL_PREVIEW_JURISDICTIONS,
  type DirectEmailProducer,
  type EmailCoverage,
  type EmailInventoryItem,
  type EmailLintFinding,
  type EmailPreviewJurisdiction,
  type EmailPreviewResult,
} from '../model/emailPreview';

/**
 * Controller for the Email Preview & Testing Centre. Owns all data loading,
 * selection, jurisdiction switching and the (audited) synthetic test-send
 * workflow so the BO surface page is a thin composition shell (surfaces
 * contract: no business logic in surfaces).
 */
export function useEmailPreviewController() {
  const [inventory, setInventory] = useState<EmailInventoryItem[]>([]);
  const [directProducers, setDirectProducers] = useState<DirectEmailProducer[]>([]);
  const [coverage, setCoverage] = useState<EmailCoverage | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [jurisdiction, setJurisdiction] = useState<EmailPreviewJurisdiction>('CY');
  const [preview, setPreview] = useState<EmailPreviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [toast, setToast] = useState('');

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [inv, cov] = await Promise.all([
        emailPreviewApiClient.getInventory(),
        emailPreviewApiClient.getCoverage(),
      ]);
      if (!inv.success) throw new Error(inv.error?.message || 'Failed to load inventory');
      const templates = inv.data?.triggerTemplates || [];
      setInventory(templates);
      setDirectProducers(inv.data?.directProducers || []);
      if (cov.success) setCoverage(cov.data || null);
      setSelected((prev) => prev || (templates.length > 0 ? templates[0].templateKey : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load email inventory');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPreview = useCallback(async (templateKey: string, juris: string) => {
    setPreviewLoading(true);
    try {
      const res = await emailPreviewApiClient.getPreview({ templateKey, jurisdiction: juris });
      if (!res.success) throw new Error(res.error?.message || 'Failed to render preview');
      setPreview(res.data || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to render preview');
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    if (selected) void loadPreview(selected, jurisdiction);
  }, [selected, jurisdiction, loadPreview]);

  const sendTest = useCallback(async () => {
    if (!preview) return;
    setTestBusy(true);
    setError('');
    try {
      const res = await emailPreviewApiClient.sendTest({
        templateKey: preview.templateKey,
        jurisdiction,
        toEmail: testEmail.trim(),
      });
      if (!res.success) throw new Error(res.error?.message || 'Test send blocked');
      setToast(`Test email queued (${res.data?.messageId || 'ok'}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test send failed');
    } finally {
      setTestBusy(false);
    }
  }, [preview, jurisdiction, testEmail]);

  const lintErrors = useMemo<EmailLintFinding[]>(
    () => (preview?.lint || []).filter((f) => f.severity === 'error'),
    [preview],
  );
  const lintWarnings = useMemo<EmailLintFinding[]>(
    () => (preview?.lint || []).filter((f) => f.severity === 'warning'),
    [preview],
  );

  return {
    jurisdictions: EMAIL_PREVIEW_JURISDICTIONS,
    inventory,
    directProducers,
    coverage,
    selected,
    jurisdiction,
    preview,
    loading,
    previewLoading,
    error,
    testEmail,
    testBusy,
    toast,
    lintErrors,
    lintWarnings,
    refresh: loadInventory,
    selectTemplate: setSelected,
    setJurisdiction,
    setTestEmail,
    sendTest,
    dismissToast: () => setToast(''),
  };
}

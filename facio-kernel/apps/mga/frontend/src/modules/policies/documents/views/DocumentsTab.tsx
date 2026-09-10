import React, { useEffect, useRef, useState } from 'react';
import { IconButton } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import { documentsApiClient } from '@/src/modules/policies/api/documentsApiClient';
import { policyCrudApiClient } from '@/src/modules/policies/api/policyCrudApiClient';
import { getPolicyDocumentTypeLabel } from '@/src/modules/policies/model/policyDisplayLabels';
import { logger } from '@/src/shared/lib/logger';
import { documentForRole, historyDocumentsForRiskTransaction } from '../model/documentsGrouping';
import { openSecureDocument } from '../openSecureDocument';

type PolicyDoc = {
  id?: string | number;
  url?: string | null;
  type?: string | null;
  pack?: string | null;
  status?: string | null;
  createdAt?: string | Date | null;
  version?: number | string | null;
  riskTransactionId?: string | null;
};

type PolicyVersion = {
  status?: string | null;
  transactionType?: string | null;
  transactionNumber?: number | string | null;
  riskTransactionId?: string | null;
  effectiveDate?: string | Date | null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function Documents(props: {
  policyId?: string | null;
  docs: PolicyDoc[];
  policyVersions: PolicyVersion[];
  setToastMessage?: (m: string) => void;
  setShowToast?: (v: boolean) => void;
  canViewDocuments?: boolean;
  canDownloadDocuments?: boolean;
  canGenerateDocuments?: boolean;
  onRefreshDocuments?: () => Promise<void> | void;
  onExternalIssuanceCompleted?: () => Promise<void> | void;
}) {
  const {
    policyId,
    docs,
    policyVersions,
    setToastMessage,
    setShowToast,
    canViewDocuments = true,
    canDownloadDocuments = true,
    canGenerateDocuments = false,
    onRefreshDocuments,
    onExternalIssuanceCompleted,
  } = props;
  const currentPolicyId = useRef(policyId); currentPolicyId.current = policyId;
  const [retryBusy,setRetryBusy] = useState(false);
  const [retryMessage,setRetryMessage] = useState('');
  useEffect(()=>{setRetryBusy(false);setRetryMessage('');setSelectedIds([]);},[policyId]);
  const retryIssuedPack = async () => {
    if(!policyId || !canGenerateDocuments || retryBusy)return;
    const requestedPolicy = policyId; setRetryBusy(true); setRetryMessage('');
    try {
      const response = await documentsApiClient.retryIssuedPack(requestedPolicy);
      if(currentPolicyId.current !== requestedPolicy)return;
      if(!response.success || response.data?.status !== 'queued')throw new Error(response.error?.message || 'The issued document request could not be queued.');
      setRetryMessage('Issued document request queued. Refresh documents to inspect the retained result. This does not send an email.');
      await onRefreshDocuments?.();
    }catch(error){if(currentPolicyId.current === requestedPolicy)setRetryMessage(error instanceof Error ? error.message : 'The request result is uncertain. Refresh documents before retrying.');}
    finally{if(currentPolicyId.current === requestedPolicy)setRetryBusy(false);}
  };
  const [docsHistoryOpen, setDocsHistoryOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [externalRequirements, setExternalRequirements] = useState<string[] | null>(null);
  const [externalDocumentTypes, setExternalDocumentTypes] = useState<string[]>([]);
  const [externalIssuanceRequiresUpload, setExternalIssuanceRequiresUpload] = useState(false);
  const [externalFiles, setExternalFiles] = useState<Record<string, File | null>>({});
  const [externalIssuanceSubmitting, setExternalIssuanceSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    if (!policyId) {
      setExternalRequirements(null);
      setExternalDocumentTypes([]);
      setExternalIssuanceRequiresUpload(false);
      return () => { active = false; };
    }
    void policyCrudApiClient.getExternalIssuanceRequirements(policyId)
      .then((response) => {
        if (!active) return;
        const data = response.success && response.data ? response.data : null;
        const documentTypes = Array.isArray(data?.documentTypes) ? data.documentTypes : [];
        setExternalDocumentTypes(documentTypes);
        setExternalIssuanceRequiresUpload(Boolean(data?.requiresUpload));
        setExternalRequirements(data?.canComplete ? documentTypes : null);
      })
      .catch(() => {
        if (active) {
          setExternalRequirements(null);
          setExternalDocumentTypes([]);
          setExternalIssuanceRequiresUpload(false);
        }
      });
    return () => { active = false; };
  }, [policyId]);

  const setExternalFile = (type: string, file: File | null) => {
    setExternalFiles((current) => ({ ...current, [type]: file }));
  };

  const submitExternalIssuance = async () => {
    if (!policyId || !externalRequirements) return;
    const documents = externalIssuanceRequiresUpload
      ? externalRequirements.map((type) => ({ type, file: externalFiles[type] || null }))
      : [];
    if (documents.some(({ file }) => !file)) return;
    setExternalIssuanceSubmitting(true);
    try {
      const response = await policyCrudApiClient.completeExternalIssuance(
        policyId,
        documents.map(({ type, file }) => ({ type, file: file! })),
      );
      if (!response.success) throw new Error(response.error?.message || 'External issuance could not be completed.');
      setExternalRequirements(null);
      setExternalFiles({});
      setToastMessage?.('External policy documents recorded and the policy is now active.');
      setShowToast?.(true);
      await onExternalIssuanceCompleted?.();
    } catch (error) {
      logger.error('Complete external issuance failed:', error);
      setToastMessage?.(error instanceof Error ? error.message : 'External issuance could not be completed.');
      setShowToast?.(true);
    } finally {
      setExternalIssuanceSubmitting(false);
    }
  };

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-300">
      {externalRequirements && (
        <section className="ui-table-wrap p-8 space-y-6" aria-label="Complete external issuance">
          <div>
            <div className="text-xs font-black text-slate-600 uppercase tracking-widest">
              {externalIssuanceRequiresUpload ? 'External insurer documents required' : 'External insurer documents recorded'}
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-600">
              {externalIssuanceRequiresUpload
                ? 'The customer has paid. Upload the insurer-issued PDF pack to activate the policy and send the customer their secure document access email.'
                : 'The insurer-issued PDF pack is already recorded. Resume activation and send the customer their secure document access email.'}
            </p>
          </div>
          {externalIssuanceRequiresUpload && (
            <div className="grid gap-4 md:grid-cols-2">
              {externalRequirements.map((type) => (
                <label key={type} className="block space-y-2 text-sm font-black text-slate-700">
                  {getPolicyDocumentTypeLabel(type)}
                  <Input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="block w-full text-sm font-semibold"
                    onChange={(event) => setExternalFile(type, event.currentTarget.files?.[0] || null)}
                  />
                </label>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={externalIssuanceSubmitting || (externalIssuanceRequiresUpload && externalRequirements.some((type) => !externalFiles[type]))}
              onClick={() => void submitExternalIssuance()}
            >
              {externalIssuanceSubmitting
                ? 'Recording insurer documents…'
                : externalIssuanceRequiresUpload
                  ? 'Activate policy and email documents'
                  : 'Resume activation and email documents'}
            </Button>
          </div>
        </section>
      )}
      {(() => {
        const addAuthToken = (url?: string | null) => {
          const v = String(url || '').trim();
          if (!v) return null;
          // Only append auth tokens to our secure local document route.
          // For Azure Blob/SAS URLs, adding extra query params can break access.
          if (!v.startsWith('/api/documents/')) return v;
          return v;
        };

        const fmtDate = (value: unknown) => {
          const d = new Date(String(value || ''));
          if (Number.isNaN(d.getTime())) return '—';
          return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
        };

        const policyDocs = Array.isArray(docs) ? docs : [];
        const generatedDocs = policyDocs.filter((d) => String(d?.status || 'GENERATED').toUpperCase() === 'GENERATED');
        const issuedVersions = (Array.isArray(policyVersions) ? policyVersions : [])
          .filter((v) =>
            String(v?.status || '').toUpperCase() === 'BOUND' &&
            ['INCEPTION', 'ENDORSEMENT', 'RENEWAL'].includes(String(v?.transactionType || '').toUpperCase())
          )
          .sort((a, b) => Number(b?.transactionNumber || 0) - Number(a?.transactionNumber || 0));

        const latestIssued = issuedVersions[0] || null;
        const transactionNoByRiskTransactionId = new Map<string, number>();
        for (const version of issuedVersions) {
          const rtId = String(version?.riskTransactionId || '').trim();
          const txNoRaw = Number(version?.transactionNumber || 0);
          if (!rtId || !Number.isFinite(txNoRaw) || txNoRaw <= 0) continue;
          if (!transactionNoByRiskTransactionId.has(rtId)) transactionNoByRiskTransactionId.set(rtId, txNoRaw);
        }
        const toEndorsementNumber = (transactionNumber: number | null) =>
          transactionNumber && Number.isFinite(transactionNumber)
            ? Math.max(0, transactionNumber - 1)
            : null;

        const latestRiskTransactionId = String(latestIssued?.riskTransactionId || '').trim() || null;
        const docByRole = (role: string) => documentForRole(generatedDocs, role, latestRiskTransactionId);
        const currentSchedule = docByRole('SCHEDULE_PDF');
        const certificate = docByRole('CERTIFICATE_PDF');
        const statementOfFact = docByRole('STATEMENT_OF_FACT_PDF');
        const greenCard = docByRole('GREEN_CARD_PDF');

        const currentIssuedOn = currentSchedule?.createdAt || certificate?.createdAt || null;
        const txNo = latestIssued?.transactionNumber ? Number(latestIssued.transactionNumber) : null;
        const endorsementNo = toEndorsementNumber(txNo);
        const latestIssuedType = String(latestIssued?.transactionType || '').toUpperCase();
        const versionLine =
          endorsementNo !== null
            ? `#${endorsementNo} (${endorsementNo === 0 ? 'Inception' : latestIssuedType === 'RENEWAL' ? 'Latest renewal' : 'Latest endorsement'})`
            : '—';

        const showToast = (msg: string) => {
          if (typeof setToastMessage === 'function') setToastMessage(msg);
          if (typeof setShowToast === 'function') setShowToast(true);
        };

        const asInlineViewHref = (href: string | null) => {
          const v = String(href || '').trim();
          if (!v) return null;
          // Local secure doc route supports inline=1 to open in-browser instead of downloading.
          if (v.includes('/api/documents/')) {
            return `${v}${v.includes('?') ? '&' : '?'}inline=1`;
          }
          return v;
        };

        const standardRows = [
          { key: 'schedule', name: latestIssued ? 'Policy Schedule' : 'Quote schedule (draft)', doc: currentSchedule },
          { key: 'certificate', name: 'Certificate of Insurance', doc: certificate },
          { key: 'sof', name: latestIssued ? 'Statement of Fact' : 'Quote statement of fact (draft)', doc: statementOfFact },
          ...(latestIssued ? [{key:'quote-schedule',name:'Quote schedule (draft)',doc:documentForRole(generatedDocs,'SCHEDULE_PDF',null)},{key:'quote-sof',name:'Quote statement of fact (draft)',doc:documentForRole(generatedDocs,'STATEMENT_OF_FACT_PDF',null)}].filter(row=>row.doc) : []),
          ...(greenCard?.url ? [{ key: 'green_card', name: 'Green Card', doc: greenCard }] : []),
        ].map((r) => {
          const href = r.doc?.url ? addAuthToken(r.doc.url) : null;
          const id = r.doc?.id ? String(r.doc.id) : '';
          const issueDate = r.doc?.createdAt || null;
          const documentRiskTransactionId = String(r.doc?.riskTransactionId || '').trim();
          const transactionNumber = documentRiskTransactionId
            ? (transactionNoByRiskTransactionId.get(documentRiskTransactionId) ?? null)
            : null;
          const endorsementNumber = toEndorsementNumber(transactionNumber);
          return { ...r, href, id, issueDate, endorsementNumber };
        });
        const externalDocumentTypeSet = new Set(externalDocumentTypes.map((type) => String(type).trim().toUpperCase()));
        const externallyIssuedRows = generatedDocs
          .filter((doc) => (
            String(doc.pack || '').trim().toUpperCase() === 'ISSUED_POLICY_PACK'
            && externalDocumentTypeSet.has(String(doc.type || '').trim().toUpperCase())
          ))
          .map((doc) => ({
            key: `issued-${String(doc.id || doc.type || doc.url || '')}`,
            name: getPolicyDocumentTypeLabel(String(doc.type || '')),
            doc,
            href: doc.url ? addAuthToken(doc.url) : null,
            id: String(doc.id || ''),
            issueDate: doc.createdAt || null,
            endorsementNumber: null,
          }));
        const currentRows = [...standardRows, ...externallyIssuedRows];
        const activeDocIds = new Set(
          currentRows
            .map((r) => String(r.id || '').trim())
            .filter(Boolean)
        );

        const selectableIds = currentRows
          .filter((r) => Boolean(r?.id) && Boolean(r?.href))
          .map((r) => String(r.id));

        const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));
        const anySelected = selectedIds.length > 0;

        const toggleAll = (checked: boolean) => {
          setSelectedIds(checked ? selectableIds : []);
        };

        const toggleOne = (id: string, checked: boolean) => {
          setSelectedIds((prev) => {
            const set = new Set(prev);
            if (checked) set.add(id);
            else set.delete(id);
            return Array.from(set);
          });
        };

        const downloadMany = (ids: string[]) => {
          if (!canDownloadDocuments) return;
          const idSet = new Set(ids);
          const hrefs = currentRows
            .filter((r) => idSet.has(String(r.id)) && r.href)
            .map((r) => String(r.href));
          if (hrefs.length === 0) return;
          hrefs.forEach((href) => {
            void openSecureDocument(href, { inline: false });
          });
        };

        const emailMany = async (ids: string[]) => {
          if (!policyId) return;
          const clean = Array.from(new Set(ids.map((x) => String(x || '').trim()).filter(Boolean)));
          if (clean.length === 0) return;
          try {
            setEmailSubmitting(true);
            const res = await documentsApiClient.emailPolicyDocuments(String(policyId), clean);
            if (!res.success) throw new Error(res.error?.message || 'Failed to email documents');
            showToast('Requested documents sent');
            setSelectedIds([]);
          } catch (e) {
            logger.error('Email documents failed:', e);
            showToast('Failed to send requested documents');
          } finally {
            setEmailSubmitting(false);
          }
        };

        return (
          <>
            <div className="space-y-4">
              <div className="mb-4 text-sm text-slate-600">{latestIssued ? (currentSchedule ? 'Issued documents are linked to the selected current policy version. Quote documents remain draft evidence.' : 'The issued document pack for the current policy version is not available. Any quote documents below are draft evidence.') : 'Quote documents are draft evidence. They do not confirm policy issuance.'}</div>

              {latestIssued && !currentSchedule ? <div className="mb-5 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm text-slate-600">Recovery uses the retained issued version and its document sources. Missing historical evidence blocks recovery; current drafts are never substituted.</p>
                <div className="flex flex-wrap gap-3">{canGenerateDocuments ? <Button onClick={()=>void retryIssuedPack()} disabled={retryBusy}>{retryBusy?'Requesting…':'Retry issued document pack'}</Button> : null}<Button variant="secondary" onClick={()=>void onRefreshDocuments?.()} disabled={retryBusy || !onRefreshDocuments}>Refresh documents</Button></div>
                {retryMessage ? <p role="status" className="text-sm text-slate-700">{retryMessage}</p> : null}
              </div> : null}
              {generatedDocs.length === 0 ? (
                <div className="ui-table-wrap">
                  <div className="px-10 py-6 bg-slate-50/60 border-b border-slate-200/60">
                    <div className="text-xs font-black text-slate-600 uppercase tracking-widest">Current policy documents</div>
                    <div className="mt-2 text-xs font-semibold text-slate-500">
                      <span className="font-black text-slate-600 uppercase tracking-widest text-xs">Issued on</span>
                      <span className="ml-2">{currentIssuedOn ? fmtDate(currentIssuedOn) : '—'}</span>
                      <span className="mx-3 text-slate-300">•</span>
                      <span className="font-black text-slate-600 uppercase tracking-widest text-xs">Version</span>
                      <span className="ml-2">{versionLine}</span>
                    </div>
                  </div>
                  <div className="px-10 py-16 text-center text-slate-400 font-semibold">
                    <div className="text-base font-black text-slate-500">No documents yet.</div>
                    <div className="mt-2 text-xs font-semibold text-slate-400">
                      Issued documents will appear here once the policy is bound/issued.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="ui-table-wrap">
                  <div className="px-10 py-5 bg-slate-50/60 border-b border-slate-200/60 flex items-center justify-between gap-6">
                    {/* Keep the header bar height stable; bulk actions render on the right */}
                    <div className="h-controlXs" aria-hidden />

                    <div className="flex items-center gap-3 min-h-controlXs">
                      {anySelected ? (
                        <>
                          {canDownloadDocuments && (
                            <Button
                              variant="secondary"
                              size="md"
                              className="gap-2 min-w-40 justify-center"
                              onClick={() => downloadMany(selectedIds)}
                            >
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v10m0 0l4-4m-4 4l-4-4" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 17v3h16v-3" />
                              </svg>
                              Download
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            size="md"
                            className="gap-2 min-w-40 justify-center"
                            disabled={!policyId || emailSubmitting}
                            onClick={() => void emailMany(selectedIds)}
                          >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h16v16H4V4z" opacity="0" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16v12H4V6z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7l8 6 8-6" />
                            </svg>
                            {emailSubmitting ? 'Sending…' : 'Email'}
                          </Button>
                        </>
                      ) : (
                        // Reserve space so header doesn't shift when bulk actions appear
                        <div className="h-controlXs" aria-hidden />
                      )}
                    </div>
                  </div>

                  <div className="overflow-auto">
                    <table className="ui-table min-w-full">
                      <thead className="ui-thead">
                        <tr>
                          <th className="px-10 py-6 w-[64px]">
                            <Input
                              type="checkbox"
                              className="rounded border-slate-300 text-brand-primary w-4 h-4 focus:ring-brand-primary"
                              checked={allSelected}
                              disabled={selectableIds.length === 0}
                              onChange={(e) => toggleAll((e.target as HTMLInputElement).checked)}
                              aria-label="Select all documents"
                              title="Select all"
                            />
                          </th>
                          <th className="px-10 py-6">Name</th>
                          <th className="px-10 py-6">Issue date</th>
                          <th className="px-10 py-6">Version</th>
                          <th className="px-10 py-6 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="ui-tbody">
                        {currentRows.map((r) => {
                          const id = String(r.id || '');
                          const isSelectable = Boolean(id) && Boolean(r.href);
                          const checked = Boolean(id) && selectedIds.includes(id);
                          const issueDateText = r.issueDate ? fmtDate(r.issueDate) : '—';
                          const versionText = r.endorsementNumber !== null ? `#${r.endorsementNumber}` : '—';
                          const href = r.href ? String(r.href) : null;
                          const viewHref = asInlineViewHref(href);

                          return (
                            <tr key={String(r.key)} className="ui-row">
                              <td className="px-10 py-6">
                                <Input
                                  type="checkbox"
                                  className="rounded border-slate-300 text-brand-primary w-4 h-4 focus:ring-brand-primary"
                                  checked={checked}
                                  disabled={!isSelectable}
                                  onChange={(e) => toggleOne(id, (e.target as HTMLInputElement).checked)}
                                  aria-label={`Select ${r.name}`}
                                />
                              </td>
                              <td className="px-10 py-6 font-black text-slate-900">{r.name}</td>
                              <td className="px-10 py-6 text-slate-600 font-semibold">{issueDateText}</td>
                              <td className="px-10 py-6 text-slate-600 font-semibold">{versionText}</td>
                              <td className="px-10 py-6">
                                <div className="flex items-center justify-end gap-3">
                                  {href ? (
                                    <>
                                      {canDownloadDocuments && (
                                        <IconButton
                                          title={`Download ${r.name}`}
                                          variant="neutral"
                                          className="w-10 h-10 rounded-2xl"
                                          onClick={() => { void openSecureDocument(href, { inline: false }); }}
                                        >
                                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v10m0 0l4-4m-4 4l-4-4" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 17v3h16v-3" />
                                          </svg>
                                        </IconButton>
                                      )}
                                      <IconButton
                                        title={`Email ${r.name}`}
                                        variant="neutral"
                                        className="w-10 h-10 rounded-2xl"
                                        disabled={!policyId || emailSubmitting || !id}
                                        onClick={() => void emailMany([id])}
                                      >
                                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16v12H4V6z" />
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 7l8 6 8-6" />
                                        </svg>
                                      </IconButton>
                                      {canViewDocuments && (
                                        <a
                                          href="#"
                                          onClick={(event) => {
                                            event.preventDefault();
                                            const popup = window.open('about:blank', '_blank');
                                            void openSecureDocument(viewHref || href, { inline: true, popup });
                                          }}
                                          className="text-xs font-black uppercase tracking-widest text-brand-primary hover:underline"
                                        >
                                          View
                                        </a>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-xs font-semibold text-slate-400">Not available</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <h3 className="text-xl font-bold text-slate-800">Endorsements &amp; History</h3>

              <div className="ui-table-wrap">
                <Button
                  type="button"
                  onClick={() => setDocsHistoryOpen((v) => !v)}
                  variant="ghost"
                  size="md"
                  className="w-full px-10 py-6 flex items-center justify-between gap-6 text-left bg-slate-50/60 border-b border-slate-200/60 hover:bg-slate-50/80 transition-colors rounded-none"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-base font-black text-slate-800 tracking-tight truncate">Issued versions</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs font-black uppercase tracking-widest text-slate-400">
                      {issuedVersions.length} total
                    </span>
                    <svg
                      className={`w-4 h-4 text-slate-400 transition-transform ${docsHistoryOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </Button>

                {docsHistoryOpen && (
                  <div className="bg-white/40">
                    {issuedVersions.length === 0 ? (
                      <div className="px-10 py-16 text-center text-slate-400 font-semibold">
                        <div className="text-base font-black text-slate-500">No issued versions found.</div>
                        <div className="mt-2 text-xs font-semibold text-slate-400">
                          Once the policy is issued (and endorsed), versions will appear here.
                        </div>
                      </div>
                    ) : (
                      <div className="overflow-auto">
                        <table className="ui-table min-w-full">
                          <thead className="ui-thead">
                            <tr>
                              <th className="px-10 py-6">Version</th>
                              <th className="px-10 py-6">Effective date</th>
                              <th className="px-10 py-6">What changed</th>
                              <th className="px-10 py-6">Documents</th>
                            </tr>
                          </thead>
                          <tbody className="ui-tbody">
                            {issuedVersions.map((v) => {
                              const type = String(v?.transactionType || '').toUpperCase();
                              const no = v?.transactionNumber ? Number(v.transactionNumber) : null;
                              const label =
                                type === 'INCEPTION'
                                  ? 'Original'
                                  : type === 'RENEWAL'
                                    ? (no ? `Renewal #${Math.max(1, no - 1)}` : 'Renewal')
                                  : (no ? `Endorsement #${Math.max(1, no - 1)}` : 'Endorsement');
                              const whatChanged = type === 'INCEPTION' ? 'Inception' : type === 'RENEWAL' ? 'Renewal' : 'Endorsement';
                              const historyDocs = historyDocumentsForRiskTransaction({
                                docs: generatedDocs,
                                riskTransactionId: String(v?.riskTransactionId || ''),
                                activeDocIds,
                              });

                              return (
                                <tr key={String(v?.riskTransactionId || label)} className="ui-row">
                                  <td className="px-10 py-6 font-black text-slate-900">{label}</td>
                                  <td className="px-10 py-6 text-slate-600 font-semibold">{fmtDate(v?.effectiveDate)}</td>
                                  <td className="px-10 py-6 text-slate-600 font-semibold">{whatChanged}</td>
                                  <td className="px-10 py-6">
                                    {historyDocs.length === 0 ? (
                                      <span className="text-xs font-semibold text-slate-400">No documents</span>
                                    ) : !canViewDocuments ? (
                                      <span className="text-xs font-semibold text-slate-400">Restricted</span>
                                    ) : (
                                      <div className="flex flex-wrap gap-2">
                                        {historyDocs.slice(0, 6).map((d) => {
                                          const href = addAuthToken(String(asRecord(d).url || ''));
                                          const docLabelText = getPolicyDocumentTypeLabel(String(d?.type || ''));
                                          return href && canViewDocuments ? (
                                            <a
                                              key={String(d?.id || href)}
                                              href="#"
                                              onClick={(event) => {
                                                event.preventDefault();
                                                const popup = window.open('about:blank', '_blank');
                                                void openSecureDocument(href, { inline: true, popup });
                                              }}
                                              className="px-3 py-2 rounded-2xl border border-slate-200/60 bg-white text-xs font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50/70 transition-colors"
                                            >
                                              {docLabelText}
                                            </a>
                                          ) : null;
                                        })}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}

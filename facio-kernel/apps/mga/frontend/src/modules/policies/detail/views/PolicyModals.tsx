import { getSelectedTenant } from '@/src/shared/lib/tenant/runtimeProfile';
import React, { useEffect, useState } from 'react';
import { programsApiClient } from '@/src/modules/programs/api/programsApiClient';
import { Modal } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import { Select } from '@/src/shared/ui';
import { Card } from '@/src/shared/ui';
import { policiesClient as api } from '@/src/modules/policies/api/policiesClient';
import { policyCrudApiClient } from '@/src/modules/policies/api/policyCrudApiClient';
import { ProductRegistry, readPath, formatCurrency } from '@/src/shared/lib/products';
import { buildEndorsementDraftSnapshotStub } from '@/src/modules/policies/model/policyPageHelpers';
import { productCatalog, isProductAvailableInCountry } from '@/src/products/catalog';
import { getOperatingCountryFromHost } from '@/src/shared/lib/tenant/operatingCountry';
import { PolicyWorkflowHistory } from './PolicyWorkflowHistory';

type SubmissionDraft = {
  insuredName: string;
  productType: string;
  segment: string;
  premium: string;
  agent: string;
};

type PolicyModalsProps = {
  // Align with PolicyPage state shapes.
  selectedPortfolio: { id?: string } | null;
  showQuoteModal: boolean;
  setShowQuoteModal: (show: boolean) => void;
  submissionSuccess: boolean;
  setSubmissionSuccess: (next: boolean) => void;
  handleCreateSubmission: () => void | Promise<void>;
  newQuote: SubmissionDraft;
  setNewQuote: React.Dispatch<React.SetStateAction<{ insuredName: string; productType: string; segment: string; premium: string; agent: string }>>;
  showPricingSteps: boolean;
  setShowPricingSteps: (show: boolean) => void;
  showHistoryModal: boolean;
  setShowHistoryModal: (show: boolean) => void;
  showTraceModal: boolean;
  setShowTraceModal: (show: boolean) => void;
  showRestoreVersionModal: boolean;
  setShowRestoreVersionModal: (show: boolean) => void;
  isRestoringVersion: boolean;
  setIsRestoringVersion: (next: boolean) => void;
  viewingVersionId: string | null;
  setViewingVersionId: (id: string | null) => void;
  setToastMessage: (message: string) => void;
  setShowToast: (show: boolean) => void;
  reloadCurrentPolicy: (opts?: { riskTransactionId?: string | null }) => Promise<void>;
  showCreateEndorsementModal: boolean;
  setShowCreateEndorsementModal: (show: boolean) => void;
  isCreatingEndorsementDraft: boolean;
  setIsCreatingEndorsementDraft: (next: boolean) => void;
  endorsementEffectiveDate: string;
  setEndorsementEffectiveDate: (value: string) => void;
  endorsementReason: string;
  setEndorsementReason: (value: string) => void;
  setPolicyVersions: React.Dispatch<React.SetStateAction<Array<Record<string, unknown>>>>;
  setViewingRiskTransactionId: (id: string | null) => void;
  setViewingRiskTransactionSnapshot: (snapshot: Record<string, unknown>) => void;
  setIsEditing: (next: boolean) => void;
  refreshIssueReadiness: (policyId: string, opts?: { riskTransactionId?: string | null }) => Promise<void> | void;
};

export function PolicyModals(props: PolicyModalsProps) {
  const currency = getSelectedTenant()?.profile.currency || '';
  const [availableProductTypes, setAvailableProductTypes] = useState<string[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');

  const {
    selectedPortfolio,
    showQuoteModal,
    setShowQuoteModal,
    submissionSuccess,
    setSubmissionSuccess,
    handleCreateSubmission,
    newQuote,
    setNewQuote,
    showPricingSteps,
    setShowPricingSteps,
    showHistoryModal,
    setShowHistoryModal,
    showTraceModal,
    setShowTraceModal,
    showRestoreVersionModal,
    setShowRestoreVersionModal,
    isRestoringVersion,
    setIsRestoringVersion,
    viewingVersionId,
    setViewingVersionId,
    setToastMessage,
    setShowToast,
    reloadCurrentPolicy,
    showCreateEndorsementModal,
    setShowCreateEndorsementModal,
    isCreatingEndorsementDraft,
    setIsCreatingEndorsementDraft,
    endorsementEffectiveDate,
    setEndorsementEffectiveDate,
    endorsementReason,
    setEndorsementReason,
    setPolicyVersions,
    setViewingRiskTransactionId,
    setViewingRiskTransactionSnapshot,
    setIsEditing,
    refreshIssueReadiness,
  } = props;
  useEffect(() => {
    if (!showQuoteModal) return;
    let active = true; setCatalogLoading(true); setCatalogError(''); setAvailableProductTypes([]);
    void programsApiClient.listPrograms().then(response => {
      if (!response.success || !response.data) throw new Error(response.error?.message || 'Registered programmes could not be loaded.');
      if (active) setAvailableProductTypes(response.data.filter(program => String(program.status).toUpperCase() === 'ACTIVE').map(program => String(program.productType).toUpperCase()));
    }).catch((failure: unknown) => { if (active) setCatalogError(failure instanceof Error ? failure.message : 'Registered programmes could not be loaded.'); }).finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [showQuoteModal]);

  return (
    <>
      <Modal
        isOpen={showQuoteModal}
        onClose={() => { setShowQuoteModal(false); setTimeout(() => setSubmissionSuccess(false), 300); }}
        title={submissionSuccess ? "Submission Received" : "New Submission"}
        actions={
          submissionSuccess ? (
            <Button type="button" variant="primary" size="md" onClick={() => { setShowQuoteModal(false); setTimeout(() => setSubmissionSuccess(false), 300); }} className="bg-brand-primary text-white px-8 py-3 rounded-xl font-black shadow-lg hover:bg-brand-secondary transition w-full">Done</Button>
          ) : (
            <>
              <Button type="button" variant="ghost" size="md" onClick={() => setShowQuoteModal(false)} className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition bg-transparent">Cancel</Button>
              <Button type="button" variant="primary" size="md" onClick={handleCreateSubmission} disabled={catalogLoading || !availableProductTypes.includes(newQuote.productType)} className="bg-brand-primary text-white px-8 py-3 rounded-xl font-black shadow-lg hover:bg-brand-secondary transition disabled:opacity-50">Create Submission</Button>
            </>
          )
        }
      >
        {submissionSuccess ? (
          <div className="flex flex-col items-center justify-center p-10 text-center">
            <div className="w-20 h-20 bg-brand-primary/10 rounded-full flex items-center justify-center mb-6 animate-bounce">
              <svg className="w-10 h-10 text-brand-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
            </div>
            <h3 className="text-2xl font-black text-slate-800 mb-2">Quote Created!</h3>
            <p className="text-slate-500 font-medium mb-6">Your submission for <span className="font-bold text-slate-800">{newQuote.insuredName}</span> has been sent to underwriting.</p>
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 w-full">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Status</span>
                <span className="px-2 py-1 rounded bg-yellow-100 text-yellow-700 text-[10px] font-black uppercase">Pending Review</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Premium Indication</span>
                <span className="font-black text-slate-800">{currency} {newQuote.premium || '0'}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-2 space-y-6">
            <div className="bg-brand-primary/5 p-6 rounded-2xl border border-brand-primary/10 mb-6">
              <h4 className="text-brand-primary font-bold mb-1">New Deal Flow</h4>
              <p className="text-xs text-brand-primary/80">Create the submission, then complete its policyholder and insurance details.</p>
            </div>

            {catalogError && <p role="alert" className="text-sm text-rose-700">{catalogError}</p>}
            {!catalogLoading && !catalogError && availableProductTypes.length === 0 && <p role="status" className="text-sm text-amber-800">No active insurance programme is registered for this workspace.</p>}
            <div className="grid grid-cols-2 gap-6">
              <div className="col-span-2">
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Insured / Entity Name</label>
                <Input
                  type="text"
                  value={newQuote.insuredName}
                  onChange={(e) => setNewQuote({ ...newQuote, insuredName: e.target.value })}
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-bold text-slate-800 focus:border-brand-primary outline-none transition-all"
                  placeholder="E.g. Greystar Global Holdings"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Product</label>
                <Select
                  value={newQuote.productType}
                  onChange={(e) => {
                    const nextProductType = e.target.value;
                    const selected = productCatalog.find((entry) => entry.manifest.productType === nextProductType);
                    setNewQuote({
                      ...newQuote,
                      productType: nextProductType,
                      segment: selected?.manifest.displayName || '',
                    });
                  }}
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-bold text-slate-800 focus:border-brand-primary outline-none transition-all appearance-none"
                >
                  <option value="">{catalogLoading ? 'Loading registered products…' : 'Select product...'}</option>
                  {productCatalog.filter((entry) => availableProductTypes.includes(entry.manifest.productType) && isProductAvailableInCountry(entry, getOperatingCountryFromHost())).map((entry) => (
                    <option key={entry.manifest.productType} value={entry.manifest.productType}>
                      {entry.manifest.displayName}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Est. Gross Premium</label>
                <div className="relative">
                  <span className="absolute left-4 top-4 text-slate-400 font-bold">{currency}</span>
                  <Input
                    type="number"
                    value={newQuote.premium}
                    onChange={(e) => setNewQuote({ ...newQuote, premium: e.target.value })}
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 pl-8 font-bold text-slate-800 focus:border-brand-primary outline-none transition-all"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="col-span-2">
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Sales channel</label>
                <div className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 font-extrabold text-slate-800">
                  Direct
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showPricingSteps}
        onClose={() => setShowPricingSteps(false)}
        title="Rating steps & inputs used"
        actions={(
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => setShowPricingSteps(false)}
            className="bg-brand-primary text-white px-6 py-3 rounded-xl font-black shadow-lg hover:bg-brand-secondary transition"
          >
            Close
          </Button>
        )}
      >
        {(() => {
          const asRecord = (value: unknown): Record<string, unknown> =>
            value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
          const p = asRecord(selectedPortfolio);
          const qd = asRecord(p.quoteData);
          const qr = asRecord(p.quoteResponse);
          const primary = asRecord(qr.primaryOption);
          const trace = asRecord(primary.calculationTrace);
          const steps = Array.isArray(trace.steps) ? trace.steps : [];

          const manifest = ProductRegistry.get(String(p.productType || ''));
          const inputPairs: Array<{ label: string; value: unknown }> = manifest
            ? manifest.riskModelHints.ratingInputs.map((hint) => {
                const raw = readPath(qd, hint.path);
                let value: unknown = raw;
                if (hint.format === 'currency') {
                  value = formatCurrency(raw) ?? raw;
                } else if (hint.format === 'boolean') {
                  value = raw === true ? 'Yes' : raw === false ? 'No' : raw;
                }
                return { label: hint.label, value };
              })
            : [];

          return (
            <div className="space-y-4">
              <div className="text-sm text-slate-600 font-semibold">
                Steps are captured at rating-time and stored on the quote. This is the exact trace used for the last calculation.
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {inputPairs.map((x) => (
                  <Card key={x.label} className="px-4 py-3">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{x.label}</div>
                    <div className="mt-1 text-sm font-black text-slate-900">{String(x.value ?? '—')}</div>
                  </Card>
                ))}
              </div>

              {!steps.length ? (
                <div className="p-5 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 font-semibold">
                  No step trace found on this quote yet. Click <span className="font-black">Recalculate premium</span> to generate it.
                </div>
              ) : (
                <div className="space-y-3">
                  {steps.map((s, idx) => (
                    <Card key={`${s.id || idx}`} className="p-5 rounded-3xl">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="min-w-0">
                          <div className="text-sm font-black text-slate-900">{s.name}</div>
                          <div className="mt-1 text-xs font-semibold text-slate-500">
                            {s.kind}{s.id ? <> • <span className="font-mono">{s.id}</span></> : null}
                          </div>
                        </div>
                        <div className="text-right">
                          {typeof s.factor === 'number' && (
                            <div className="text-xs font-black text-slate-700">× {Number(s.factor).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}</div>
                          )}
                          {typeof s.amount === 'number' && (
                            <div className="text-xs font-black text-slate-700">€ {Number(s.amount).toFixed(2)}</div>
                          )}
                          {typeof s.output === 'number' && (
                            <div className="text-sm font-black text-slate-900">€ {Number(s.output).toFixed(2)}</div>
                          )}
                        </div>
                      </div>
                      {(s.inputs || s.notes) && (
                        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {s.inputs && (
                            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Inputs</div>
                              <pre className="mt-2 text-xs font-mono text-slate-700 overflow-auto">{JSON.stringify(s.inputs, null, 2)}</pre>
                            </div>
                          )}
                          {s.notes && (
                            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Notes</div>
                              <div className="mt-2 text-sm font-semibold text-slate-700">{s.notes}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      <Modal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        title="Workflow History"
      >
        <PolicyWorkflowHistory policyId={selectedPortfolio?.id ? String(selectedPortfolio.id) : undefined} />
      </Modal>

      <Modal
        isOpen={showTraceModal}
        onClose={() => setShowTraceModal(false)}
        title="Transaction Trace"
      >
        <div className="bg-slate-900 rounded-xl p-4 font-mono text-xs text-brand-secondary overflow-x-auto">
          <p>{`> TRACE STARTED`}</p>
          <p>{`> LOOKUP BLOCKCHAIN_REF... OK`}</p>
          <p>{`> VERIFY SIGNATURES... OK`}</p>
          <p>{`> TIMESTAMP: ${new Date().toISOString()}`}</p>
          <p className="text-slate-500 mt-2"># Transaction Verified on Ledger</p>
        </div>
      </Modal>

      {/* Restore Quote Version Modal */}
      <Modal
        isOpen={showRestoreVersionModal}
        onClose={() => setShowRestoreVersionModal(false)}
        title="Restore this version?"
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => setShowRestoreVersionModal(false)}
              className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition bg-transparent"
              disabled={isRestoringVersion}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={async () => {
                if (!selectedPortfolio?.id || !viewingVersionId) return;
                try {
                  setIsRestoringVersion(true);
                  const res = await policyCrudApiClient.restoreQuoteVersion(
                    selectedPortfolio.id,
                    viewingVersionId,
                  );
                  if (!res?.success) {
                    setToastMessage(res?.error?.message || 'Failed to restore version');
                    setShowToast(true);
                    return;
                  }
                  setShowRestoreVersionModal(false);
                  setViewingVersionId(null);
                  setToastMessage('Version restored');
                  setShowToast(true);
                  await reloadCurrentPolicy();
                } catch (e) {
                  setToastMessage((e as Error)?.message || 'Failed to restore version');
                  setShowToast(true);
                } finally {
                  setIsRestoringVersion(false);
                }
              }}
              className="bg-brand-primary text-white px-8 py-3 rounded-xl font-black shadow-lg hover:bg-brand-secondary transition disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={isRestoringVersion || !selectedPortfolio?.id || !viewingVersionId}
            >
              {isRestoringVersion ? 'Restoring…' : 'Restore version'}
            </Button>
          </>
        }
      >
        <div className="p-4 text-center sm:text-left">
          <p className="text-slate-500 font-medium">
            This will restore the selected historical quote as the current working quote.
            We’ll archive the current state first so you can revert if needed.
          </p>
        </div>
      </Modal>

      {/* Create Endorsement Modal */}
      <Modal
        isOpen={showCreateEndorsementModal}
        onClose={() => setShowCreateEndorsementModal(false)}
        title="Create endorsement"
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => setShowCreateEndorsementModal(false)}
              className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition bg-transparent"
              disabled={isCreatingEndorsementDraft}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={async () => {
                if (!selectedPortfolio?.id) return;
                try {
                  setIsCreatingEndorsementDraft(true);
                  const existingDraftsResp = await api.listPolicyVersions(String(selectedPortfolio.id));
                  const existingDrafts = (existingDraftsResp?.success && Array.isArray(existingDraftsResp.data))
                    ? existingDraftsResp.data
                      .filter((pv) =>
                        String(pv?.transactionType || '').toUpperCase() === 'ENDORSEMENT' &&
                        String(pv?.status || '').toUpperCase() === 'DRAFT'
                      )
                    : [];
                  const latestExistingDraft = existingDrafts[0] || null;
                  if (latestExistingDraft?.riskTransactionId) {
                    const existingId = String(latestExistingDraft.riskTransactionId);
                    setPolicyVersions(existingDraftsResp.data as Record<string, unknown>[]);
                    setShowCreateEndorsementModal(false);
                    setViewingRiskTransactionId(existingId);
                    setViewingRiskTransactionSnapshot(buildEndorsementDraftSnapshotStub(existingId));
                    let snapshotLoaded = false;
                    try {
                      const snap = await api.getPolicyVersionSnapshot(String(selectedPortfolio.id), existingId);
                      if (snap?.success && snap.data) {
                        setViewingRiskTransactionSnapshot(snap.data);
                        snapshotLoaded = true;
                      }
                    } catch { /* handled by the actionable warning below */ }
                    setIsEditing(true);
                    setToastMessage(snapshotLoaded
                      ? 'Opened existing endorsement draft'
                      : 'Opened existing endorsement draft, but version snapshot failed to load. Retry by reopening the draft from Premium history.');
                    setShowToast(true);
                    await refreshIssueReadiness(String(selectedPortfolio.id), { riskTransactionId: existingId });
                    await reloadCurrentPolicy({ riskTransactionId: existingId });
                    return;
                  }

                  const res = await api.createEndorsementDraft(String(selectedPortfolio.id), {
                    effectiveDate: String(endorsementEffectiveDate || '').trim(),
                    reason: String(endorsementReason || '').trim() || undefined,
                  });
                  if (!res?.success) throw new Error(res?.error?.message || 'Failed to create endorsement');
                  const riskTransactionId = String((res?.data as { riskTransactionId?: string })?.riskTransactionId || '');
                  if (!riskTransactionId) throw new Error('Missing riskTransactionId');

                  // Refresh versions list + switch view into the endorsement draft workspace
                  try {
                    const v = await api.listPolicyVersions(String(selectedPortfolio.id));
                    if (v?.success) setPolicyVersions(Array.isArray(v.data) ? v.data : []);
                  } catch { }

                  setShowCreateEndorsementModal(false);
                  // Switch immediately into endorsement workspace mode (no "retry" UX).
                  setViewingRiskTransactionId(riskTransactionId);
                  setViewingRiskTransactionSnapshot(buildEndorsementDraftSnapshotStub(riskTransactionId));
                  let snapshotLoaded = false;
                  try {
                    const snap = await api.getPolicyVersionSnapshot(String(selectedPortfolio.id), String(riskTransactionId));
                    if (snap?.success && snap.data) {
                      setViewingRiskTransactionSnapshot(snap.data);
                      snapshotLoaded = true;
                    }
                  } catch { /* handled by the actionable warning below */ }
                  setIsEditing(true);
                  setToastMessage(snapshotLoaded
                    ? 'Endorsement draft created'
                    : 'Endorsement draft created, but version snapshot failed to load. Retry by reopening the draft from Premium history.');
                  setShowToast(true);
                  await refreshIssueReadiness(String(selectedPortfolio.id), { riskTransactionId });
                  // Best-effort refresh of base policy data
                  await reloadCurrentPolicy({ riskTransactionId });
                } catch (e) {
                  setToastMessage((e as Error)?.message || 'Failed to create endorsement');
                  setShowToast(true);
                } finally {
                  setIsCreatingEndorsementDraft(false);
                }
              }}
              className="bg-brand-primary text-white px-8 py-3 rounded-xl font-black shadow-lg hover:bg-brand-secondary transition disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={isCreatingEndorsementDraft || !endorsementEffectiveDate}
            >
              {isCreatingEndorsementDraft ? 'Creating…' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="p-4 space-y-5">
          <div className="relative group/field max-w-sm">
            <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">
              Endorsement effective date
            </label>
            <Input
              type="date"
              value={endorsementEffectiveDate}
              onValueChange={(next) => setEndorsementEffectiveDate(next)}
              variant="ui"
              className="font-bold"
              disabled={isCreatingEndorsementDraft}
            />
          </div>

          <div className="relative group/field">
            <label className="absolute -top-2.5 left-4 bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 transition-colors group-focus-within/field:text-brand-primary">
              Reason (optional)
            </label>
            <Input
              value={endorsementReason}
              onChange={(e) => setEndorsementReason(e.target.value)}
              variant="ui"
              className="font-bold"
              disabled={isCreatingEndorsementDraft}
              placeholder="e.g., Add cover, adjust limit, correct details…"
            />
          </div>

          <div className="text-xs text-slate-500 font-medium">
            This creates a new editable endorsement workspace. The previously issued version remains immutable.
          </div>
        </div>
      </Modal>
    </>
  );
}

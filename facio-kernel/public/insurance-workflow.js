'use strict';

window.createInsuranceWorkflow = ({
  api,
  getContext,
  getEpoch,
  getRecord,
  isBusy,
  setBusy,
  render,
  notify,
  showError,
  markDirty,
  discardAllowed,
  reloadRecord,
  openForm = () => {},
  escape,
  titleCase,
  money,
  date,
}) => {
  const approvalView = window.createInsuranceApprovalView({ escape, titleCase, money, date });
  const providerView = window.createInsuranceProviderView({ escape, titleCase, money, date });
  let recordId = null,
    approvals = null,
    approvalDetail = null,
    approvalError = null;
  let providers = null,
    adapters = null,
    providerDetail = null,
    providerError = null;
  let form = null,
    pending = null;
  const permissions = () => getContext()?.permissions || [];
  function discardDraft() {
    form = pending = null;
    markDirty(false);
  }
  function reset() {
    recordId = null;
    approvals = approvalDetail = approvalError = null;
    providers = adapters = providerDetail = providerError = null;
    form = pending = null;
  }
  async function load(record) {
    reset();
    if (!record) return;
    const epoch = getEpoch();
    recordId = record.id;
    const target = record.id;
    const results = await Promise.allSettled([
      api(`/api/insurance/approvals?recordId=${encodeURIComponent(target)}`),
      api(`/api/insurance/providers/requests?recordId=${encodeURIComponent(target)}`),
      api('/api/insurance/providers/catalog'),
    ]);
    if (epoch !== getEpoch() || recordId !== target) return;
    if (results[0].status === 'fulfilled') approvals = results[0].value;
    else approvalError = results[0].reason;
    if (results[1].status === 'fulfilled') providers = results[1].value;
    else providerError = results[1].reason;
    if (results[2].status === 'fulfilled') adapters = results[2].value;
    else providerError = results[2].reason;
  }
  function renderPanels() {
    const record = getRecord();
    if (!record || record.id !== recordId) return '';
    return `<div id="insurance-workflow-panels">${approvalView.render({
      record,
      report: approvals,
      detail: approvalDetail,
      actorId: getContext()?.actorId,
      permissions: permissions(),
      busy: isBusy(),
      loading: false,
      error: approvalError,
      form: form?.kind === 'approval' ? form : null,
    })}${providerView.render({
      record,
      report: providers,
      catalog: adapters,
      detail: providerDetail,
      permissions: permissions(),
      busy: isBusy(),
      error: providerError,
      form: form?.kind === 'provider' ? form : null,
    })}</div>`;
  }
  function capture() {
    const element = document.querySelector('#insurance-approval-form');
    if (element && form?.kind === 'approval') Object.assign(form, approvalView.capture(element));
  }
  async function write(path, payload, success) {
    if (isBusy()) return;
    const epoch = getEpoch(),
      target = recordId;
    if (
      pending &&
      (pending.path !== path || JSON.stringify(pending.payload) !== JSON.stringify(payload))
    ) {
      notify(
        'A previous workflow request has an uncertain result. Retry the same request or refresh to inspect its saved outcome.',
        'warning',
      );
      return;
    }
    pending ||= { path, payload, idempotencyKey: crypto.randomUUID() };
    setBusy(true);
    try {
      await api(path, {
        method: 'POST',
        body: JSON.stringify({ ...pending.payload, idempotencyKey: pending.idempotencyKey }),
      });
      if (epoch !== getEpoch() || recordId !== target) return;
      pending = null;
      form = null;
      markDirty(false);
      await reloadRecord(target);
      if (epoch === getEpoch()) notify(success);
    } catch (error) {
      if (epoch !== getEpoch() || recordId !== target) return;
      if (error.status && error.status < 500) pending = null;
      else markDirty(true);
      showError(
        error,
        error.status && error.status < 500
          ? 'The workflow change was not accepted. Refresh if the quote or review has changed.'
          : 'The result is uncertain. Retry the unchanged request to reuse its identity.',
      );
    } finally {
      if (epoch === getEpoch()) {
        setBusy(false);
        render();
      }
    }
  }
  async function handleClick(event) {
    const button = event.target.closest(
      '[data-insurance-approval-action], [data-insurance-provider-action]',
    );
    if (!button) return false;
    if (isBusy() || button.disabled || !getRecord()) return true;
    event.preventDefault();
    const kind = button.hasAttribute('data-insurance-approval-action') ? 'approval' : 'provider';
    const action =
      button.dataset[kind === 'approval' ? 'insuranceApprovalAction' : 'insuranceProviderAction'];
    const epoch = getEpoch(),
      target = recordId;
    try {
      if (action === 'cancel') {
        if (!discardAllowed()) return true;
        form = pending = null;
        markDirty(false);
        render();
        return true;
      }
      if (action === 'refresh') {
        if (!discardAllowed()) return true;
        await reloadRecord(target);
        return true;
      }
      if (kind === 'approval') {
        if (action === 'request') {
          if (
            !approvals?.requestAvailability?.canRequest ||
            !permissions().includes('insurance:quote') ||
            !discardAllowed()
          )
            return true;
          openForm();
          form = {
            kind,
            action,
            reason: '',
            evidenceRefs: [],
            expiresAt: approvals.requestAvailability.maximumExpiresAt,
          };
          pending = null;
          render();
          return true;
        }
        const view = approvals?.approvals.find(
          (item) => item.approval.id === button.dataset.approvalId,
        );
        if (!view) return true;
        if ((action === 'review' && !view.canDecide) || (action === 'revoke' && !view.canRevoke))
          return true;
        if (!discardAllowed()) return true;
        setBusy(true);
        const detail = await api(
          `/api/insurance/approval?approvalId=${encodeURIComponent(view.approval.id)}`,
        );
        if (epoch !== getEpoch() || recordId !== target) return true;
        approvalDetail = detail;
        if (['review', 'revoke'].includes(action)) {
          openForm();
          form = {
            kind,
            action,
            approvalId: view.approval.id,
            reason: '',
            evidenceRefs: [],
            expiresAt: '',
          };
        } else form = null;
        pending = null;
        markDirty(false);
      } else if (action === 'request') {
        if (!permissions().includes('provider:request') || !discardAllowed()) return true;
        openForm();
        const record = getRecord();
        await write(
          '/api/insurance/providers/requests',
          {
            recordId: record.id,
            expectedVersion: record.version,
            expectedRecordHash: record.recordHash,
            adapterId: button.dataset.adapterId,
          },
          'Provider request queued. Refresh to inspect actual processing and delivery evidence.',
        );
      } else if (action === 'inspect') {
        if (!discardAllowed()) return true;
        setBusy(true);
        const detail = await api(
          `/api/insurance/providers/request?requestId=${encodeURIComponent(button.dataset.requestId)}`,
        );
        if (epoch !== getEpoch() || recordId !== target) return true;
        providerDetail = detail;
        discardDraft();
      } else if (action === 'retry') {
        if (!discardAllowed()) return true;
        openForm();
        await write(
          '/api/insurance/providers/retry',
          providerView.retryPayload(button.dataset.requestId, providers),
          'Provider retry recorded. Delivery is confirmed only by its retained outcome.',
        );
      }
    } catch (error) {
      if (epoch === getEpoch()) showError(error, 'The workflow could not be loaded.');
    } finally {
      if (epoch === getEpoch()) {
        setBusy(false);
        render();
      }
    }
    return true;
  }
  async function handleSubmit(event) {
    if (event.target.id !== 'insurance-approval-form') return false;
    event.preventDefault();
    if (isBusy() || !form || form.kind !== 'approval') return true;
    try {
      capture();
      const record = getRecord();
      const base = { reason: String(form.reason).trim(), evidenceRefs: form.evidenceRefs };
      if (form.action === 'request') {
        await write(
          '/api/insurance/approvals',
          {
            ...base,
            recordId: record.id,
            expectedVersion: record.version,
            recordHash: record.recordHash,
            expiresAt: new Date(form.expiresAt).toISOString(),
          },
          'Independent review requested for this exact quote.',
        );
      } else {
        const approval = approvalDetail?.approval;
        if (!approval || approval.id !== form.approvalId)
          throw new Error('Reload the exact review before recording a decision.');
        const payload = {
          ...base,
          approvalId: approval.id,
          expectedVersion: approval.version,
          approvalHash: approval.approvalHash,
        };
        if (form.action === 'review') {
          const decision = event.submitter?.dataset.approvalDecision;
          if (!['approve', 'decline'].includes(decision))
            throw new Error('Choose Approve or Decline.');
          await write(
            '/api/insurance/approval/decision',
            { ...payload, decision },
            `Independent review ${decision === 'approve' ? 'approved' : 'declined'}. The original quote and decision remain retained.`,
          );
        } else
          await write(
            '/api/insurance/approval/revoke',
            payload,
            'Review withdrawn. Its earlier decisions remain in the audit history.',
          );
      }
    } catch (error) {
      showError(error, 'Review the reason, evidence references and expiry.');
    }
    return true;
  }
  function handleInput(event) {
    if (event.target.closest('#insurance-approval-form')) {
      capture();
      markDirty(true);
      return true;
    }
    return false;
  }
  function bindApprovalId() {
    const record = getRecord();
    const id = approvals?.bindableApprovalId;
    return approvals?.approvals.some(
      ({ approval, effectiveStatus }) =>
        approval.id === id &&
        effectiveStatus === 'approved' &&
        approval.target.recordHash === record?.recordHash,
    )
      ? id
      : null;
  }
  return {
    reset,
    discardDraft,
    hasPendingWrite: () => !!pending,
    load,
    render: renderPanels,
    handleClick,
    handleSubmit,
    handleInput,
    bindApprovalId,
  };
};

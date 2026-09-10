'use strict';

window.createInsuranceOperations = ({
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
  escape,
  titleCase,
  money,
  toMinor,
  fromMinor,
  moneyDigits,
  openForm,
}) => {
  const documentView = window.createInsuranceDocumentsView({ escape, titleCase });
  const financeView = window.createInsuranceFinanceView({ escape, titleCase, money });
  let recordId = null,
    catalog = null,
    documents = null,
    detail = null,
    documentError = null;
  let ledger = null,
    financeError = null,
    form = null,
    pending = null;
  let reportState = { parameters: null, report: null, error: null };
  const permissions = () => getContext()?.permissions || [];
  function discardDraft() {
    form = pending = null;
    markDirty(false);
  }
  function reset() {
    reportState = { parameters: null, report: null, error: null };
    recordId =
      catalog =
      documents =
      detail =
      documentError =
      ledger =
      financeError =
      form =
      pending =
        null;
  }
  async function load(record) {
    reset();
    if (!record) return;
    const epoch = getEpoch(),
      target = record.id;
    recordId = target;
    reportState.parameters = {
      effectiveAsOf: record.updatedAt.slice(0, 10),
      recordedAsOf: record.updatedAt.replace(/Z$/, ''),
      wholeScope: false,
    };
    const results = await Promise.allSettled([
      permissions().includes('documents:read') ? api('/api/insurance/documents/catalog') : null,
      permissions().includes('documents:read')
        ? api(`/api/insurance/documents?recordId=${encodeURIComponent(target)}`)
        : null,
      permissions().includes('finance:read')
        ? api(`/api/insurance/finance/ledger?recordId=${encodeURIComponent(target)}`)
        : null,
    ]);
    if (epoch !== getEpoch() || recordId !== target) return;
    if (results[0].status === 'fulfilled') catalog = results[0].value;
    else documentError = results[0].reason;
    if (results[1].status === 'fulfilled') documents = results[1].value;
    else documentError = results[1].reason;
    if (results[2].status === 'fulfilled') ledger = results[2].value;
    else financeError = results[2].reason;
  }
  function renderPanels() {
    const record = getRecord();
    if (!record || record.id !== recordId) return '';
    return (
      documentView.render({
        record,
        catalog,
        report: documents,
        detail,
        error: documentError,
        permissions: permissions(),
        busy: isBusy(),
      }) +
      financeView.render({
        record,
        ledger,
        form,
        pending,
        reportState,
        error: financeError,
        permissions: permissions(),
        busy: isBusy(),
      })
    );
  }
  async function write(path, payload, message) {
    const epoch = getEpoch(),
      target = recordId;
    if (
      pending &&
      (pending.path !== path || JSON.stringify(pending.payload) !== JSON.stringify(payload))
    ) {
      notify(
        'A previous request has an uncertain result. Retry it unchanged or refresh to inspect retained evidence.',
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
      if (epoch !== getEpoch() || target !== recordId) return;
      discardDraft();
      await reloadRecord(target);
      if (epoch === getEpoch()) notify(message);
    } catch (error) {
      if (epoch !== getEpoch() || target !== recordId) return;
      if (error.status && error.status < 500) pending = null;
      else markDirty(true);
      showError(
        error,
        error.status && error.status < 500
          ? 'This change was not accepted. Your entered evidence remains available.'
          : 'The result is uncertain. Retry the unchanged request to reuse its identity.',
      );
    } finally {
      if (epoch === getEpoch()) {
        setBusy(false);
        render();
      }
    }
  }
  async function download(bytes, expectedHash, filename, mimeType) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== expectedHash)
      throw new Error(
        'Download integrity verification failed. Refresh the retained artifact before trying again.',
      );
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function capture() {
    const element = document.querySelector('#insurance-finance-form');
    if (element && form) Object.assign(form, financeView.capture(element));
  }
  async function handleClick(event) {
    const button = event.target.closest(
      '[data-insurance-documents-action], [data-insurance-finance-action]',
    );
    if (!button) return false;
    event.preventDefault();
    if (isBusy() || button.disabled || !getRecord()) return true;
    capture();
    const kind = button.hasAttribute('data-insurance-documents-action') ? 'documents' : 'finance';
    const action =
      button.dataset[kind === 'documents' ? 'insuranceDocumentsAction' : 'insuranceFinanceAction'];
    const epoch = getEpoch(),
      target = recordId;
    try {
      if (action === 'refresh') {
        if (discardAllowed()) await reloadRecord(target);
        return true;
      }
      if (action === 'cancel') {
        if (discardAllowed()) {
          discardDraft();
          render();
        }
        return true;
      }
      if (kind === 'documents') {
        if (action === 'request') {
          if (!permissions().includes('documents:issue') || (!pending && !discardAllowed()))
            return true;
          if (!pending) {
            openForm();
            discardDraft();
          }
          const record = getRecord();
          await write(
            '/api/insurance/documents',
            {
              recordId: record.id,
              recordVersion: record.version,
              recordHash: record.recordHash,
              packId: button.dataset.packId,
              packVersion: button.dataset.packVersion,
            },
            'Document generation queued. Refresh documents to inspect the retained result.',
          );
        } else if (action === 'retry') {
          const job = documents?.documents.find((item) => item.request.id === button.dataset.jobId);
          if (
            !job?.canRetry ||
            !permissions().includes('documents:issue') ||
            (!pending && !discardAllowed())
          )
            return true;
          if (!pending) {
            openForm();
            discardDraft();
          }
          await write(
            '/api/insurance/documents/retry',
            {
              jobId: job.request.id,
              expectedVersion: job.state.version,
              stateHash: job.state.stateHash,
            },
            'Document retry queued; retained earlier attempts remain inspectable.',
          );
        } else if (action === 'inspect') {
          setBusy(true);
          const result = await api(
            `/api/insurance/documents/job?jobId=${encodeURIComponent(button.dataset.jobId)}`,
          );
          if (epoch === getEpoch() && target === recordId) detail = result;
        } else if (action === 'download') {
          setBusy(true);
          const result = await api(
            `/api/insurance/documents/content?artifactId=${encodeURIComponent(button.dataset.artifactId)}`,
          );
          if (epoch !== getEpoch() || target !== recordId) return true;
          const bytes = Uint8Array.from(atob(result.content), (character) =>
            character.charCodeAt(0),
          );
          if (bytes.byteLength !== result.artifact.byteLength)
            throw new Error('The artifact byte count does not match its retained evidence.');
          await download(
            bytes,
            result.artifact.contentHash,
            result.artifact.filename,
            result.artifact.mimeType,
          );
        }
      } else if (action === 'report-export') {
        if (!reportState.report) return true;
        setBusy(true);
        const result = await api('/api/insurance/finance/report/export?' + reportQuery());
        if (epoch !== getEpoch() || target !== recordId) return true;
        if (result.reportHash !== reportState.report.reportHash)
          throw new Error(
            'Report evidence changed. Build the dated report again before downloading.',
          );
        await download(
          new TextEncoder().encode(result.content),
          result.contentHash,
          result.fileName,
          result.mediaType,
        );
      } else if (action === 'export') {
        setBusy(true);
        const result = await api(
          `/api/insurance/finance/export?recordId=${encodeURIComponent(target)}`,
        );
        if (epoch !== getEpoch() || target !== recordId) return true;
        if (result.ledgerHash !== ledger?.ledgerHash)
          throw new Error(
            'The ledger changed. Refresh finance so the visible totals and export use the same evidence.',
          );
        await download(
          new TextEncoder().encode(result.content),
          result.contentHash,
          result.fileName,
          result.mediaType,
        );
      } else if (['post', 'receipt', 'apply', 'reverse'].includes(action)) {
        if (
          !ledger ||
          !permissions().includes(action === 'post' ? 'finance:post' : 'finance:reconcile') ||
          !discardAllowed()
        )
          return true;
        openForm();
        discardDraft();
        const record = getRecord();
        form = {
          action,
          reason: '',
          evidenceRefs: [],
          payerId: record.financials.commission.settlementPartyId,
          receivedAt: new Date().toISOString().replace(/Z$/, ''),
        };
        if (action === 'apply') {
          const receipt = ledger.receipts.find(
            (item) => item.receipt.id === button.dataset.receiptId,
          );
          if (!receipt) {
            form = null;
            return true;
          }
          form.receiptId = receipt.receipt.id;
          form.amount = fromMinor(
            String(
              BigInt(receipt.unappliedMinor) < BigInt(ledger.totals.commissionOutstandingMinor)
                ? BigInt(receipt.unappliedMinor)
                : BigInt(ledger.totals.commissionOutstandingMinor),
            ),
            moneyDigits[ledger.currency],
          );
        }
        if (action === 'reverse') form.applicationId = button.dataset.applicationId;
      }
    } catch (error) {
      if (epoch === getEpoch())
        showError(error, 'The retained transaction evidence could not be loaded.');
    } finally {
      if (epoch === getEpoch()) {
        setBusy(false);
        render();
      }
    }
    return true;
  }
  function reportQuery() {
    const parameters = reportState.parameters;
    return new URLSearchParams({
      effectiveAsOf: parameters.effectiveAsOf,
      recordedAsOf: new Date(parameters.recordedAsOf.replace(/Z$/, '') + 'Z').toISOString(),
      ...(parameters.wholeScope ? {} : { recordId }),
    }).toString();
  }
  async function handleSubmit(event) {
    if (event.target.id === 'insurance-finance-report-form') {
      event.preventDefault();
      if (isBusy()) return true;
      capture();
      reportState.parameters = window.createInsuranceReportView({}).capture(event.target);
      reportState.report = reportState.error = null;
      const epoch = getEpoch(),
        target = recordId;
      setBusy(true);
      try {
        const result = await api('/api/insurance/finance/report?' + reportQuery());
        if (epoch === getEpoch() && target === recordId) reportState.report = result;
      } catch (error) {
        if (epoch === getEpoch() && target === recordId) reportState.error = error;
      } finally {
        if (epoch === getEpoch()) {
          setBusy(false);
          render();
        }
      }
      return true;
    }

    if (event.target.id !== 'insurance-finance-form') return false;
    event.preventDefault();
    if (isBusy() || !form || !ledger) return true;
    capture();
    try {
      const record = getRecord();
      const base = { reason: String(form.reason).trim(), evidenceRefs: form.evidenceRefs };
      const target = {
        recordId: record.id,
        expectedVersion: record.version,
        recordHash: record.recordHash,
      };
      let path, payload;
      if (form.action === 'post') {
        path = '/api/insurance/finance/post';
        payload = { ...base, ...target, accountingBasis: ledger.accountingBasis };
      } else if (form.action === 'receipt') {
        path = '/api/insurance/finance/receipts';
        payload = {
          ...base,
          sourceReference: String(form.sourceReference).trim(),
          payerId: String(form.payerId).trim(),
          currency: ledger.currency,
          amountMinor: toMinor(form.amount, moneyDigits[ledger.currency], 'Receipt amount'),
          receivedAt: new Date(`${String(form.receivedAt).replace(/Z$/, '')}Z`).toISOString(),
          provenance: 'synthetic_training',
        };
      } else if (form.action === 'apply') {
        path = '/api/insurance/finance/applications';
        payload = {
          ...base,
          ...target,
          expectedLedgerHash: ledger.ledgerHash,
          receiptId: form.receiptId,
          amountMinor: toMinor(form.amount, moneyDigits[ledger.currency], 'Application amount'),
        };
      } else {
        path = '/api/insurance/finance/application/reverse';
        payload = {
          ...base,
          ...target,
          expectedLedgerHash: ledger.ledgerHash,
          applicationId: form.applicationId,
        };
      }
      await write(
        path,
        payload,
        'Financial evidence retained. Updated balances reconcile to the journal history.',
      );
    } catch (error) {
      showError(error, 'Review the financial amount, date, reason and evidence.');
    }
    return true;
  }
  function handleInput(event) {
    const reportForm = event.target.closest('#insurance-finance-report-form');
    if (reportForm) {
      reportState.parameters = window.createInsuranceReportView({}).capture(reportForm);
      reportState.report = reportState.error = null;
      const stale = document.querySelector('.finance-report-result');
      if (stale)
        stale.textContent =
          'Report inputs changed. Build the dated report again to display matching evidence.';
      const download = document.querySelector('[data-insurance-finance-action="report-export"]');
      if (download) {
        download.disabled = true;
        download.setAttribute('data-finance-unavailable', '');
      }
      return true;
    }

    if (!event.target.closest('#insurance-finance-form')) return false;
    capture();
    markDirty(true);
    return true;
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
  };
};

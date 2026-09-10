'use strict';

window.createInsuranceFinanceView = ({ escape: e, titleCase, money }) => {
  const reportView = window.createInsuranceReportView({ escape: e, titleCase, money });
  const button = (action, label, attributes = '', unavailable = false, busy = false) =>
    `<button type="button" class="button secondary" data-workflow-guard data-insurance-finance-action="${e(action)}" ${attributes} ${unavailable || busy ? 'disabled' : ''} ${unavailable ? 'data-finance-unavailable' : ''}>${e(label)}</button>`;
  function render({
    record,
    ledger,
    permissions = [],
    busy = false,
    error,
    form,
    pending,
    reportState,
  }) {
    if (!record) return '';
    const read = permissions.includes('finance:read');
    const post = permissions.includes('finance:post');
    const reconcile = permissions.includes('finance:reconcile');
    const heading = `<div class="panel-heading"><div><h2 id="insurance-finance-title">Transaction finance</h2><p>External premium control and separate commission reconciliation.</p></div>${button('refresh', 'Refresh finance', '', !read, busy)}</div>`;
    const panel = (body) =>
      `<section class="panel finance-panel">${heading}<div class="panel-body">${body}</div></section>`;
    if (!read) return panel("<p>Financial access is outside this session's permissions.</p>");
    if (error)
      return panel(
        `<div class="message error-message" role="alert">${e(error.message || String(error))}<p>Balances are unavailable. Refresh before entering another transaction.</p></div>`,
      );
    if (!ledger) return panel('<p>Loading retained financial evidence…</p>');
    const amount = (value) => e(money(value, ledger.currency));
    const totals = ledger.totals;
    const metric = (label, value, help) =>
      `<div><dt>${e(label)}</dt><dd>${amount(value)}</dd><p class="field-help">${e(help)}</p></div>`;
    const receiptRows = ledger.receipts
      .map(({ receipt, unappliedMinor }) => {
        const match = receipt.payerId === record.financials.commission.settlementPartyId;
        const available =
          reconcile &&
          match &&
          BigInt(unappliedMinor) > 0n &&
          BigInt(totals.commissionOutstandingMinor) > 0n &&
          !ledger.unpostedVersions.length;
        return `<tr><td><strong>${e(receipt.sourceReference)}</strong><small>${e(receipt.payerId)}${match ? '' : ' · Different settlement party'}</small></td><td>${amount(receipt.amountMinor)}</td><td>${amount(unappliedMinor)}</td><td>${button('apply', 'Apply to commission', `data-receipt-id="${e(receipt.id)}"`, !available, busy)}</td></tr>`;
      })
      .join('');
    const applicationRows = ledger.applications
      .map((application) => {
        const reversed = ledger.applications.some((item) => item.reversesId === application.id);
        const receipt = ledger.receipts.find(
          (item) => item.receipt.id === application.receiptId,
        )?.receipt;
        return `<tr><td>${e(receipt?.sourceReference || application.receiptId)}<small>${e(application.reason)}</small></td><td>${application.kind === 'reverse' ? 'Reversal' : reversed ? 'Applied · subsequently reversed' : 'Applied'}</td><td>${amount(application.amountMinor)}</td><td>${application.kind === 'apply' && !reversed ? button('reverse', 'Reverse application', `data-application-id="${e(application.id)}"`, !reconcile || !!ledger.unpostedVersions.length, busy) : ''}</td></tr>`;
      })
      .join('');
    const journals = ledger.journals
      .map(
        (journal) =>
          `<details class="finance-journal"><summary><span>${e(titleCase(journal.kind))} · Transaction v${journal.insuranceVersion}</span><span>${e(journal.effectiveDate)}</span></summary><p>${e(journal.reason)}</p><div class="finance-table"><table><caption>Journal ${journal.sequence} · Independently balanced books</caption><thead><tr><th scope="col">Book / account</th><th scope="col">Party</th><th scope="col">Debit</th><th scope="col">Credit</th></tr></thead><tbody>${journal.lines.map((line) => `<tr><td>${e(titleCase(line.book))}<small>${e(titleCase(line.account))}</small></td><td>${e(line.partyId)}</td><td>${amount(line.debitMinor)}</td><td>${amount(line.creditMinor)}</td></tr>`).join('')}</tbody></table></div><details><summary>Source transaction and audit evidence</summary><pre class="json-output" tabindex="0">${e(JSON.stringify(journal, null, 2))}</pre></details></details>`,
      )
      .join('');
    return panel(
      `<p class="finance-boundary">Synthetic training accounting. Premium remains in external custody. Recorded receipts are unverified and cannot clear payment, screening or insurance issuance requirements.</p><dl class="finance-metrics">${metric('External premium', totals.externalPremiumMinor, 'Control memorandum; not Facio cash or premium receivable.')}${metric('Commission accrued', totals.commissionAccruedMinor, 'Recognized from retained insurance transactions.')}${metric('Commission applied', totals.commissionReceivedMinor, 'Synthetic receipts applied, net of reversals.')}${metric('Commission outstanding', totals.commissionOutstandingMinor, BigInt(totals.commissionOutstandingMinor) < 0n ? 'Credit owed after adjustments; no refund payment is implied.' : 'Accrued commission less applied receipts.')}</dl>${ledger.unpostedVersions.length ? `<div class="message warning-message">Transaction revisions ${e(ledger.unpostedVersions.join(', '))} are not yet recognized. Current balances include posted revisions only.</div>` : ''}<div class="finance-actions">${button('post', 'Recognize insurance transactions', '', !post || !ledger.unpostedVersions.length || record.status === 'quoted', busy)}${button('receipt', 'Record training receipt', '', !reconcile, busy)}${button('export', 'Download journal CSV', '', !ledger.journals.length, busy)}</div>${pending ? '<p class="message warning-message" role="status">A request has an uncertain result. Retry the unchanged request to reuse its identity, or refresh to inspect retained evidence.</p>' : ''}${form ? renderForm(form, ledger, busy) : ''}<h3>Commission receipts in this workspace scope</h3><p class="field-help">Unapplied ${amount(totals.recordedUnappliedReceiptMinor)}. Amounts already applied to other records cannot be reused.</p>${receiptRows ? `<div class="finance-table"><table><thead><tr><th scope="col">Source / payer</th><th scope="col">Recorded</th><th scope="col">Unapplied</th><th scope="col">Action</th></tr></thead><tbody>${receiptRows}</tbody></table></div>` : '<p class="field-help">No synthetic commission receipt is recorded.</p>'}<h3>Applications and corrections</h3>${applicationRows ? `<div class="finance-table"><table><thead><tr><th scope="col">Receipt / reason</th><th scope="col">State</th><th scope="col">Amount</th><th scope="col">Action</th></tr></thead><tbody>${applicationRows}</tbody></table></div>` : '<p class="field-help">No receipt has been applied to this record.</p>'}${reportView.render({ ...reportState, busy })}<h3>Immutable journal history</h3>${journals || '<p class="field-help">No financial transaction has been posted.</p>'}<details class="insurance-trace"><summary>Accounting basis and retained limitations</summary><ul>${ledger.limitations.map((item) => `<li>${e(item)}</li>`).join('')}</ul><p class="field-help">Ledger reference ${e(ledger.ledgerHash)}</p></details>`,
    );
  }
  function renderForm(form, ledger, busy) {
    const labels = {
      post: 'Recognize retained transactions',
      receipt: 'Record a synthetic commission receipt',
      apply: 'Apply part or all of a receipt',
      reverse: 'Reverse an exact receipt application',
    };
    const field = (name, label, type = 'text') =>
      `<div class="form-field"><label for="finance-${name}">${e(label)}</label><input id="finance-${name}" name="${name}" type="${type}" ${name === 'amount' ? 'inputmode="decimal"' : ''} ${type === 'datetime-local' ? 'step="any"' : ''} value="${e(form[name] || '')}" required></div>`;
    return `<form id="insurance-finance-form" class="finance-form"><h3>${e(labels[form.action])}</h3><fieldset data-workflow-guard ${busy ? 'disabled' : ''}><legend class="visually-hidden">Financial transaction evidence</legend><div class="form-grid">${form.action === 'receipt' ? `${field('sourceReference', 'Immutable source reference')}${field('payerId', 'Settlement party identifier')}${field('receivedAt', 'Receipt date and time (UTC)', 'datetime-local')}` : ''}${['receipt', 'apply'].includes(form.action) ? field('amount', `Amount (${ledger.currency})`) : ''}${field('reason', 'Reason for this action')}<div class="form-field full-width"><label for="finance-evidenceRefs">Evidence references, one per line</label><textarea id="finance-evidenceRefs" name="evidenceRefs" rows="3" required>${e((form.evidenceRefs || []).join('\n'))}</textarea></div></div></fieldset><p class="field-help">${form.action === 'post' ? 'Recognizes only retained bound or serviced revisions. External premium control and commission receivables are separate balanced books.' : form.action === 'receipt' ? 'Use synthetic training evidence. This records an unverified receipt without moving money or granting any insurance authority.' : form.action === 'reverse' ? 'The full original application is reversed once. Its journal and evidence remain retained.' : 'The server checks the settlement party, available receipt, current receivable and exact ledger version.'}</p><div class="finance-actions">${button('cancel', 'Discard form', '', false, busy)}<button type="submit" class="button primary" data-workflow-guard ${busy ? 'disabled' : ''}>Record financial evidence</button></div></form>`;
  }
  function capture(element) {
    const values = Object.fromEntries(new FormData(element));
    return {
      ...values,
      evidenceRefs: String(values.evidenceRefs || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }
  return { render, capture };
};

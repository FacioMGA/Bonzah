'use strict';

window.createInsuranceProviderView = ({ escape: e, titleCase }) => {
  const date = (value) =>
    new Date(value)
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d{3}Z$/, ' UTC');
  const labels = {
    queued: 'Queued',
    in_flight: 'Processing',
    retry_wait: 'Retry scheduled',
    reconciliation_required: 'Outcome needs reconciliation',
    completed: 'Evidence received',
    failed: 'Processing failed',
    superseded: 'Quote changed',
  };
  const button = (action, label, attributes = '', disabled = false) =>
    `<button type="button" class="button secondary" data-workflow-guard data-insurance-provider-action="${e(action)}" ${attributes} ${disabled ? 'disabled data-provider-unavailable' : ''}>${e(label)}</button>`;
  function render({ record, report, catalog, detail, permissions, busy, error }) {
    const allowed = permissions.includes('provider:request');
    const readable = permissions.includes('provider:read');
    const entries = report?.requests || [];
    const adapters = catalog?.adapters || [];
    const fact = (label, value) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`;
    const summary = `<div class="panel-heading"><div><h2>Provider activity</h2><p>Send an exact quote for evidence and inspect its processing history.</p></div>${button('refresh', 'Refresh activity', '', busy)}</div>`;
    if (!readable)
      return `<section class="panel provider-panel">${summary}<div class="panel-body"><p class="field-help">Provider evidence is outside this session's permissions.</p></div></section>`;
    if (error)
      return `<section class="panel provider-panel">${summary}<div class="panel-body"><div class="message error-message" role="alert">${e(error.message || error)}<p>Evidence is unavailable. Refresh before drawing a delivery conclusion.</p></div></div></section>`;
    const options = adapters
      .map(({ descriptor, policy }) => {
        const prior = entries.find(
          (item) =>
            item.request.adapter.adapterId === descriptor.adapterId &&
            item.request.recordVersion === record.version,
        );
        const unsupported =
          record.sourceMode !== 'configured_product' || record.status !== 'quoted';
        const training = descriptor.mode === 'synthetic';
        return `<article class="provider-adapter"><div><h3>${e(titleCase(descriptor.adapterId))}</h3><p>${training ? 'Synthetic training adapter. It returns controlled evidence for this quote; it does not contact an insurer or calculate a new premium.' : 'Registered provider adapter. Authentication and mapping versions are controlled by the server.'}</p><p class="field-help">Version ${e(descriptor.adapterVersion)} · ${policy.maxAttempts} maximum attempts · ${Math.ceil(policy.deadlineMs / 60000)} minute processing deadline</p></div><div>${button('request', training ? 'Queue training evidence' : 'Request provider evidence', `data-adapter-id="${e(descriptor.adapterId)}"`, busy || !allowed || unsupported || !!prior)}<p class="field-help">${prior ? 'This quote revision already has a retained request.' : unsupported ? 'Requires an unbound configured quote with a retained submission.' : !allowed ? 'Request permission is required.' : 'The current quote version is pinned when queued.'}</p></div></article>`;
      })
      .join('');
    const rows = entries
      .map((item) => {
        const current = item.request.recordHash === record.recordHash;
        const mayRetry =
          ['retry_wait', 'reconciliation_required'].includes(item.state.status) &&
          Date.parse(item.request.deadlineAt) > Date.now();
        return `<article class="provider-request"><div><h3>${e(titleCase(item.request.adapter.adapterId))}</h3><p><span class="tag ${e(item.state.status)}">${e(labels[item.state.status] || titleCase(item.state.status))}</span> <span class="field-help">Quote v${item.request.recordVersion} · ${item.state.attempts}/${item.request.policy.maxAttempts} attempts · ${e(item.request.adapter.mode === 'synthetic' ? 'Synthetic' : 'Provider')}</span></p><p class="field-help">Requested ${e(date(item.request.createdAt))}${current ? '' : ' · Retained evidence for an earlier quote revision'}${item.state.lastFailure ? ' · ' + e(titleCase(item.state.lastFailure)) : ''}</p></div><div class="provider-actions">${button('inspect', 'Inspect delivery history', `data-request-id="${e(item.request.id)}"`, busy)}${mayRetry ? button('retry', item.state.status === 'reconciliation_required' ? 'Request reconciliation' : 'Resume due retry', `data-request-id="${e(item.request.id)}"`, busy || !allowed || !current) : ''}</div></article>`;
      })
      .join('');
    let trace = '';
    if (detail && entries.some((item) => item.request.id === detail.request.id)) {
      trace = `<section class="provider-detail" aria-label="Provider delivery history"><h3>Delivery history</h3><p class="field-help">${e(titleCase(detail.request.adapter.adapterId))} · Quote v${detail.request.recordVersion} · ${e(labels[detail.state.status] || detail.state.status)}</p><ol class="provider-timeline">${detail.audit.map((event) => `<li><strong>${e(titleCase(event.kind))}</strong><span>${e(date(event.createdAt))} · Attempt ${event.attempt}${event.code ? ' · ' + e(titleCase(event.code)) : ''}</span></li>`).join('')}</ol>${detail.receipts.map((receipt) => `<div class="provider-outcome"><strong>${e(titleCase(receipt.envelope.outcome.kind))}</strong><p>${e(titleCase(receipt.mode))} evidence · ${e(date(receipt.acceptedAt))} · ${e(titleCase(receipt.authentication.method))}</p></div>`).join('')}<details class="insurance-trace"><summary>Exact request and provenance</summary><dl class="provider-facts">${fact('Request', detail.request.id)}${fact('Quote hash', detail.request.selection.quoteHash)}${fact('Risk input hash', detail.request.selection.riskHash)}${fact('Release', detail.request.releaseId)}${fact('Release hash', detail.request.releaseHash)}${fact('Request hash', detail.request.requestHash)}${fact('Correlation', detail.request.correlationId)}</dl><pre class="json-output" tabindex="0" aria-label="Provider execution evidence">${e(JSON.stringify(detail, null, 2))}</pre></details></section>`;
    }
    return `<section class="panel provider-panel">${summary}<div class="panel-body"><p class="provider-boundary">Provider delivery and underwriting authority are separate. These requests retain evidence; they do not approve, bind, verify payment or replace the quote's price.</p>${options || '<p class="field-help">No provider adapter is registered for this environment. Customer connectivity remains unconfigured.</p>'}<div class="provider-register"><h3>Retained requests</h3>${rows || '<p class="field-help">No provider request has been recorded for this insurance record.</p>'}${report?.hasMore ? '<p class="field-help">Showing the latest 100 requests.</p>' : ''}</div>${trace}</div></section>`;
  }
  function retryPayload(requestId, report) {
    const item = report?.requests.find((item) => item.request.id === requestId);
    if (!item) throw new Error('Refresh provider activity before retrying.');
    return { requestId, expectedVersion: item.state.version };
  }
  return { render, retryPayload };
};

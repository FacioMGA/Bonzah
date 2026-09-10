'use strict';

window.createInsuranceDocumentsView = ({ escape: e, titleCase }) => {
  const date = (value) =>
    new Date(value)
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d{3}Z$/, ' UTC');
  const button = (action, label, attributes = '', unavailable = false, busy = false) =>
    `<button type="button" class="button secondary" data-workflow-guard data-insurance-documents-action="${e(action)}" ${attributes} ${unavailable || busy ? 'disabled' : ''} ${unavailable ? 'data-documents-unavailable' : ''}>${e(label)}</button>`;
  const status = {
    queued: 'Generation queued',
    rendering: 'Generating documents',
    failed: 'Generation failed',
    completed: 'Documents available',
  };
  const failures = {
    RENDER_FAILED:
      'The pack could not be rendered. Inspect the retained snapshot and retry within the permitted attempt limit.',
    UNSUPPORTED_GLYPH:
      'The registered PDF font cannot represent a character in this snapshot. A compatible renderer is required; retrying unchanged content will not correct the font.',
    OUTPUT_TOO_LARGE:
      'The generated file exceeds the supported size. A reviewed template or renderer change is required.',
    LEASE_EXPIRED:
      'Processing did not complete before its lease expired. Inspect the retained state before retrying.',
  };
  function render({ record, catalog, report, permissions = [], busy = false, error, detail }) {
    if (!record) return '';
    const readable = permissions.includes('documents:read');
    const issue = permissions.includes('documents:issue');
    const heading = `<div class="panel-heading"><div><h2 id="insurance-documents-title">Transaction documents</h2><p>Retained outputs for exact bound and service revisions.</p></div>${button('refresh', 'Refresh documents', '', !readable, busy)}</div>`;
    if (!readable)
      return `<section class="panel documents-panel">${heading}<div class="panel-body"><p>Document access is outside this session's permissions.</p></div></section>`;
    if (error)
      return `<section class="panel documents-panel">${heading}<div class="panel-body"><div class="message error-message" role="alert">${e(error.message || String(error))}<p>Document availability is unknown. Refresh before requesting another pack.</p></div></div></section>`;
    if (!catalog || !report)
      return `<section class="panel documents-panel">${heading}<div class="panel-body"><p role="status">Loading registered templates and retained document evidence…</p></div></section>`;
    const jobs = report.documents;
    const packs = catalog?.packs || [];
    const options = packs
      .map(({ pack }) => {
        const existing = jobs.find(
          (job) =>
            job.request.recordVersion === record.version &&
            job.request.pack.id === pack.id &&
            job.request.pack.version === pack.version,
        );
        const unavailable = !issue || record.status === 'quoted' || !!existing;
        return `<article class="documents-pack"><div><h3>${e(pack.name)}</h3><p>${pack.templates.length} templates · PDF and HTML · Version ${e(pack.version)}</p><p class="field-help">Explicit synthetic training pack. No customer-approved certificate or legal wording is implied.</p></div><div>${button('request', 'Generate training pack', `data-pack-id="${e(pack.id)}" data-pack-version="${e(pack.version)}"`, unavailable, busy)}<p class="field-help">${!issue ? 'Document issue permission is required.' : record.status === 'quoted' ? 'Bind through the authorized workflow first. Documents cannot issue a quote.' : existing ? 'This exact revision already has a retained pack request.' : `Pins this transaction at revision ${record.version}.`}</p></div></article>`;
      })
      .join('');
    const rows = jobs
      .map(
        (job) =>
          `<article class="documents-job"><div class="documents-job-heading"><div><h3>${e(job.request.pack.name)}</h3><span class="tag ${job.state.status === 'completed' ? 'valid' : 'warning'}">${e(status[job.state.status] || job.state.status)}</span><p class="field-help">${e(titleCase(job.request.snapshot.event.type))} · Transaction revision ${job.request.recordVersion} · Attempt ${job.state.attempts}/3${job.request.recordVersion === record.version ? '' : ' · Retained earlier revision'}<br>Requested ${e(date(job.request.createdAt))}</p></div><div class="documents-actions">${button('inspect', 'Inspect document history', `data-job-id="${e(job.request.id)}"`, false, busy)}${job.canRetry ? button('retry', 'Retry generation', `data-job-id="${e(job.request.id)}"`, !issue, busy) : ''}</div></div>${job.state.failureCode ? `<p class="message warning-message">${e(failures[job.state.failureCode] || job.state.failureCode)}</p>` : ''}<div class="documents-downloads">${job.artifacts.map((artifact) => `<div><strong>${e(job.request.pack.templates.find((template) => template.id === artifact.templateId)?.title || titleCase(artifact.templateId))}</strong><p class="field-help">${e(artifact.format.toUpperCase())} · ${Math.ceil(artifact.byteLength / 1024)} KB · Revision ${artifact.documentVersion}</p>${button('download', `Download ${artifact.format.toUpperCase()}`, `data-artifact-id="${e(artifact.id)}"`, false, busy)}</div>`).join('')}</div></article>`,
      )
      .join('');
    const inspected = detail
      ? `<section class="documents-history" aria-label="Immutable document history"><h3>Immutable generation history</h3><ol>${detail.history.map((item) => `<li><strong>${e(status[item.status] || item.status)}</strong><span>${e(date(item.occurredAt))} · Attempt ${item.attempts}${item.failureCode ? ' · ' + e(item.failureCode) : ''}</span></li>`).join('')}</ol><details class="insurance-trace"><summary>Exact transaction, template and content references</summary><p class="field-help">Original outputs remain tied to their historical transaction. Later servicing and configuration changes do not replace them.</p><pre class="json-output" tabindex="0" aria-label="Canonical document evidence">${e(JSON.stringify(detail, null, 2))}</pre></details></section>`
      : '';
    return `<section class="panel documents-panel">${heading}<div class="panel-body"><p class="documents-boundary">These registered outputs are synthetic transaction evidence. Generating or downloading a file does not bind insurance, verify payment, send a communication or establish customer-approved cover.</p>${options || '<p class="field-help">No document pack is registered for this environment. Template setup remains unconfigured.</p>'}<div class="documents-register"><h3>Retained document packs</h3>${rows || '<p class="field-help">No document request has been recorded for this insurance record.</p>'}${report?.hasMore ? '<p class="field-help">Showing the latest 50 packs. Retained artifacts remain retrievable by their authorized references.</p>' : ''}</div>${inspected}</div></section>`;
  }
  return { render };
};

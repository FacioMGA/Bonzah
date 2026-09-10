'use strict';
window.createInsuranceFnol = ({
  api,
  getContext,
  getEpoch,
  getRecord,
  getHistory = () => null,
  isBusy,
  setBusy,
  render,
  notify,
  showError,
  markDirty,
  discardAllowed,
  openForm,
  escape: e,
  titleCase,
}) => {
  let catalog = null,
    report = null,
    selected = null,
    error = null,
    form = null,
    pending = null,
    recordId = null,
    generation = 0;
  const has = (permission) => (getContext()?.permissions || []).includes(permission);
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const terms = (record) =>
    (record.configuredService?.submission ?? record.decision?.submission)?.term ??
    record.quote.term;
  const history = () => getHistory()?.revisions ?? [getRecord()];
  const status = (value) =>
    ({
      draft: 'Draft saved',
      submitted: 'Submitted for internal handoff',
      acknowledged: 'Internal training receipt recorded',
    })[value] || value;
  const button = (action, label, extra = '', disabled = false) =>
    `<button type="button" class="button secondary" data-workflow-guard data-insurance-fnol-action="${e(action)}" ${extra} ${disabled || isBusy() ? 'disabled' : ''} ${disabled ? 'data-fnol-unavailable' : ''}>${e(label)}</button>`;
  const field = (
    path,
    label,
    value,
    { type = 'text', help = '', readonly = false, textarea = false } = {},
  ) =>
    `<div class="form-field"><label for="fnol-${e(path)}">${e(label)}</label>${textarea ? `<textarea id="fnol-${e(path)}" data-fnol-field="${e(path)}" rows="4" ${readonly ? 'readonly' : ''}>${e(value || '')}</textarea>` : `<input id="fnol-${e(path)}" data-fnol-field="${e(path)}" type="${e(type)}" value="${e(value || '')}" ${readonly ? 'readonly' : ''}>`}${help ? `<p class="field-help">${e(help)}</p>` : ''}</div>`;
  const choice = (path, label, value, choices) =>
    `<div class="form-field"><label for="fnol-${e(path)}">${e(label)}</label><select id="fnol-${e(path)}" data-fnol-field="${e(path)}">${choices.map(([id, name]) => `<option value="${e(id)}" ${id === value ? 'selected' : ''}>${e(name)}</option>`).join('')}</select></div>`;
  function discardDraft() {
    form = pending = null;
    markDirty(false);
  }
  function reset() {
    generation++;
    catalog = report = selected = error = form = pending = recordId = null;
  }
  async function load(record) {
    reset();
    if (!record) return;
    recordId = record.id;
    if (!has('fnol:read')) return;
    const epoch = getEpoch(),
      request = generation;
    const results = await Promise.allSettled([
      api('/api/insurance/fnol/catalog'),
      api(`/api/insurance/fnol?recordId=${encodeURIComponent(record.id)}`),
    ]);
    if (epoch !== getEpoch() || request !== generation) return;
    if (results[0].status === 'fulfilled') catalog = results[0].value;
    else error = results[0].reason;
    if (results[1].status === 'fulfilled') report = results[1].value;
    else error = results[1].reason;
  }
  const blankDetails = () => ({
    insured: { displayName: '', reference: '' },
    reporter: { displayName: '', role: 'insured', contact: { email: '', phone: '' } },
    preparer: { displayName: '', role: 'reporter', company: '', contact: { email: '', phone: '' } },
    loss: {
      occurredAt: '',
      reportedTimeZone: '',
      location: '',
      kind: 'property',
      description: '',
      injuryStatus: 'unknown',
    },
    evidence: [],
    declaration: { confirmed: false, statementVersion: 'synthetic-intake-v1' },
  });
  function capture() {
    const element = document.querySelector('#insurance-fnol-form');
    if (!element || !form) return;
    element.querySelectorAll('[data-fnol-field]').forEach((input) => {
      const parts = input.dataset.fnolField.split('.');
      let value = form;
      for (const part of parts.slice(0, -1)) value = value[part];
      value[parts.at(-1)] = input.type === 'checkbox' ? input.checked : input.value;
    });
  }
  function renderForm() {
    if (!form) return '';
    const disabled = !has('fnol:write') || !!pending;
    if (form.mode === 'submit')
      return `<form id="insurance-fnol-form" class="fnol-form"><h3>Review this notice for submission</h3><p>Submission freezes the reported facts. The next handoff records an internal training receipt, with no external delivery or claim determination.</p><fieldset data-workflow-guard ${disabled || isBusy() ? 'disabled' : ''} ${disabled ? 'data-fnol-unavailable' : ''}><legend>Possible duplicate review</legend>${choice(
        'duplicateDisposition',
        'Duplicate disposition',
        form.duplicateDisposition,
        [
          ['needs_review', 'Needs review'],
          ['related_notice', 'Related notice'],
          ['not_duplicate', 'Different reported loss'],
        ],
      )}${field('duplicateReason', 'Duplicate review rationale', form.duplicateReason, { textarea: true, help: 'Required when the server identifies a possible duplicate; explain the relationship without deleting either record.' })}</fieldset><div class="fnol-actions">${button('cancel', 'Discard form')}<button type="submit" class="button primary" data-workflow-guard ${disabled || isBusy() ? 'disabled' : ''} ${disabled ? 'data-fnol-unavailable' : ''}>Submit retained notice</button></div></form>`;
    const d = form.details,
      policy =
        history().find((item) => item?.version === Number(form.policyVersion)) ??
        selected?.notice.policySnapshot ??
        getRecord(),
      term = terms(policy);
    return `<form id="insurance-fnol-form" class="fnol-form"><h3>${form.mode === 'edit' ? 'Resume saved notice' : 'New internal loss notice'}</h3><p class="field-help">Save incomplete facts as a draft, review them, then submit once. Do not include identity numbers, detailed medical records or unnecessary personal data.</p><fieldset data-workflow-guard ${disabled || isBusy() ? 'disabled' : ''} ${disabled ? 'data-fnol-unavailable' : ''}><legend>Policy and source</legend><div class="fnol-form-grid">${field('sourceReference', 'Source notice reference', form.sourceReference, { readonly: form.mode === 'edit', help: 'Stable source reference. Reusing it will inspect the retained notice or reject conflicting facts.' })}${
      form.mode === 'create'
        ? choice(
            'policyVersion',
            'Historical policy revision',
            String(form.policyVersion),
            history()
              .filter((item) => item && item.status !== 'quoted')
              .map((item) => [
                String(item.version),
                `Revision ${item.version} · ${titleCase(item.status)} · ${terms(item).startDate} to ${terms(item).endDate}`,
              ]),
          )
        : `<p>Policy revision ${policy.version} is pinned to this saved notice.</p>`
    }${
      form.mode === 'create'
        ? choice(
            'destinationKey',
            'Registered intake destination',
            form.destinationKey,
            catalog.destinations.map(({ destination }) => [
              `${destination.id}@${destination.version}`,
              `${destination.label} · ${destination.version}`,
            ]),
          )
        : ''
    }</div><p class="field-help">Selected recorded term: ${e(term.startDate)} to ${e(term.endDate)}. The loss date is checked against this retained term; this does not determine coverage.</p></fieldset><fieldset data-workflow-guard ${disabled || isBusy() ? 'disabled' : ''} ${disabled ? 'data-fnol-unavailable' : ''}><legend>Insured, reporter and preparer</legend><div class="fnol-form-grid">${field('details.insured.displayName', 'Declared insured name', d.insured.displayName)}${field('details.insured.reference', 'Insured reference (optional)', d.insured.reference)}${field('details.reporter.displayName', 'Reporter name', d.reporter.displayName)}${choice(
      'details.reporter.role',
      'Reporter role',
      d.reporter.role,
      [
        ['insured', 'Insured'],
        ['renter', 'Renter'],
        ['driver', 'Driver'],
        ['broker', 'Broker'],
        ['other', 'Other'],
      ],
    )}${field('details.reporter.contact.email', 'Reporter email', d.reporter.contact.email, { type: 'email' })}${field('details.reporter.contact.phone', 'Reporter phone', d.reporter.contact.phone, { type: 'tel' })}${field('details.preparer.displayName', 'Preparer name', d.preparer.displayName)}${choice(
      'details.preparer.role',
      'Preparer role',
      d.preparer.role,
      [
        ['reporter', 'Reporter'],
        ['broker', 'Broker'],
        ['authorized_representative', 'Declared authorized representative'],
        ['other', 'Other'],
      ],
    )}${field('details.preparer.company', 'Preparer company (optional)', d.preparer.company)}${field('details.preparer.contact.email', 'Preparer email (optional)', d.preparer.contact.email, { type: 'email' })}${field('details.preparer.contact.phone', 'Preparer phone (optional)', d.preparer.contact.phone, { type: 'tel' })}</div><p class="field-help">Declared roles do not grant access or establish legal authority. The signed-in actor is recorded separately by the server.</p></fieldset><fieldset data-workflow-guard ${disabled || isBusy() ? 'disabled' : ''} ${disabled ? 'data-fnol-unavailable' : ''}><legend>Reported loss</legend><div class="fnol-form-grid">${field('details.loss.occurredAt', 'Loss timestamp with UTC offset', d.loss.occurredAt, { help: 'Use an explicit ISO timestamp, for example 2026-09-09T14:30:00+01:00. Do not silently assume a timezone.' })}${field('details.loss.reportedTimeZone', 'Source timezone interpretation', d.loss.reportedTimeZone, { help: 'Record the stated timezone or the source of the UTC offset.' })}${choice(
      'details.loss.kind',
      'Reported loss category',
      d.loss.kind,
      [
        ['property', 'Property'],
        ['vehicle', 'Vehicle'],
        ['injury', 'Injury'],
        ['other', 'Other'],
      ],
    )}${choice('details.loss.injuryStatus', 'Injury status reported', d.loss.injuryStatus, [
      ['unknown', 'Not yet known'],
      ['none_reported', 'None reported'],
      ['reported', 'Injury reported'],
    ])}</div>${field('details.loss.location', 'Loss location or location reference', d.loss.location)}${field('details.loss.description', 'Reported loss narrative', d.loss.description, { textarea: true })}</fieldset><fieldset data-workflow-guard ${disabled || isBusy() ? 'disabled' : ''} ${disabled ? 'data-fnol-unavailable' : ''}><legend>Evidence references</legend><p class="field-help">References are retained as submitted; this flow does not upload, verify or share files. Use authorized evidence references, without public customer links or access tokens.</p>${d.evidence
      .map(
        (item, index) =>
          `<div class="fnol-evidence-row">${choice(
            `details.evidence.${index}.kind`,
            `Evidence ${index + 1} type`,
            item.kind,
            [
              ['other', 'Other'],
              ['photo', 'Photo'],
              ['police_report', 'Police report'],
              ['rental_contract', 'Rental contract'],
              ['certificate', 'Certificate'],
              ['repair_estimate', 'Repair estimate'],
            ],
          )}${field(`details.evidence.${index}.reference`, `Evidence ${index + 1} reference`, item.reference)}${field(`details.evidence.${index}.description`, `Evidence ${index + 1} description`, item.description)}${button('remove-evidence', 'Remove evidence', `data-fnol-index="${index}"`, disabled)}</div>`,
      )
      .join(
        '',
      )}${button('add-evidence', 'Add evidence reference', '', disabled || d.evidence.length >= 30)}<label class="fnol-declaration"><input type="checkbox" data-fnol-field="details.declaration.confirmed" ${d.declaration.confirmed ? 'checked' : ''}>I confirm these are the reported training facts and understand this submission does not determine coverage or create a legal signature.</label></fieldset><div class="fnol-actions">${button('cancel', 'Discard form')}<button type="submit" class="button primary" data-workflow-guard ${disabled || isBusy() ? 'disabled' : ''} ${disabled ? 'data-fnol-unavailable' : ''}>Save notice draft</button></div></form>`;
  }
  function renderPanel() {
    const record = getRecord();
    if (!record || record.id !== recordId) return '';
    const heading = `<div class="panel-heading"><div><h2 id="insurance-fnol-title">Loss notice intake</h2><p>Policy-linked facts, review and internal acknowledgement.</p></div>${button('refresh', 'Refresh loss notices', '', !has('fnol:read'))}</div>`;
    if (!has('fnol:read'))
      return `<section class="panel fnol-panel">${heading}<div class="panel-body">Loss notice access is outside this session's permissions.</div></section>`;
    if (error)
      return `<section class="panel fnol-panel">${heading}<div class="panel-body"><p class="message error-message" role="alert">${e(error.message || String(error))}</p></div></section>`;
    if (!catalog || !report)
      return `<section class="panel fnol-panel">${heading}<div class="panel-body" role="status">Loading retained intake evidence…</div></section>`;
    const detail = selected
      ? `<section class="fnol-inspection"><h3>Retained notice review</h3><dl class="insurance-facts"><div><dt>Source reference</dt><dd>${e(selected.notice.sourceReference)}</dd></div><div><dt>Policy revision / term</dt><dd>${selected.notice.policySnapshot.version} · ${e(selected.assessment.term.startDate)} to ${e(selected.assessment.term.endDate)}</dd></div><div><dt>Term comparison</dt><dd>${e(titleCase(selected.assessment.termStatus))}</dd></div><div><dt>Reported loss</dt><dd>${e(selected.notice.details.loss.occurredAt || 'Not supplied')}</dd></div><div><dt>Insured / location</dt><dd>${e(selected.notice.details.insured.displayName || 'Not supplied')} · ${e(selected.notice.details.loss.location || 'Not supplied')}</dd></div><div><dt>Preparer</dt><dd>${e(selected.notice.details.preparer.displayName || 'Not supplied')} · ${e(titleCase(selected.notice.details.preparer.role))}</dd></div></dl><p>${e(selected.notice.details.loss.description || 'No loss narrative saved yet.')}</p><ul class="fnol-flags">${selected.assessment.flags.map((flag) => `<li>${e(flag)}</li>`).join('')}</ul>${selected.assessment.submitIssues.length && selected.notice.status === 'draft' ? `<div class="message warning-message"><strong>Before submission</strong><ul>${selected.assessment.submitIssues.map((issue) => `<li>${e(issue.message)}</li>`).join('')}</ul></div>` : ''}${selected.notice.duplicateReview ? `<p><strong>Recorded duplicate disposition:</strong> ${e(titleCase(selected.notice.duplicateReview.disposition))}<br>${e(selected.notice.duplicateReview.reason)}</p>` : ''}<h4>Immutable intake history</h4><ol>${selected.history.map((item) => `<li>${e(status(item.status))} · Revision ${item.version} · ${e(item.occurredAt)} · Actor ${e(item.actorId)}</li>`).join('')}</ol>${selected.notice.acknowledgement ? '<p class="message success-message">The registered internal training queue retained an acknowledgement. External delivery was not attempted.</p>' : ''}<details class="insurance-trace"><summary>Exact policy, evidence, duplicate and receipt references</summary><pre class="json-output" tabindex="0">${e(JSON.stringify(selected, null, 2))}</pre></details></section>`
      : '';
    return `<section class="panel fnol-panel">${heading}<div class="panel-body"><p class="fnol-boundary">Synthetic internal intake only. This records reported facts and a local queue receipt. It does not decide coverage, notify a carrier, issue a public claim link, settle a claim or create an electronic legal signature.</p>${button('new', 'New loss notice', '', !has('fnol:write') || !catalog.destinations.length || record.status === 'quoted')}${!catalog.destinations.length ? '<p>No intake destination is registered. Customer routing remains unconfigured.</p>' : ''}${pending ? `<div class="message warning-message">The last write has an uncertain result. Retain this request identity until its evidence is inspected.${button('retry', 'Retry unchanged request')}</div>` : ''}${renderForm()}<div class="fnol-register">${report.notices.map((item) => `<article class="fnol-notice"><div><h3>${e(item.notice.sourceReference)}</h3><span class="tag">${e(status(item.notice.status))}</span><p class="field-help">Notice revision ${item.notice.version} · Policy revision ${item.notice.policySnapshot.version} · ${e(item.notice.details.loss.location || 'Location pending')}</p>${item.assessment.possibleDuplicateIds.length ? `<p>${item.assessment.possibleDuplicateIds.length} possible related ${item.assessment.possibleDuplicateIds.length === 1 ? 'notice' : 'notices'}${item.notice.duplicateReview ? ` · Recorded disposition: ${e(titleCase(item.notice.duplicateReview.disposition))}` : ' · Review required before submission'}.</p>` : ''}</div><div class="fnol-actions">${button('inspect', 'Inspect loss notice', `data-notice-id="${e(item.notice.id)}"`)}${button('edit', 'Resume draft', `data-notice-id="${e(item.notice.id)}"`, !has('fnol:write') || item.notice.status !== 'draft')}${button('submit', 'Review submission', `data-notice-id="${e(item.notice.id)}"`, !item.assessment.canSubmit)}${button('handoff', 'Acknowledge in training queue', `data-notice-id="${e(item.notice.id)}"`, !item.assessment.canHandoff)}</div></article>`).join('') || '<p class="field-help">No loss notice has been saved for this record.</p>'}${report.hasMore ? '<p>Showing the latest 50 notices. Earlier notices remain retrievable by authorized reference.</p>' : ''}</div>${detail}</div></section>`;
  }
  async function write(path, method, payload, message) {
    const epoch = getEpoch(),
      request = generation,
      target = recordId;
    if (
      pending &&
      (pending.path !== path ||
        pending.method !== method ||
        JSON.stringify(pending.payload) !== JSON.stringify(payload))
    ) {
      notify(
        'Retry the uncertain request unchanged, or inspect its retained evidence before preparing another write.',
        'warning',
      );
      return;
    }
    pending ||= { path, method, payload, idempotencyKey: crypto.randomUUID() };
    setBusy(true);
    try {
      const result = await api(path, {
        method,
        body: JSON.stringify({ ...pending.payload, idempotencyKey: pending.idempotencyKey }),
      });
      if (epoch !== getEpoch() || request !== generation) return;
      discardDraft();
      await load(getRecord());
      if (epoch === getEpoch() && target === recordId) {
        selected = result;
        notify(message);
      }
    } catch (failure) {
      if (epoch !== getEpoch() || request !== generation) return;
      if (failure.status && failure.status < 500) pending = null;
      else markDirty(true);
      showError(failure, 'Review the notice evidence before retrying.');
    } finally {
      if (epoch === getEpoch()) {
        setBusy(false);
        render();
      }
    }
  }
  async function handleClick(event) {
    const element = event.target.closest('[data-insurance-fnol-action]');
    if (!element) return false;
    event.preventDefault();
    if (element.disabled || isBusy() || !getRecord()) return true;
    capture();
    const action = element.dataset.insuranceFnolAction;
    if (action === 'retry') {
      if (pending)
        await write(
          pending.path,
          pending.method,
          pending.payload,
          'The retained request result was recovered.',
        );
      return true;
    }
    if (action === 'add-evidence') {
      form.details.evidence.push({ kind: 'other', reference: '', description: '' });
      markDirty(true);
      render();
      return true;
    }
    if (action === 'remove-evidence') {
      form.details.evidence.splice(Number(element.dataset.fnolIndex), 1);
      markDirty(true);
      render();
      return true;
    }
    if (!discardAllowed()) return true;
    if (action === 'cancel') {
      discardDraft();
      render();
      return true;
    }
    if (action === 'refresh') {
      setBusy(true);
      try {
        await load(getRecord());
      } finally {
        setBusy(false);
        render();
      }
      return true;
    }
    if (action === 'new') {
      if (!has('fnol:write') || !catalog?.destinations.length) return true;
      openForm();
      discardDraft();
      const destination = catalog.destinations[0].destination;
      form = {
        mode: 'create',
        policyVersion: String(getRecord().version),
        sourceReference: '',
        destinationKey: `${destination.id}@${destination.version}`,
        details: blankDetails(),
      };
      render();
      return true;
    }
    const epoch = getEpoch(),
      request = generation;
    setBusy(true);
    try {
      const item = await api(
        `/api/insurance/fnol/notice?noticeId=${encodeURIComponent(element.dataset.noticeId)}`,
      );
      if (epoch !== getEpoch() || request !== generation) return true;
      discardDraft();
      selected = item;
      if (action === 'edit' && has('fnol:write') && item.notice.status === 'draft') {
        openForm();
        form = {
          mode: 'edit',
          noticeId: item.notice.id,
          expectedVersion: item.notice.version,
          noticeHash: item.notice.noticeHash,
          policyVersion: String(item.notice.policySnapshot.version),
          sourceReference: item.notice.sourceReference,
          details: copy(item.notice.details),
        };
      }
      if (action === 'submit' && item.assessment.canSubmit) {
        openForm();
        form = {
          mode: 'submit',
          noticeId: item.notice.id,
          expectedVersion: item.notice.version,
          noticeHash: item.notice.noticeHash,
          duplicateDisposition: 'needs_review',
          duplicateReason: '',
        };
      }
      if (action === 'handoff' && item.assessment.canHandoff)
        await write(
          '/api/insurance/fnol/handoff',
          'POST',
          {
            noticeId: item.notice.id,
            expectedVersion: item.notice.version,
            noticeHash: item.notice.noticeHash,
          },
          'Internal training receipt retained; no external delivery attempted.',
        );
    } catch (failure) {
      if (epoch === getEpoch()) showError(failure, 'The notice could not be inspected.');
    } finally {
      if (epoch === getEpoch()) {
        setBusy(false);
        render();
      }
    }
    return true;
  }
  async function handleSubmit(event) {
    if (event.target.id !== 'insurance-fnol-form') return false;
    event.preventDefault();
    if (isBusy() || !form || pending) return true;
    capture();
    if (form.mode === 'submit') {
      const duplicateReview = form.duplicateReason.trim()
        ? { disposition: form.duplicateDisposition, reason: form.duplicateReason.trim() }
        : null;
      await write(
        '/api/insurance/fnol/submit',
        'POST',
        {
          noticeId: form.noticeId,
          expectedVersion: form.expectedVersion,
          noticeHash: form.noticeHash,
          duplicateReview,
        },
        'Reported facts submitted for internal handoff.',
      );
    } else if (form.mode === 'edit')
      await write(
        '/api/insurance/fnol',
        'PUT',
        {
          noticeId: form.noticeId,
          expectedVersion: form.expectedVersion,
          noticeHash: form.noticeHash,
          details: form.details,
        },
        'Draft revision saved; original facts remain in history.',
      );
    else {
      const policy = history().find((item) => item?.version === Number(form.policyVersion));
      if (!policy) {
        notify('Refresh the retained policy history before creating this notice.', 'warning');
        return true;
      }
      const [destinationId, destinationVersion] = form.destinationKey.split('@');
      await write(
        '/api/insurance/fnol',
        'POST',
        {
          recordId: policy.id,
          recordVersion: policy.version,
          recordHash: policy.recordHash,
          sourceReference: form.sourceReference,
          details: form.details,
          destinationId,
          destinationVersion,
        },
        'Loss notice draft saved. Review missing facts before submission.',
      );
    }
    return true;
  }
  function handleInput(event) {
    if (!event.target.closest('#insurance-fnol-form')) return false;
    capture();
    markDirty(true);
    return true;
  }
  function handleChange(event) {
    if (!handleInput(event)) return false;
    if (event.target.dataset.fnolField === 'policyVersion') render();
    return true;
  }
  return {
    load,
    reset,
    render: renderPanel,
    handleClick,
    handleInput,
    handleChange,
    handleSubmit,
    discardDraft,
    hasPendingWrite: () => !!pending,
  };
};

'use strict';

// Presentation and input parsing only; the canonical service owns every review decision.
window.createInsuranceApprovalView = ({ escape: e, titleCase, money }) => {
  const statuses = {
    requested: 'Awaiting independent review',
    approved: 'Approved for the pinned quote',
    declined: 'Review declined',
    revoked: 'Review withdrawn',
    expired: 'Review expired',
    stale: 'Quote changed — review no longer applies',
    consumed: 'Approval retained with binding',
  };
  const gate = (value) =>
    value === 'referral' ? 'Underwriting referral' : 'Independent review prerequisite';
  const when = (value) =>
    value ? value.replace('T', ' ').replace(/(?:\.\d+)?Z$/, ' UTC') : 'Not recorded';
  const fact = (label, value) =>
    '<div><dt>' + e(label) + '</dt><dd>' + e(value ?? 'Not recorded') + '</dd></div>';
  const disabled = (unavailable, busy) =>
    (unavailable || busy ? ' disabled' : '') + (unavailable ? ' data-approval-unavailable' : '');
  const action = (name, label, { id = '', unavailable = false, busy = false } = {}) =>
    '<button type="button" data-workflow-guard class="button secondary small" data-insurance-approval-action="' +
    e(name) +
    '"' +
    (id ? ' data-approval-id="' + e(id) + '"' : '') +
    disabled(unavailable, busy) +
    '>' +
    e(label) +
    '</button>';
  const refs = (items = []) =>
    items.length
      ? '<ul class="approval-rule-list">' +
        items.map((ref) => '<li>' + e(ref) + '</li>').join('') +
        '</ul>'
      : '<p class="field-help">No supporting references recorded.</p>';
  const selfReview = (approval, actorId) =>
    [approval.requesterId, approval.recordCreatorId, approval.recordAuthorId].includes(actorId);
  function renderRisk(record, definition) {
    const submission = record.decision?.submission;
    const rules =
      record.decision?.evaluation.eligibility.rules.filter((rule) => rule.result !== 'false') || [];
    let result =
      '<div class="approval-summary"><div><h4>' +
      e(record.quote.risk.summary) +
      '</h4><p class="field-help">' +
      e(record.productId) +
      ' · ' +
      e(record.productVersion) +
      ' · Record revision ' +
      record.version +
      '</p><p class="field-help">' +
      e(record.quote.term.startDate) +
      ' → ' +
      e(record.quote.term.endDate) +
      '</p></div><div><strong>' +
      e(money(record.premiumMinor, record.currency)) +
      '</strong><p class="field-help">Retained premium</p></div></div>';
    if (submission) {
      result +=
        '<details class="approval-details"><summary>Review retained risk answers and coverage</summary><dl class="insurance-facts">' +
        fact('Risk territory', submission.territory) +
        Object.entries(submission.answers)
          .map(([key, value]) => {
            const field = definition?.riskFields.find((item) => item.id === key);
            const display =
              field?.type === 'money'
                ? money(value, record.currency)
                : field?.type === 'choice'
                  ? field.options.find((option) => option.id === value)?.label || String(value)
                  : typeof value === 'boolean'
                    ? value
                      ? 'Yes'
                      : 'No'
                    : String(value);
            return (
              '<div><dt>' +
              e(field?.label || key + ' · canonical value') +
              '</dt><dd>' +
              e(display) +
              '</dd>' +
              (field?.description ? '<p class="field-help">' + e(field.description) + '</p>' : '') +
              '</div>'
            );
          })
          .join('') +
        '</dl><ul class="approval-cover-list">' +
        submission.coverages
          .map(
            (cover) =>
              '<li><strong>' +
              e(
                definition?.coverages.find((item) => item.id === cover.coverageId)?.name ||
                  cover.coverageId,
              ) +
              '</strong> · Limit ' +
              e(money(cover.limitMinor, record.currency)) +
              ' · Deductible ' +
              e(money(cover.deductibleMinor, record.currency)) +
              '</li>',
          )
          .join('') +
        '</ul><p class="field-help">Single risk, per occurrence. Question labels, types and coverage names come from the quote’s retained definition. Money uses the record currency.</p>' +
        (!definition
          ? '<p class="field-help">The retained typed definition is unavailable. Answer values above are canonical values; do not assume their units. Refresh the review before deciding.</p>'
          : '') +
        '<h4>Submission evidence</h4>' +
        refs(submission.evidenceRefs) +
        '</details>';
    } else
      result +=
        '<p class="field-help">This record retains an externally supplied quote. Its declaration is not authenticated provider or carrier evidence.</p>';
    if (rules.length)
      result +=
        '<h4>Rules requiring attention</h4><ul class="approval-rule-list">' +
        rules
          .map(
            (rule) =>
              '<li><strong>' +
              e(titleCase(rule.outcome)) +
              ' · ' +
              e(rule.result) +
              '</strong> — ' +
              e(rule.reason) +
              '<p class="field-help">' +
              e(rule.ruleId) +
              ' · ' +
              e(rule.sourceRefs.join(' · ')) +
              '</p></li>',
          )
          .join('') +
        '</ul>';
    return result;
  }
  function targetDetails(approval) {
    const target = approval.target;
    const values = [
      ['Approval identifier', approval.id],
      ['Approval revision', approval.version],
      ['Approval hash', approval.approvalHash],
      ['Previous approval hash', approval.previousApprovalHash],
      ['Record identifier', target.recordId],
      ['Reviewed quote revision', target.recordVersion],
      ['Record hash', target.recordHash],
      ['Quote hash', target.quoteHash],
      ['Product', target.productId + ' · ' + target.productVersion],
      ['Operating policy hash', target.policyHash],
      ['Definition hash', target.definitionHash],
      ['Input hash', target.inputHash],
      ['Decision hash', target.decisionHash],
      ['Runtime release', target.runtimeReleaseId],
      ['Release hash', target.releaseHash],
      ['Requester', approval.requesterId],
      ['Original record creator', approval.recordCreatorId],
      ['Record revision author', approval.recordAuthorId],
      ['Latest acting user', approval.actorId],
      ['Correlation reference', approval.correlationId],
    ];
    return (
      '<details class="approval-details insurance-trace"><summary>Exact quote, identity and approval references</summary><dl class="insurance-facts">' +
      values.map(([label, value]) => fact(label, value)).join('') +
      '</dl></details>'
    );
  }
  function renderItem(view, { actorId, permissions, busy }) {
    const approval = view.approval,
      status = view.effectiveStatus;
    const independent = !selfReview(approval, actorId);
    const reviewer = permissions.includes('insurance:approve');
    let result =
      '<article class="approval-item" data-approval-item="' +
      e(approval.id) +
      '"><div class="approval-item-header"><div><h4>Review for quote revision ' +
      approval.target.recordVersion +
      '</h4><p class="field-help">' +
      e(approval.gates.map(gate).join(' · ')) +
      '</p></div><span class="approval-status" data-status="' +
      e(status) +
      '">' +
      e(statuses[status] || titleCase(status)) +
      '</span></div><p>' +
      e(approval.reason) +
      '</p><p class="field-help">Requested ' +
      e(when(approval.requestedAt)) +
      ' · Expires ' +
      e(when(approval.expiresAt)) +
      '</p><p class="field-help">Latest action: ' +
      e(titleCase(approval.action)) +
      ' · ' +
      e(when(approval.occurredAt)) +
      (approval.actorId === actorId ? ' · by you' : '') +
      '</p>';
    if (view.blockers.length)
      result +=
        '<ul class="approval-rule-list">' +
        view.blockers.map((item) => '<li>' + e(item) + '</li>').join('') +
        '</ul>';
    if (status === 'requested' && !independent)
      result +=
        '<p class="field-help">You cannot review this case because you requested the review, created the record or authored this quote revision. A different authorized administrator must decide.</p>';
    else if (status === 'requested' && !reviewer)
      result +=
        '<p class="field-help">Only an independently authorized reviewer can approve or decline this request.</p>';
    if (status === 'approved')
      result +=
        '<p class="field-help">Approval addresses only its named review gates. Binding rechecks the exact quote and every remaining prerequisite.</p>';
    if (status === 'consumed')
      result +=
        '<p class="field-help">The binding record retains this approval as historical evidence. Withdrawing a review does not cancel a policy.</p>';
    if (['declined', 'revoked'].includes(status))
      result +=
        '<p class="field-help">A new request cannot replace this decision on the same quote revision. A revised quote is required for a new review.</p>';
    result +=
      '<details class="approval-details"><summary>Latest action evidence</summary>' +
      refs(approval.evidenceRefs) +
      '</details>' +
      targetDetails(approval) +
      '<div class="approval-actions">' +
      action('inspect', 'Inspect review history', { id: approval.id, busy });
    if (status === 'requested')
      result += action('review', 'Review request', {
        id: approval.id,
        busy,
        unavailable: !view.canDecide || !reviewer || !independent,
      });
    if (['requested', 'approved'].includes(status))
      result += action('revoke', 'Withdraw review', {
        id: approval.id,
        busy,
        unavailable: !view.canRevoke || !reviewer,
      });
    return result + '</div></article>';
  }
  function renderHistory(detail) {
    if (!detail?.history) return '';
    return (
      '<details class="approval-details" open><summary>Immutable review history · ' +
      detail.history.length +
      ' actions</summary><ol class="approval-rule-list">' +
      detail.history
        .map(
          (entry) =>
            '<li><strong>' +
            e(titleCase(entry.action)) +
            ' · review revision ' +
            entry.version +
            '</strong><p>' +
            e(entry.reason) +
            '</p><p class="field-help">' +
            e(when(entry.occurredAt)) +
            ' · ' +
            e(entry.actorId) +
            '</p>' +
            refs(entry.evidenceRefs) +
            '</li>',
        )
        .join('') +
      '</ol></details>'
    );
  }
  function renderForm({ form, record, report, actorId, permissions, busy }) {
    if (!form) return '';
    const request = form.action === 'request',
      review = form.action === 'review';
    const selected = report?.approvals.find((view) => view.approval.id === form.approvalId);
    const allowed = request
      ? permissions.includes('insurance:quote') && report?.requestAvailability?.canRequest
      : permissions.includes('insurance:approve') &&
        (review
          ? selected?.canDecide && !selfReview(selected.approval, actorId)
          : selected?.canRevoke);
    const title = request
      ? 'Request independent review'
      : review
        ? 'Decide this review'
        : 'Withdraw this review';
    const maximum = report?.requestAvailability?.maximumExpiresAt;
    const rationale = request
      ? 'Review request rationale'
      : review
        ? 'Decision rationale'
        : 'Withdrawal rationale';
    const submit = (value, label, primary = false) =>
      '<button type="submit" data-workflow-guard class="button ' +
      (primary ? 'primary' : 'secondary') +
      '" data-approval-decision="' +
      value +
      '"' +
      disabled(!allowed, busy) +
      '>' +
      label +
      '</button>';
    let result =
      '<form id="insurance-approval-form" class="approval-form" data-approval-form-action="' +
      e(form.action) +
      '"><h4>' +
      title +
      '</h4><p class="field-help">' +
      (request
        ? 'This request pins quote revision ' +
          record.version +
          '. A different authorized reviewer must decide it.'
        : review
          ? 'Inspect the pinned risk, terms and evidence before deciding. The recorded expiry cannot be extended by this action.'
          : 'Withdrawal stops this review from authorizing a future bind. It does not cancel a policy or erase prior actions.') +
      '</p>';
    if (!allowed)
      result +=
        '<div class="message warning-message" role="status">This action is no longer available to your current user. Refresh and inspect its status and permissions.</div>';
    result +=
      '<fieldset data-workflow-guard' +
      disabled(!allowed, busy) +
      '><legend class="visually-hidden">' +
      title +
      '</legend><div class="form-grid"><div class="form-field full-width"><label for="approval-reason">' +
      rationale +
      '</label><textarea id="approval-reason" name="reason" required maxlength="1000" rows="3" aria-describedby="approval-reason-help">' +
      e(form.reason || '') +
      '</textarea><p class="field-help" id="approval-reason-help">Explain the specific risk, review scope and basis for this action. A status alone is not a decision record.</p></div>' +
      '<div class="form-field full-width"><label for="approval-evidenceRefs">Supporting evidence references</label><textarea id="approval-evidenceRefs" name="evidenceRefs" required rows="2" aria-describedby="approval-evidence-help">' +
      e(Array.isArray(form.evidenceRefs) ? form.evidenceRefs.join('\n') : form.evidenceRefs || '') +
      '</textarea><p class="field-help" id="approval-evidence-help">One reference per line, up to 20. Use fictional references for sandbox training. References do not authenticate a provider or establish customer approval.</p></div>';
    if (request)
      result +=
        '<div class="form-field full-width"><label for="approval-expiresAt">Review expires at (UTC)</label><input type="datetime-local" id="approval-expiresAt" name="expiresAt" required' +
        (maximum ? ' max="' + e(maximum.slice(0, 16)) + '"' : '') +
        ' value="' +
        e((form.expiresAt || '').replace(/Z$/, '').slice(0, 16)) +
        '" aria-describedby="approval-expiry-help"><p class="field-help" id="approval-expiry-help">Enter UTC. The server limits validity to seven days and the quote expiry.' +
        (maximum ? ' Latest permitted: ' + e(maximum.replace('T', ' ')) + '.' : '') +
        '</p></div>';
    result +=
      '</div></fieldset><div class="approval-actions">' + action('cancel', 'Cancel', { busy });
    result += request
      ? submit('request', 'Submit review request', true)
      : review
        ? submit('decline', 'Decline review') + submit('approve', 'Approve pinned quote', true)
        : submit('revoke', 'Withdraw review', true);
    return result + '</div></form>';
  }
  function render({
    record,
    report,
    actorId,
    permissions = [],
    busy = false,
    loading = false,
    error = '',
    form = null,
    detail = null,
  }) {
    if (!record) return '';
    const availability = report?.requestAvailability;
    const canRequest = Boolean(availability?.canRequest && permissions.includes('insurance:quote'));
    const options = { actorId, permissions, busy };
    let result =
      '<section class="approval-panel" aria-labelledby="insurance-approval-title" aria-busy="' +
      loading +
      '"><div class="panel-heading"><div><h3 id="insurance-approval-title">Human review</h3><p>Independent review of the exact retained quote.</p></div><div class="approval-actions">' +
      action('refresh', 'Refresh reviews', { busy: busy || loading }) +
      action('request', 'Request review', { unavailable: !canRequest || loading, busy }) +
      '</div></div><div class="panel-body">';
    if (error)
      result +=
        '<div class="message error-message" role="alert" id="insurance-approval-error" tabindex="-1">' +
        e(
          typeof error === 'string'
            ? error
            : error.message || 'Review information could not be loaded.',
        ) +
        '</div>';
    if (loading) result += '<p role="status">Loading current review status…</p>';
    result +=
      renderRisk(record, report?.reviewDefinition) +
      '<p class="field-help">Human review can address its named referral or routine approval gate. It cannot override a decline, invalid data, rating, authority, prohibited backdating, payment or provider requirement.</p>';
    if (availability?.blockers.length)
      result +=
        '<details class="approval-details"><summary>Review request availability</summary><ul class="approval-rule-list">' +
        availability.blockers.map((blocker) => '<li>' + e(blocker) + '</li>').join('') +
        '</ul></details>';
    if (!loading && report && !report.approvals.length)
      result +=
        '<div class="empty-state"><h4>No review requests recorded</h4><p>Request review only when the server identifies a supported gate for this quote.</p></div>';
    result +=
      '<div class="approval-list">' +
      (report?.approvals || []).map((view) => renderItem(view, options)).join('') +
      '</div>';
    if (report?.hasMore)
      result += '<p class="field-help">Only the most recent review records are shown.</p>';
    result += renderHistory(detail) + '</div>' + renderForm({ form, record, report, ...options });
    return result + '</section>';
  }
  function capture(element) {
    const data = new FormData(element);
    const rawExpiry = String(data.get('expiresAt') || '');
    const expiry = new Date(rawExpiry + (rawExpiry.endsWith('Z') ? '' : 'Z'));
    return {
      reason: String(data.get('reason') || '').trim(),
      evidenceRefs: String(data.get('evidenceRefs') || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      ...(data.has('expiresAt')
        ? {
            expiresAt:
              rawExpiry && !Number.isNaN(expiry.getTime()) ? expiry.toISOString() : rawExpiry,
          }
        : {}),
    };
  }
  return { render, capture };
};

'use strict';

window.createInsuranceDecisionView = ({
  escape: e,
  titleCase,
  money,
  toMinor,
  fromMinor,
  moneyDigits,
  field,
  button,
}) => {
  const lines = (value) =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  const select = (id, name, label, options, value, help = '') =>
    `<div class="form-field"><label for="${e(id)}">${e(label)}</label><select id="${e(id)}" name="${e(name)}"><option value="">Choose…</option>${options.map(([key, text]) => `<option value="${e(key)}" ${String(value ?? '') === String(key) ? 'selected' : ''}>${e(text)}</option>`).join('')}</select>${help ? `<p class="field-help">${e(help)}</p>` : ''}</div>`;
  // Presentation only: mirrors the canonical three-valued questionnaire predicates.
  // It never grants underwriting authority; every submitted answer is checked again
  // by the retained server definition. Differential browser tests cover this boundary.
  function questionPresentation(fields, rawAnswers, currency) {
    const states = new Map(),
      effective = {},
      visiting = new Set();
    const units = (value) => {
      const sign = value.startsWith('-') ? -1n : 1n;
      const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
      return sign * (BigInt(whole) * 1000000n + BigInt((fraction + '000000').slice(0, 6)));
    };
    function valueFor(item) {
      const raw = rawAnswers?.[item.id] ?? '';
      if (raw === '') return undefined;
      try {
        if (item.type === 'boolean')
          return raw === 'true' ? true : raw === 'false' ? false : undefined;
        if (item.type === 'integer') {
          const value = Number(raw);
          return /^-?\d+$/.test(raw) &&
            Number.isSafeInteger(value) &&
            value >= item.minimum &&
            value <= item.maximum
            ? value
            : undefined;
        }
        if (item.type === 'money') {
          const value = toMinor(raw, moneyDigits[currency], item.label);
          return BigInt(value) >= BigInt(item.minimumMinor) &&
            BigInt(value) <= BigInt(item.maximumMinor)
            ? value
            : undefined;
        }
        if (item.type === 'decimal') {
          if (!/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(raw) || /^-0(?:\.0+)?$/.test(raw))
            return undefined;
          return (raw.split('.')[1] ?? '').length <= item.scale &&
            units(raw) >= units(item.minimum) &&
            units(raw) <= units(item.maximum)
            ? raw
            : undefined;
        }
        if (item.type === 'date') {
          const parsed = new Date(raw + 'T00:00:00.000Z');
          return /^\d{4}-\d{2}-\d{2}$/.test(raw) &&
            Number.isFinite(parsed.getTime()) &&
            parsed.toISOString().slice(0, 10) === raw &&
            raw >= item.minimum &&
            raw <= item.maximum
            ? raw
            : undefined;
        }
        if (item.type === 'choice')
          return item.options.some((option) => option.id === raw) ? raw : undefined;
        return typeof raw === 'string' &&
          raw.length >= item.minLength &&
          raw.length <= item.maxLength
          ? raw
          : undefined;
      } catch {
        return undefined;
      }
    }
    function condition(when) {
      const outcomes = when.conditions.map((predicate) => {
        const field = fields.find((item) => item.id === predicate.fieldId);
        if (!field) return 'unknown';
        const present = Object.hasOwn(effective, field.id);
        if (predicate.kind === 'presence')
          return (predicate.operator === 'present' ? present : !present) ? 'true' : 'false';
        if (!present) return 'unknown';
        const compare = (value) => {
          let left = effective[field.id],
            right = value;
          if (field.type === 'decimal') {
            left = units(String(left));
            right = units(String(right));
          } else if (field.type === 'money') {
            left = BigInt(left);
            right = BigInt(right);
          }
          return left === right ? 0 : left < right ? -1 : 1;
        };
        if (predicate.kind === 'membership') {
          const included = predicate.values.some((value) => compare(value) === 0);
          return (predicate.operator === 'in' ? included : !included) ? 'true' : 'false';
        }
        const relation = compare(predicate.value);
        return {
          eq: relation === 0,
          neq: relation !== 0,
          lt: relation < 0,
          lte: relation <= 0,
          gt: relation > 0,
          gte: relation >= 0,
        }[predicate.operator]
          ? 'true'
          : 'false';
      });
      return when.mode === 'all'
        ? outcomes.includes('false')
          ? 'false'
          : outcomes.includes('unknown')
            ? 'unknown'
            : 'true'
        : outcomes.includes('true')
          ? 'true'
          : outcomes.includes('unknown')
            ? 'unknown'
            : 'false';
    }
    function visit(field) {
      if (states.has(field.id)) return;
      if (visiting.has(field.id)) {
        states.set(field.id, { visible: 'unknown', required: 'unknown' });
        return;
      }
      visiting.add(field.id);
      for (const when of [field.visibleWhen, field.requiredWhen])
        for (const predicate of when?.conditions ?? []) {
          const dependency = fields.find((item) => item.id === predicate.fieldId);
          if (dependency) visit(dependency);
        }
      if (!states.has(field.id)) {
        const visible = field.visibleWhen ? condition(field.visibleWhen) : 'true';
        const required =
          visible === 'false'
            ? 'false'
            : field.required
              ? 'true'
              : field.requiredWhen
                ? condition(field.requiredWhen)
                : 'false';
        states.set(field.id, { visible, required });
        const value = valueFor(field);
        if (visible === 'true' && value !== undefined) effective[field.id] = value;
      }
      visiting.delete(field.id);
    }
    for (const field of fields) visit(field);
    return states;
  }
  const requiredText = (state) =>
    state.required === 'true'
      ? 'Required.'
      : state.required === 'unknown'
        ? 'Requiredness depends on unanswered controlling questions.'
        : 'Optional.';
  const conditionText = (item, state) =>
    state.visible === 'unknown'
      ? 'Answer the controlling questions to determine whether this question applies.'
      : item.visibleWhen || item.requiredWhen
        ? 'Shown for the current answers; the server checks this condition again when you evaluate.'
        : '';
  function hiddenText(fields, states, answers) {
    const hidden = fields.filter((item) => states.get(item.id)?.visible === 'false');
    if (!hidden.length) return '';
    const saved = hidden.some((item) => (answers?.[item.id] ?? '') !== '');
    return (
      'Not applicable for these answers: ' +
      hidden.map((item) => item.label).join(', ') +
      '. These questions are excluded from the submission.' +
      (saved
        ? ' Previous values stay only in this unsaved form and return if the questions apply again.'
        : '')
    );
  }
  function riskInputs(
    definition,
    form,
    currency,
    fields = definition.riskFields,
    prefix = 'risk',
    answers = form.answers,
    evaluation = null,
    scope = { kind: 'policy' },
  ) {
    const states = questionPresentation(fields, answers, currency);
    const questions = fields
      .map((item) => {
        const name = `${prefix}-${item.id}`;
        const value = answers?.[item.id] ?? '';
        const resolved = states.get(item.id);
        const wrap = (content) =>
          `<div class="decision-risk-question" data-risk-prefix="${e(prefix)}" data-risk-field="${e(item.id)}" ${resolved.visible === 'false' ? 'hidden' : ''}>${content.replace(/<(input|select|textarea) /g, `<$1 aria-required="${resolved.visible !== 'false' && resolved.required === 'true'}" ${resolved.visible === 'false' ? 'disabled ' : ''}`)}<p class="field-help" data-risk-requirement>${e(requiredText(resolved))}</p><p class="field-help" data-risk-condition ${conditionText(item, resolved) ? '' : 'hidden'}>${e(conditionText(item, resolved))}</p></div>`;
        const help = item.description;
        if (item.type === 'choice' || item.type === 'boolean')
          return wrap(
            select(
              `insurance-${name}`,
              name,
              item.label,
              item.type === 'boolean'
                ? [
                    ['true', 'Yes'],
                    ['false', 'No'],
                  ]
                : item.options.map((option) => [option.id, option.label]),
              value,
              help,
            ),
          );
        const bounds =
          item.type === 'money'
            ? `Range ${money(item.minimumMinor, currency)} – ${money(item.maximumMinor, currency)}.`
            : ['integer', 'decimal', 'date'].includes(item.type)
              ? `Range ${item.minimum} – ${item.maximum}.`
              : `${item.minLength}–${item.maxLength} characters.`;
        return wrap(
          field(name, item.label + (item.type === 'money' ? ` (${currency})` : ''), {
            value,
            required: false,
            type: item.type === 'date' ? 'date' : 'text',
            help: `${help} ${bounds}${item.type === 'decimal' ? ` Up to ${item.scale} decimal places.` : ''}`,
          }),
        );
      })
      .join('');
    const note = hiddenText(fields, states, answers);
    return (
      questions +
      `<p class="field-help full-width" data-risk-hidden-prefix="${e(prefix)}" ${note ? '' : 'hidden'} role="status">${e(note)}</p>`
    );
  }
  const scopeKey = (scope) =>
    scope.kind === 'policy' ? 'policy' : `risk:${scope.groupId}:${scope.rowId}`;
  const coverageEntries = (definition, form) =>
    definition.coverages.flatMap((coverage) =>
      definition.schemaVersion !== 'insurance-product-v2'
        ? [{ coverage, key: coverage.id, scope: null }]
        : coverage.scope.kind === 'policy'
          ? [{ coverage, key: coverage.id + ':policy', scope: { kind: 'policy' } }]
          : (form.riskGroups?.find((g) => g.groupId === coverage.scope.groupId)?.rows || []).map(
              (row) => ({
                coverage,
                key: coverage.id + ':risk:' + coverage.scope.groupId + ':' + row.rowId,
                scope: { kind: 'risk', groupId: coverage.scope.groupId, rowId: row.rowId },
              }),
            ),
    );
  function coverageInputs(definition, form, currency) {
    return coverageEntries(definition, form)
      .map(({ coverage, key, scope }) => {
        const selected = form.coverages?.[key] || {};
        const basis = coverage.limitBasis
          ? `${scopeKey(scope)} · ${titleCase(coverage.limitBasis)} · ${titleCase(coverage.layer.kind)}`
          : 'Single risk · Per occurrence limit and deductible';
        return `<article class="decision-coverage"><div class="insurance-subheading"><div><h4>${e(coverage.name)}</h4><p class="field-help">${e(coverage.description)}</p><p class="field-help">${e(basis)}</p></div><label class="decision-choice"><input type="checkbox" name="coverage-${e(key)}-selected" ${selected.selected ? 'checked' : ''}> Select${coverage.required ? ' (required)' : ''}</label></div><div class="form-grid">${field(`coverage-${key}-limit`, `Limit (${currency})`, { value: selected.limit || '', required: false, help: `${money(coverage.limit.minimumMinor, currency)} – ${money(coverage.limit.maximumMinor, currency)}` })}${field(`coverage-${key}-deductible`, `Deductible (${currency})`, { value: selected.deductible ?? '', required: false, help: `${money(coverage.deductible.minimumMinor, currency)} – ${money(coverage.deductible.maximumMinor, currency)}` })}${coverage.aggregateLimit ? field(`coverage-${key}-aggregate`, `Aggregate · ${titleCase(coverage.aggregateLimit.basis)} (${currency})`, { value: selected.aggregate || '', required: false, help: `${money(coverage.aggregateLimit.minimumMinor, currency)} – ${money(coverage.aggregateLimit.maximumMinor, currency)}` }) : ''}${coverage.layer?.kind === 'excess' ? field(`coverage-${key}-attachment`, `Excess attachment (${currency})`, { value: selected.attachment || '', required: false, help: `Above selected ${coverage.layer.underlyingCoverageId}; ${money(coverage.layer.attachment.minimumMinor, currency)} – ${money(coverage.layer.attachment.maximumMinor, currency)}. Separate from deductible.` }) : ''}</div><p class="field-help">${coverage.dependsOn.length ? `Requires in same scope: ${e(coverage.dependsOn.join(', '))}. ` : ''}${coverage.excludes.length ? `Cannot combine with: ${e(coverage.excludes.join(', '))}.` : ''}</p></article>`;
      })
      .join('');
  }
  function repeatedInputs(definition, form, currency, evaluation, service) {
    if (definition.schemaVersion !== 'insurance-product-v2') return '';
    return definition.riskGroups
      .map(
        (group) =>
          `<section class="decision-risk-group"><div class="insurance-subheading"><div><h3>${e(group.label)}</h3><p class="field-help">${e(group.description)} · ${group.minimumRows}–${group.maximumRows} rows. Stable identifiers are retained across revisions.</p></div>${button('add-risk-row', 'Add ' + group.label, service ? 'service' : 'quote', true, `data-risk-group="${e(group.id)}" ${(form.riskGroups?.find((g) => g.groupId === group.id)?.rows.length || 0) >= group.maximumRows ? 'disabled data-insurance-unavailable' : ''}`)}</div>${(form.riskGroups?.find((g) => g.groupId === group.id)?.rows || []).map((row) => `<article class="decision-risk-row"><div class="insurance-subheading"><h4>${e(group.label)} · ${e(row.rowId)}</h4>${button('remove-risk-row', 'Remove row', service ? 'service' : 'quote', true, `data-risk-group="${e(group.id)}" data-risk-row="${e(row.rowId)}"`)}</div><div class="form-grid">${riskInputs(definition, form, currency, group.fields, 'risk:' + group.id + ':' + row.rowId, row.answers, evaluation, { kind: 'risk', groupId: group.id, rowId: row.rowId })}</div></article>`).join('')}</section>`,
      )
      .join('');
  }
  function renderForm({
    form,
    definition,
    policy,
    products,
    busy,
    permission,
    evaluation,
    service = false,
    revise = false,
    renewal = false,
    serviceEvaluation = null,
  }) {
    const productOptions = products
      .map(
        ({ policy: item }) =>
          `<option value="${e(item.id + '@' + item.version)}" ${item.id === form.productId && item.version === form.productVersion ? 'selected' : ''}>${e(item.name)} · ${e(item.version)} · ${e(item.currency)}</option>`,
      )
      .join('');
    return `<section class="panel insurance-form-panel"><form id="insurance-quote-form"><div class="panel-heading"><div><h2>${service ? 'Change configured risk or term' : revise ? 'Revise retained configured quote' : renewal ? 'Prepare a distinct renewal term' : 'Evaluate a configured risk'}</h2><p>${service ? 'Preview a new contractual revision using the retained product definition. The original quote remains unchanged.' : revise ? 'Evaluate this quote using its exact retained definition. A new source version replaces the unbound selection and previous reviews become stale.' : renewal ? 'Compare the expiring policy with a new term, updated risks and fresh decisions. No prior approval is reused.' : 'Evaluate the active product definition, review the decision, then retain an exact quote.'}</p></div><span class="tag">Kernel pricing</span></div><div class="panel-body"><fieldset ${!permission || busy ? 'disabled' : ''}><legend class="visually-hidden">Configured insurance submission</legend><div class="form-grid"><div class="form-field full-width"><label for="insurance-product">Registered product version</label><select id="insurance-product" name="product" required ${service || revise ? 'disabled' : ''}>${productOptions}</select></div>${field('riskSummary', 'Risk description', { full: true, help: 'Use a fictional risk for sandbox evaluation.' })}${field('sourceReference', 'Submission reference')}${field('sourceVersion', 'Submission version')}${select(
      'insurance-territory',
      'territory',
      'Risk territory',
      definition.territories.map((code) => [code, code]),
      form.territory,
    )}${field('startDate', 'Term start', { type: 'date' })}${field('endDate', 'Term end', { type: 'date' })}${field('expiresAt', 'Quote expires at (UTC)', { type: 'datetime-local', help: 'Entered time is interpreted as UTC.' })}<div class="form-field full-width"><label for="insurance-evidenceRefs">Submission evidence references</label><textarea id="insurance-evidenceRefs" name="evidenceRefs" required rows="2">${e(form.evidenceRefs)}</textarea><p class="field-help">One source reference per line. Source references alone do not establish approval.</p></div></div><div class="insurance-subheading"><div><h3>Risk information</h3><p class="field-help">Unanswered questions remain unknown. Evaluate to see all validation and underwriting findings.</p></div></div><div class="form-grid">${riskInputs(definition, form, policy.currency, definition.riskFields, 'risk', form.answers, evaluation)}</div>${repeatedInputs(definition, form, policy.currency, evaluation, service)}<div class="insurance-subheading"><div><h3>Coverage selection</h3><p class="field-help">Limits and deductibles use ${e(policy.currency)}. Selection, dependencies and authority are checked by the server.</p></div></div>${coverageInputs(definition, form, policy.currency)}<fieldset ${service ? 'disabled data-insurance-unavailable' : ''}><div class="insurance-subheading"><div><h3>Capacity participants</h3><p class="field-help">Required when retaining the quote. Shares must total exactly 100%.</p></div>${button('add-participant', 'Add participant', 'quote')}</div>${form.participants.map((participant, index) => `<div class="insurance-participant"><div class="form-field"><label for="participant-${index}-id">Participant ${index + 1} identifier</label><input id="participant-${index}-id" name="participant-${index}-id" value="${e(participant.id)}"></div><div class="form-field"><label for="participant-${index}-role">Participant ${index + 1} role</label><select id="participant-${index}-role" name="participant-${index}-role"><option value="lead" ${participant.role === 'lead' ? 'selected' : ''}>Lead</option><option value="follow" ${participant.role === 'follow' ? 'selected' : ''}>Follow</option></select></div><div class="form-field"><label for="participant-${index}-share">Participant ${index + 1} share (%)</label><input id="participant-${index}-share" name="participant-${index}-share" value="${e(participant.sharePercent)}" inputmode="decimal"></div>${button('remove-participant', 'Remove', 'quote', true, `data-participant-index="${index}" ${form.participants.length === 1 ? 'disabled data-insurance-unavailable' : ''}`)}</div>`).join('')}</fieldset>${service ? `<div class="form-grid">${field('effectiveDate', 'Change effective date', { type: 'date', value: form.effectiveDate || '' })}${field('serviceReason', 'Reason for change', { value: form.serviceReason || '', full: true })}</div><p class="field-help">Current/future effective date within the original term. Term shortening, cancellation and reuse of prior bind approval are not supported. Participants remain fixed.</p>` : ''}</fieldset><p class="field-help">${definition.rating.termBasis === 'per_day' ? 'Per-day pricing' : 'Whole-term pricing'} · ${definition.termRules.minimumDays}–${definition.termRules.maximumDays} days inclusive · Backdating: ${e(titleCase(definition.termRules.backdating))}. This evaluation does not calculate tax or proration, authenticate a provider or grant approval. After quote retention, Human review separately reports whether an independent review is available. Operating-policy prerequisites still apply.</p></div><div class="form-actions"><span>Edits invalidate the preview. A preview does not change policy records.</span><div class="form-actions-buttons">${button('close-form', 'Discard form')}${button(service ? 'evaluate-service' : renewal ? 'evaluate-renewal' : 'evaluate', service ? 'Preview change' : renewal ? 'Compare and evaluate renewal' : 'Evaluate risk', 'read', true)}<button type="submit" class="button primary" data-insurance-action="${service ? 'submit-configured-service' : renewal ? 'submit-renewal' : 'submit-quote'}" data-insurance-permission="${service ? 'service' : 'quote'}" ${!permission || busy || !evaluation || evaluation.rating.status !== 'calculated' || (service && serviceEvaluation?.status !== 'allowed') ? 'disabled data-insurance-unavailable' : ''}>${service ? 'Record configured change' : renewal ? 'Retain distinct renewal quote' : 'Retain evaluated quote'}</button></div></div></form>${serviceEvaluation ? renderServiceEvaluation(serviceEvaluation) : ''}${evaluation ? renderEvaluation(evaluation, { preview: true }) : '<div class="panel-body"><p class="field-help" id="insurance-decision-status">No current evaluation. Complete the submission and evaluate the risk.</p></div>'}</section>`;
  }
  function capture(form, definition, element) {
    const data = new FormData(element);
    form.territory = String(data.get('territory') || '');
    const captureAnswers = (fields, prefix, previous = {}) =>
      Object.fromEntries(
        fields.map((item) => [
          item.id,
          data.has(`${prefix}-${item.id}`)
            ? String(data.get(`${prefix}-${item.id}`))
            : (previous[item.id] ?? ''),
        ]),
      );
    form.answers = captureAnswers(definition.riskFields, 'risk', form.answers);
    if (definition.schemaVersion === 'insurance-product-v2')
      for (const group of form.riskGroups || [])
        for (const row of group.rows)
          row.answers = captureAnswers(
            definition.riskGroups.find((g) => g.id === group.groupId)?.fields || [],
            'risk:' + group.groupId + ':' + row.rowId,
            row.answers,
          );
    form.coverages = Object.fromEntries(
      coverageEntries(definition, form).map(({ key }) => [
        key,
        {
          selected: data.has(`coverage-${key}-selected`),
          ...Object.fromEntries(
            ['limit', 'deductible', 'aggregate', 'attachment'].map((name) => [
              name,
              String(data.get(`coverage-${key}-${name}`) ?? ''),
            ]),
          ),
        },
      ]),
    );
    if (data.has('effectiveDate')) form.effectiveDate = String(data.get('effectiveDate'));
    if (data.has('serviceReason')) form.serviceReason = String(data.get('serviceReason'));
  }
  function typedAnswers(fields, rawAnswers, currency) {
    const answers = {},
      states = questionPresentation(fields, rawAnswers, currency);
    for (const item of fields) {
      if (states.get(item.id)?.visible === 'false') continue;
      const raw = rawAnswers?.[item.id] ?? '';
      if (raw === '') continue;
      if (item.type === 'boolean') answers[item.id] = raw === 'true';
      else if (item.type === 'integer') {
        if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
          throw new Error(`${item.label} must be a whole number within the supported range.`);
        answers[item.id] = Number(raw);
      } else if (item.type === 'money')
        answers[item.id] = toMinor(raw, moneyDigits[currency], item.label);
      else answers[item.id] = raw;
    }
    return answers;
  }
  function refreshQuestions(form, definition, element, currency) {
    const groups = [{ fields: definition.riskFields, answers: form.answers, prefix: 'risk' }];
    for (const group of form.riskGroups || [])
      for (const row of group.rows)
        groups.push({
          fields: definition.riskGroups?.find((item) => item.id === group.groupId)?.fields || [],
          answers: row.answers,
          prefix: 'risk:' + group.groupId + ':' + row.rowId,
        });
    for (const group of groups) {
      const states = questionPresentation(group.fields, group.answers, currency);
      for (const question of element.querySelectorAll('[data-risk-field]')) {
        if (question.dataset.riskPrefix !== group.prefix) continue;
        const field = group.fields.find((item) => item.id === question.dataset.riskField),
          state = states.get(field?.id);
        if (!field || !state) continue;
        question.hidden = state.visible === 'false';
        question.querySelectorAll('input,select,textarea').forEach((control) => {
          control.disabled = question.hidden;
          control.setAttribute(
            'aria-required',
            String(!question.hidden && state.required === 'true'),
          );
        });
        question.querySelector('[data-risk-requirement]').textContent = requiredText(state);
        const note = question.querySelector('[data-risk-condition]');
        note.textContent = conditionText(field, state);
        note.hidden = !note.textContent;
      }
      for (const note of element.querySelectorAll('[data-risk-hidden-prefix]'))
        if (note.dataset.riskHiddenPrefix === group.prefix) {
          note.textContent = hiddenText(group.fields, states, group.answers);
          note.hidden = !note.textContent;
        }
    }
  }
  function submission(form, definition, currency) {
    const v2 = definition.schemaVersion === 'insurance-product-v2';
    return {
      ...(v2
        ? {
            schemaVersion: 'insurance-submission-v2',
            riskGroups: (form.riskGroups || []).map((group) => ({
              groupId: group.groupId,
              rows: group.rows.map((row) => ({
                rowId: row.rowId,
                answers: typedAnswers(
                  definition.riskGroups.find((g) => g.id === group.groupId)?.fields || [],
                  row.answers,
                  currency,
                ),
              })),
            })),
          }
        : {}),
      reference: form.sourceReference.trim(),
      version: form.sourceVersion.trim(),
      summary: form.riskSummary.trim(),
      evidenceRefs: lines(form.evidenceRefs),
      territory: form.territory,
      term: { startDate: form.startDate, endDate: form.endDate },
      expiresAt: new Date(form.expiresAt + 'Z').toISOString(),
      answers: typedAnswers(definition.riskFields, form.answers, currency),
      coverages: coverageEntries(definition, form)
        .filter(({ key }) => form.coverages?.[key]?.selected)
        .map(({ coverage, key, scope }) => {
          const selected = form.coverages[key];
          return {
            coverageId: coverage.id,
            limitMinor: toMinor(selected.limit, moneyDigits[currency], coverage.name + ' limit'),
            deductibleMinor: toMinor(
              selected.deductible,
              moneyDigits[currency],
              coverage.name + ' deductible',
            ),
            ...(v2
              ? {
                  scope,
                  ...(coverage.aggregateLimit
                    ? {
                        aggregateMinor: toMinor(
                          selected.aggregate,
                          moneyDigits[currency],
                          coverage.name + ' aggregate',
                        ),
                      }
                    : {}),
                  ...(coverage.layer.kind === 'excess'
                    ? {
                        attachmentMinor: toMinor(
                          selected.attachment,
                          moneyDigits[currency],
                          coverage.name + ' attachment',
                        ),
                      }
                    : {}),
                }
              : {}),
          };
        }),
    };
  }
  function handleAction(action, control, form, definition) {
    if (!['add-risk-row', 'remove-risk-row'].includes(action)) return false;
    if (definition.schemaVersion !== 'insurance-product-v2') return false;
    const groupId = control.dataset.riskGroup,
      groupDefinition = definition.riskGroups.find((g) => g.id === groupId);
    if (!groupDefinition) return false;
    form.riskGroups ??= [];
    let group = form.riskGroups.find((g) => g.groupId === groupId);
    if (!group) {
      group = { groupId, rows: [] };
      form.riskGroups.push(group);
    }
    if (action === 'add-risk-row' && group.rows.length < groupDefinition.maximumRows)
      group.rows.push({ rowId: 'risk-' + crypto.randomUUID(), answers: {} });
    if (action === 'remove-risk-row')
      group.rows = group.rows.filter((row) => row.rowId !== control.dataset.riskRow);
    return true;
  }
  function seedFromSubmission(form, definition, input, currency) {
    const displayAnswers = (fields, answers) =>
      Object.fromEntries(
        Object.entries(answers)
          .filter(([id]) => fields.some((field) => field.id === id))
          .map(([id, value]) => [
            id,
            fields.find((f) => f.id === id)?.type === 'money'
              ? fromMinor(String(value), moneyDigits[currency])
              : String(value),
          ]),
      );
    Object.assign(form, {
      sourceReference: input.reference,
      sourceVersion: '',
      riskSummary: input.summary,
      evidenceRefs: input.evidenceRefs.join('\n'),
      territory: input.territory,
      startDate: input.term.startDate,
      endDate: input.term.endDate,
      expiresAt: '',
      answers: displayAnswers(definition.riskFields, input.answers),
      coverages: {},
      riskGroups: [],
    });
    if (
      input.schemaVersion === 'insurance-submission-v2' &&
      definition.schemaVersion === 'insurance-product-v2'
    )
      form.riskGroups = input.riskGroups
        .filter((group) => definition.riskGroups.some((item) => item.id === group.groupId))
        .map((group) => ({
          groupId: group.groupId,
          rows: group.rows.map((row) => ({
            rowId: row.rowId,
            answers: displayAnswers(
              definition.riskGroups.find((g) => g.id === group.groupId).fields,
              row.answers,
            ),
          })),
        }));
    for (const selection of input.coverages) {
      const key = selection.scope
        ? selection.coverageId + ':' + scopeKey(selection.scope)
        : selection.coverageId;
      form.coverages[key] = {
        selected: true,
        limit: fromMinor(selection.limitMinor, moneyDigits[currency]),
        deductible: fromMinor(selection.deductibleMinor, moneyDigits[currency]),
        aggregate: selection.aggregateMinor
          ? fromMinor(selection.aggregateMinor, moneyDigits[currency])
          : '',
        attachment: selection.attachmentMinor
          ? fromMinor(selection.attachmentMinor, moneyDigits[currency])
          : '',
      };
    }
    return form;
  }
  function renderServiceEvaluation(result) {
    const c = result.calculation;
    return `<section class="panel-body decision-service-result"><h3>Configured change preview</h3><p class="tag ${result.status === 'allowed' ? 'valid' : 'warning'}">${e(titleCase(result.status))}</p><p>Effective ${e(result.effectiveDate)} · original revision ${result.priorVersion}. Future-effective changes describe a contractual schedule, not coverage already in force.</p>${result.reasons.length ? `<ul>${result.reasons.map((reason) => `<li>${e(reason)}</li>`).join('')}</ul>` : ''}${c ? `<dl class="insurance-facts"><div><dt>Calculation</dt><dd>${e(titleCase(c.method))}</dd></div><div><dt>Removed remaining premium</dt><dd>${e(money(c.removedPremiumMinor, result.evaluation.rating.currency))}</dd></div><div><dt>Added remaining premium</dt><dd>${e(money(c.addedPremiumMinor, result.evaluation.rating.currency))}</dd></div><div><dt>Premium movement</dt><dd>${e(money(c.premiumDeltaMinor, result.evaluation.rating.currency))}</dd></div><div><dt>New cumulative premium</dt><dd>${e(money(c.resultingPremiumMinor, result.evaluation.rating.currency))}</dd></div></dl>` : ''}<details><summary>Exact change evidence</summary><pre class="json-output">${e(JSON.stringify(result, null, 2))}</pre></details></section>`;
  }
  function renderEvaluation(result, { beforeHumanReview = false, preview = false } = {}) {
    const states = [
      'validation',
      'applicability',
      'eligibility',
      'referral',
      'rating',
      'authority',
      'approval',
      'bind',
    ];
    const reasons = [
      ...result.validation.issues.map((issue) => `${issue.path}: ${issue.message}`),
      ...result.applicability.reasons,
      ...result.rating.reasons,
      ...result.authority.reasons,
      ...result.bind.reasons,
    ];
    const fact = (label, value) =>
      `<div><dt>${e(label)}</dt><dd>${e(value ?? 'Not recorded')}</dd></div>`;
    // Presentation only: preserve the retained evaluator statuses, reasons and hashes.
    const evaluationStatus = (key) =>
      key === 'approval' && result.approval.status === 'required_unsupported'
        ? 'Required · unresolved in evaluator'
        : titleCase(result[key].status);
    const findingText = (reason) =>
      reason === 'Required approval or provider prerequisites are not available in this engine'
        ? 'The product evaluator leaves required approval or provider prerequisites unresolved. Their current availability is checked separately.'
        : reason;
    const reviewContext =
      result.approval.status === 'required_unsupported' ||
      result.referral.status === 'required' ||
      beforeHumanReview
        ? `<p class="field-help">${preview ? 'After retaining a quote, Human review reports whether an independent review is available for its exact revision. This preview is not an approval.' : 'For this retained quote, <a href="#insurance-approval-title">Human review below</a> reports current review availability and status, separately from this automated evaluation.'} Human review can address only supported referral or independent-review gates. It cannot override a decline, invalid data, rating or authority failure, prohibited backdating, payment or provider requirement.</p>`
        : '';
    return `<section class="decision-result panel-body" aria-label="Automated product evaluation"><div class="insurance-subheading"><div><h3>${beforeHumanReview ? 'Retained product evaluation · before human review' : preview ? 'Product evaluation preview' : 'Retained product evaluation'}</h3><p class="field-help">Automated product evaluation · ${e(result.productId)} ${e(result.productVersion)} · ${e(result.evaluatedOn)}</p></div><span class="tag ${result.bind.status === 'allowed' ? 'valid' : 'warning'}">${beforeHumanReview ? 'Original automated result' : result.bind.status === 'allowed' ? 'Bind checks passed · product evaluation' : 'Binding blocked · product evaluation'}</span></div><div class="decision-grid">${states.map((key) => `<div><span>${e(titleCase(key))}</span><strong>${e(evaluationStatus(key))}</strong></div>`).join('')}</div>${reviewContext}${reasons.length ? `<div class="message warning-message"><strong class="notice-title">Product evaluation findings</strong><ul>${[...new Set(reasons)].map((reason) => `<li>${e(findingText(reason))}</li>`).join('')}</ul></div>` : ''}<h4>Pricing trace</h4><p>${result.rating.premiumMinor ? `<strong>${e(money(result.rating.premiumMinor, result.rating.currency))}</strong> · Whole term${result.rating.termBasis === 'per_day' ? ` · ${e(money(result.rating.dailyPremiumMinor, result.rating.currency))} per day × ${result.rating.termDays} inclusive days` : ''}` : 'No premium calculated'}</p><div class="decision-table-scroll"><table class="gap-table"><thead><tr><th>Coverage</th><th>Method</th><th>${result.rating.termBasis === 'per_day' ? 'Daily premium' : 'Premium'}</th></tr></thead><tbody>${result.rating.lines.map((line) => `<tr><td>${e(line.coverageId)}${line.scope ? ` · ${e(scopeKey(line.scope))}` : ''}</td><td>${e(titleCase(line.method))}</td><td>${e(money(line.premiumMinor, result.rating.currency))}</td></tr>`).join('')}</tbody></table></div><p class="field-help">Minimum premium ${result.rating.minimumApplied ? 'applied' : 'not applied'} · Rounding: ${e(result.rating.rounding)}</p>${result.rating.factors.length ? `<ul class="decision-rule-list">${result.rating.factors.map((rule) => `<li><strong>${e(rule.ruleId)} · ${e(rule.result)}</strong> · Factor ${e(fromMinor(String(rule.factorBps), 4))}<p>${e(rule.reason)}</p></li>`).join('')}</ul>` : ''}<h4>Underwriting rule evidence</h4>${result.eligibility.rules.length ? `<ul class="decision-rule-list">${result.eligibility.rules.map((rule) => `<li><strong>${e(rule.ruleId)}${rule.scope ? ` · ${e(scopeKey(rule.scope))}` : ''} · ${e(titleCase(rule.outcome))} · ${e(rule.result)}</strong><p>${e(rule.reason)}</p><p class="field-help">${e(rule.sourceRefs.join(' · '))}</p></li>`).join('')}</ul>` : '<p class="field-help">No underwriting rules configured. Eligibility does not establish source approval.</p>'}<details class="insurance-trace"><summary>Definition, input and release evidence</summary><dl class="insurance-facts">${fact('Definition hash', result.definitionHash)}${fact('Input hash', result.inputHash)}${fact('Operating policy hash', result.policyHash)}${fact('Runtime release', result.runtimeReleaseId)}${fact('Release hash', result.releaseHash)}${fact('Evaluation hash', result.evaluationHash)}${fact('Decision engine', result.engineVersion)}</dl><details><summary>Original automated result</summary><pre class="json-output" tabindex="0" aria-label="Original automated product evaluation">${e(JSON.stringify(result, null, 2))}</pre></details></details></section>`;
  }
  return {
    renderForm,
    capture,
    refreshQuestions,
    questionPresentation,
    submission,
    renderEvaluation,
    handleAction,
    seedFromSubmission,
    renderServiceEvaluation,
  };
};

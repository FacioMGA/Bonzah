/* Structured insurance product authoring. Business validation and decisions remain server-owned. */
(() => {
  'use strict';
  window.createInsuranceConfigEditor = ({
    escape: esc,
    clone,
    markDirty,
    save,
    getState,
    render: repaint,
    showError,
  }) => {
    let draft = null,
      index = null,
      section = 'identity',
      submitting = false,
      error = '';
    let localDirty = false;
    const sections = [
      ['identity', 'Product'],
      ['questions', 'Risk questions'],
      ['coverages', 'Coverages'],
      ['rules', 'Eligibility & referrals'],
      ['rating', 'Rating factors'],
      ['authority', 'Authority'],
    ];
    const digits = { GBP: 2, USD: 2, EUR: 2, JPY: 0, KWD: 3 };
    const state = () => getState();
    const currency = () => state().snapshot?.configuration.tenant?.currency || '';
    const writable = () =>
      state().view === 'draft' && state().context?.permissions?.includes('configuration:write');
    const editable = () => writable() && !state().busy && !submitting;
    const pathId = (path) => 'ic-' + path.replaceAll('.', '-');
    const pathGet = (path) => path.split('.').reduce((obj, key) => obj?.[key], draft);
    const pathSet = (path, value) => {
      const keys = path.split('.');
      const key = keys.pop();
      keys.reduce((obj, k) => obj[k], draft)[key] = value;
    };
    const lines = (value) =>
      value
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
    const displayScaled = (value, scale) => {
      const raw = String(value);
      if (!/^-?\d+$/.test(raw)) return raw;
      const negative = raw.startsWith('-');
      const absolute = raw.replace(/^-/, '').padStart(scale + 1, '0');
      return (
        (negative ? '-' : '') +
        (scale ? absolute.slice(0, -scale) + '.' + absolute.slice(-scale) : absolute)
      );
    };
    const parseScaled = (value, scale, label) => {
      const raw = String(value).trim();
      const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
      if (!match || (match[3] || '').length > scale)
        throw new Error(
          `${label}: enter an exact decimal amount with at most ${scale} decimal places; no separators or rounding.`,
        );
      const integer = (match[2] + (match[3] || '').padEnd(scale, '0')).replace(/^0+(?=\d)/, '');
      return (match[1] && integer !== '0' ? '-' : '') + integer;
    };
    const exactInteger = (value, label) => {
      if (!/^-?\d+$/.test(String(value).trim())) throw new Error(`${label}: enter a whole number.`);
      const n = Number(value);
      if (!Number.isSafeInteger(n)) throw new Error(`${label}: enter a safe whole number.`);
      return n;
    };
    function scaledCopy(value, direction) {
      if (Array.isArray(value)) return value.map((v) => scaledCopy(v, direction));
      if (!value || typeof value !== 'object') return value;
      const output = {};
      for (const [key, v] of Object.entries(value)) {
        if (key.endsWith('Minor')) {
          const scale = digits[currency()];
          if (scale === undefined)
            throw new Error('Configure a supported tenant currency before authoring money.');
          output[key] =
            direction === 'display' ? displayScaled(v, scale) : parseScaled(v, scale, key);
        } else if (key === 'rateBps' || key === 'factorBps') {
          output[key] =
            direction === 'display'
              ? displayScaled(v, 2)
              : exactInteger(parseScaled(v, 2, key), key);
        } else output[key] = scaledCopy(v, direction);
      }
      return output;
    }
    const riskFields = () => draft?.insurance?.riskFields || [];
    const isV2 = () => draft?.insurance?.schemaVersion === 'insurance-product-v2';
    const fieldsAt = (path = '') => {
      const match = /insurance\.riskGroups\.(\d+)/.exec(path);
      return match ? draft.insurance.riskGroups[Number(match[1])].fields : riskFields();
    };
    const fieldFor = (id, path = '') => fieldsAt(path).find((f) => f.id === id);
    function mapPredicate(predicate, direction, path = '') {
      const p = clone(predicate),
        field = fieldFor(p.fieldId, path);
      const convert = (value) => {
        if (field?.type === 'money')
          return direction === 'display'
            ? displayScaled(value, digits[currency()])
            : parseScaled(value, digits[currency()], `${p.fieldId} condition`);
        if (direction === 'display') return value;
        if (field?.type === 'integer') return exactInteger(value, `${p.fieldId} condition`);
        if (field?.type === 'boolean') {
          if (value !== true && value !== false && value !== 'true' && value !== 'false')
            throw new Error(`${p.fieldId}: choose true or false.`);
          return value === true || value === 'true';
        }
        return String(value);
      };
      if (p.kind === 'comparison') p.value = convert(p.value);
      if (p.kind === 'membership') p.values = p.values.map(convert);
      return p;
    }
    function openProduct(product, selectedIndex) {
      index = selectedIndex;
      draft = scaledCopy(clone(product), 'display');
      if (draft.insurance) transformConditions(draft.insurance, 'display');
      section = 'identity';
      error = '';
      localDirty = false;
      repaint();
    }
    const sourceRefs = (
      path,
      label = 'Source references',
      help = 'One source document/section reference per line. These are declared references, not approval evidence.',
    ) => field(path, label, { type: 'textarea', format: 'lines', help, required: true });
    function field(
      path,
      label,
      { type = 'text', format = '', help = '', required = true, options = [], wide = false } = {},
    ) {
      const value = pathGet(path);
      const id = pathId(path);
      const attr = `id="${id}" data-ic-path="${esc(path)}" ${help ? `aria-describedby="${id}-help"` : ''} ${format ? `data-ic-format="${format}"` : ''} ${required ? 'required' : ''} ${!editable() ? 'disabled' : ''}`;
      const show = Array.isArray(value)
        ? value.join(format === 'codes' ? ', ' : '\n')
        : (value ?? '');
      const input =
        type === 'textarea'
          ? `<textarea ${attr} rows="3">${esc(show)}</textarea>`
          : type === 'multiselect'
            ? `<select ${attr} multiple size="${Math.min(5, Math.max(2, options.length))}">${[...options, ...(value || []).filter((v) => !options.some((o) => o[0] === v)).map((v) => [v, `${v} · unresolved reference`])].map(([v, t]) => `<option value="${esc(v)}" ${(value || []).includes(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`
            : type === 'select'
              ? `<select ${attr}>${options.some((o) => String(o[0]) === String(show)) ? '' : '<option value="">Select…</option>'}${options.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(show) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`
              : type === 'checkbox'
                ? `<input ${attr} type="checkbox" ${value ? 'checked' : ''}>`
                : `<input ${attr} type="${type}" value="${esc(show)}" autocomplete="off" ${format === 'integer' ? 'step="1"' : ''}>`;
      return `<div class="form-field ${wide ? 'full-width' : ''} ${type === 'checkbox' ? 'ic-checkbox' : ''}"><label for="${id}">${esc(label)}</label>${input}${help ? `<p class="field-help" id="${id}-help">${esc(help)}</p>` : ''}</div>`;
    }
    const button = (action, label, attrs = '', mutation = true) =>
      `<button type="button" class="button secondary small" data-ic-action="${action}" ${attrs} ${mutation && !editable() ? 'disabled' : ''}>${esc(label)}</button>`;
    const remove = (path, i, label) =>
      button('remove', `Remove ${label}`, `data-ic-list="${esc(path)}" data-ic-index="${i}"`);
    const card = (title, content, actions = '') =>
      `<section class="ic-section-card"><div class="ic-card-heading"><h3>${esc(title)}</h3>${actions}</div>${content}</section>`;
    const grid = (html) => `<div class="form-grid">${html}</div>`;
    const money = (path, label, help = '') =>
      field(path, `${label} (${currency() || 'currency not configured'})`, {
        help: help || 'Exact currency amount. No thousands separators.',
      });
    function identityPanel() {
      const cfg = state().snapshot.configuration;
      let result = card(
        'Product identity',
        grid(
          field('id', 'Product identifier', {
            help: 'Stable code. Use a new identifier when the meaning changes.',
          }) +
            field('version', 'Product version', {
              help: 'Semantic version, for example 1.0.0. Activation retains this exact version.',
            }) +
            field('name', 'Product name') +
            field('operatingEntityId', 'Operating entity', {
              type: 'select',
              options: cfg.operatingEntities.map((e) => [e.id, `${e.name} · ${e.id}`]),
            }) +
            field('processId', 'Process definition', {
              type: 'select',
              options: cfg.processes.map((p) => [p.id, `${p.name} · ${p.version}`]),
            }) +
            field('requiredCapabilities', 'Required capabilities', {
              type: 'textarea',
              format: 'lines',
              required: false,
              help: 'One registered capability identifier per line. The server rejects unsupported executable requirements.',
            }),
        ),
      );
      if (!draft.insurance)
        return (
          result +
          card(
            'Legacy product definition',
            `<p>This product has ${draft.fields.length} legacy metadata fields. They remain unchanged unless you explicitly convert and save.</p><p class="field-help">Conversion replaces those field definitions with the structured insurance definition below; configure its constraints and source references before saving. Stored insurance records and releases are preserved.</p>${button('convert', 'Convert to insurance definition')}`,
          )
        );
      return (
        result +
        (!isV2()
          ? card(
              'Definition version',
              `<p>Product v1 remains supported without changing retained records. Convert this draft explicitly to author repeated risks, conditional questions and declared servicing.</p>${button('upgrade-v2', 'Upgrade draft to product v2')}`,
            )
          : card(
              'Definition version',
              '<p>Product v2 · Repeated risks, scoped coverage semantics and explicit servicing rules.</p>',
            )) +
        card(
          'Insurance scope',
          grid(
            field('insurance.territories', 'Eligible country codes', {
              format: 'codes',
              help: 'Comma-separated ISO country codes, for example GB, US. This is product applicability, not data residency or a verified licence.',
            }) + sourceRefs('insurance.sourceRefs', 'Product source references'),
          ) +
            `<p class="field-help">Currency: ${esc(currency() || 'not configured')} from the tenant. Activation requires the operating policy to use this currency. Country scope is supported here; subdivision-specific licensing, wording, taxes and legal authority remain separate requirements.</p>`,
        ) +
        card(
          'Policy term',
          grid(
            field('insurance.termRules.minimumDays', 'Minimum term (days)', {
              type: 'number',
              format: 'integer',
              help: 'Inclusive UTC calendar days: a term starting and ending on the same date is one day.',
            }) +
              field('insurance.termRules.maximumDays', 'Maximum term (days)', {
                type: 'number',
                format: 'integer',
                help: 'The server checks every evaluated term against these product bounds.',
              }) +
              field('insurance.termRules.backdating', 'Backdating policy', {
                type: 'select',
                options: [
                  ['not_permitted', 'Not permitted'],
                  ['requires_approval', 'Requires approval — unsupported, binding blocked'],
                ],
                help: 'A start date before the evaluation UTC date is backdated. Requiring approval does not create an approval workflow.',
                wide: true,
              }),
          ),
        )
      );
    }
    function questionCards(listPath = 'insurance.riskFields') {
      return (
        `<div class="ic-section-intro"><div><h2>Risk questions</h2><p>Define the actual answers the evaluator validates. Money uses the tenant currency; decimal quantities need their unit stated in the description.</p></div>${button('add-field', 'Add risk question', `data-ic-list="${listPath}"`)}</div>` +
        pathGet(listPath)
          .map((f, i) => {
            const p = `${listPath}.${i}`;
            let constraints = '';
            if (f.type === 'text')
              constraints =
                field(p + '.minLength', 'Minimum length', { type: 'number', format: 'integer' }) +
                field(p + '.maxLength', 'Maximum length', { type: 'number', format: 'integer' });
            if (f.type === 'integer' || f.type === 'decimal' || f.type === 'date')
              constraints =
                field(p + '.minimum', 'Minimum value', {
                  type: f.type === 'date' ? 'date' : f.type === 'integer' ? 'number' : 'text',
                  format: f.type === 'integer' ? 'integer' : '',
                }) +
                field(p + '.maximum', 'Maximum value', {
                  type: f.type === 'date' ? 'date' : f.type === 'integer' ? 'number' : 'text',
                  format: f.type === 'integer' ? 'integer' : '',
                }) +
                (f.type === 'decimal'
                  ? field(p + '.scale', 'Maximum decimal places', {
                      type: 'number',
                      format: 'integer',
                    })
                  : '');
            if (f.type === 'money')
              constraints =
                money(p + '.minimumMinor', 'Minimum value') +
                money(p + '.maximumMinor', 'Maximum value');
            if (f.type === 'choice')
              constraints = `<div class="full-width ic-option-list"><h4>Allowed options</h4>${f.options.map((o, n) => `<div class="ic-option-row">${field(`${p}.options.${n}.id`, 'Option code')}${field(`${p}.options.${n}.label`, 'Option label')}${remove(p + '.options', n, 'option')}</div>`).join('')}${button('add-option', 'Add option', `data-ic-list="${p}.options"`)}</div>`;
            return card(
              f.label || `Question ${i + 1}`,
              grid(
                field(p + '.id', 'Question identifier') +
                  field(p + '.label', 'Question label') +
                  field(p + '.type', 'Answer type', {
                    type: 'select',
                    options: [
                      'text',
                      'choice',
                      'boolean',
                      'integer',
                      'decimal',
                      'money',
                      'date',
                    ].map((t) => [t, t[0].toUpperCase() + t.slice(1)]),
                  }) +
                  field(p + '.required', 'Answer required', { type: 'checkbox', required: false }) +
                  field(p + '.description', 'Question description and unit', { type: 'textarea' }) +
                  sourceRefs(p + '.sourceRefs') +
                  constraints +
                  (isV2()
                    ? conditionControls(p + '.visibleWhen', 'Visible when') +
                      conditionControls(p + '.requiredWhen', 'Required when')
                    : ''),
              ),
              remove(listPath, i, 'question'),
            );
          })
          .join('') +
        (!pathGet(listPath).length
          ? '<p class="ic-empty">Add a question and define its validation constraints. No risk questions are inferred from customer names.</p>'
          : '')
      );
    }
    function conditionControls(path, label) {
      const when = pathGet(path);
      return `<div class="full-width ic-conditional"><h4>${esc(label)}</h4>${
        when
          ? field(path + '.mode', 'Condition match', {
              type: 'select',
              options: [
                ['all', 'All'],
                ['any', 'Any'],
              ],
            }) +
            when.conditions
              .map((predicate, n) => predicatePanel(path + '.conditions.' + n, predicate, n))
              .join('') +
            button('add-condition', 'Add condition', `data-ic-list="${path}.conditions"`) +
            button('clear-condition', 'Remove conditional rule', `data-ic-path-target="${path}"`)
          : button(
              'set-condition',
              'Configure ' + label.toLowerCase(),
              `data-ic-path-target="${path}"`,
            )
      }<p class="field-help">Conditions use questions in this same scope. Unknown values block evaluation; hidden answers must be omitted.</p></div>`;
    }
    function questionPanel() {
      let html = questionCards();
      if (!isV2())
        return (
          html +
          `<p class="field-help">Repeated risks and conditional questions require explicit product-v2 conversion in Product.</p>`
        );
      html += `<div class="ic-section-intro"><h2>Repeated risk groups</h2>${button('add-group', 'Add risk group')}</div>`;
      for (const [i, g] of draft.insurance.riskGroups.entries()) {
        const p = 'insurance.riskGroups.' + i;
        html += card(
          g.label || 'New risk group',
          grid(
            field(p + '.id', 'Group identifier') +
              field(p + '.label', 'Group label') +
              field(p + '.description', 'Group description', { type: 'textarea' }) +
              field(p + '.minimumRows', 'Minimum rows', { type: 'number', format: 'integer' }) +
              field(p + '.maximumRows', 'Maximum rows', { type: 'number', format: 'integer' }) +
              sourceRefs(p + '.sourceRefs'),
          ) +
            questionCards(p + '.fields') +
            `<h4>Rules evaluated independently for each row</h4>` +
            ruleCards(p + '.eligibilityRules', false) +
            button('add-rule', 'Add row decision rule', `data-ic-list="${p}.eligibilityRules"`),
          remove('insurance.riskGroups', i, 'risk group'),
        );
      }
      return html;
    }
    function coverageSemantics(p, c) {
      return (
        field(p + '.scope.kind', 'Coverage scope', {
          type: 'select',
          options: [
            ['policy', 'Policy'],
            ['risk_group', 'Each risk row'],
          ],
        }) +
        (c.scope.kind === 'risk_group'
          ? field(p + '.scope.groupId', 'Risk group', {
              type: 'select',
              options: draft.insurance.riskGroups.map((g) => [g.id, g.label]),
            })
          : '') +
        field(p + '.limitBasis', 'Selected limit basis', {
          type: 'select',
          options: [
            ['per_occurrence', 'Per occurrence'],
            ['per_person', 'Per person'],
            ['policy_term_aggregate', 'Policy term aggregate'],
          ],
        }) +
        field(p + '.layer.kind', 'Layer', {
          type: 'select',
          options: [
            ['primary', 'Primary'],
            ['excess', 'Continuous excess'],
          ],
        }) +
        (c.layer.kind === 'excess'
          ? field(p + '.layer.underlyingCoverageId', 'Underlying coverage', {
              type: 'select',
              options: draft.insurance.coverages
                .filter((x) => x.id !== c.id)
                .map((x) => [x.id, x.name]),
            }) +
            money(p + '.layer.attachment.minimumMinor', 'Minimum attachment') +
            money(p + '.layer.attachment.maximumMinor', 'Maximum attachment')
          : '') +
        `<div class="full-width"><h4>Additional aggregate cap</h4>${
          c.aggregateLimit
            ? field(p + '.aggregateLimit.basis', 'Aggregate basis', {
                type: 'select',
                options: [
                  ['per_occurrence', 'Per occurrence'],
                  ['policy_term', 'Policy term'],
                ],
              }) +
              money(p + '.aggregateLimit.minimumMinor', 'Minimum aggregate') +
              money(p + '.aggregateLimit.maximumMinor', 'Maximum aggregate') +
              button(
                'clear-aggregate',
                'Remove additional aggregate',
                `data-ic-path-target="${p}.aggregateLimit"`,
              )
            : button(
                'set-aggregate',
                'Add aggregate cap',
                `data-ic-path-target="${p}.aggregateLimit"`,
              )
        }<p class="field-help">Attachment is separate from deductible. Excess requires the selected underlying layer in the same scope and basis. These quote terms do not implement claims settlement. Per-person limits require an aggregate cap.</p></div>`
      );
    }
    function coveragePanel() {
      return (
        `<div class="ic-section-intro"><div><h2>Coverage schedule</h2><p>Set selected-limit and deductible ranges, dependency rules and exact whole-term pricing. Wording, sublimits and percentage deductibles are not implemented by these numeric fields.</p></div>${button('add-cover', 'Add coverage')}</div>` +
        draft.insurance.coverages
          .map((c, i) => {
            const p = `insurance.coverages.${i}`;
            const rate =
              c.rate.method === 'flat'
                ? money(p + '.rate.premiumMinor', 'Flat premium')
                : c.rate.method === 'per_unit'
                  ? field(p + '.rate.quantityFieldId', 'Quantity question', {
                      type: 'select',
                      options: (c.scope?.kind === 'risk_group'
                        ? draft.insurance.riskGroups.find((g) => g.id === c.scope.groupId)
                            ?.fields || []
                        : riskFields()
                      )
                        .filter((f) => ['integer', 'decimal'].includes(f.type))
                        .map((f) => [f.id, `${f.label} · ${f.id}`]),
                    }) + money(p + '.rate.premiumPerUnitMinor', 'Premium per unit')
                  : field(p + '.rate.rateBps', 'Rate on selected limit (%)', {
                      help: 'For example 1.25 means 1.25% of the selected coverage limit. No automatic proration.',
                    });
            return card(
              c.name || `Coverage ${i + 1}`,
              grid(
                field(p + '.id', 'Coverage identifier') +
                  field(p + '.name', 'Coverage name') +
                  field(p + '.description', 'Coverage description', {
                    type: 'textarea',
                    help: 'Describe the covered risk or peril. This text does not change the selected amount basis or implement wording and claims adjudication.',
                  }) +
                  sourceRefs(p + '.sourceRefs') +
                  (isV2()
                    ? coverageSemantics(p, c)
                    : field(p + '.basis', 'Limit and deductible basis', {
                        type: 'select',
                        options: [['single_risk_per_occurrence', 'Single risk, per occurrence']],
                        help: 'Only fixed currency amounts for one risk per occurrence are supported. Aggregate, per-person, percentage and excess attachment terms require a different contract.',
                        wide: true,
                      })) +
                  field(p + '.required', 'Coverage required', {
                    type: 'checkbox',
                    required: false,
                  }) +
                  field(p + '.dependsOn', 'Requires coverage identifiers', {
                    type: 'multiselect',
                    options: draft.insurance.coverages
                      .filter((_, n) => n !== i)
                      .map((item) => [item.id, `${item.name || 'Unnamed coverage'} · ${item.id}`]),
                    required: false,
                    help: 'Select required coverages; use Ctrl/Command to select multiple or clear a selection. The server checks references and cycles.',
                  }) +
                  field(p + '.excludes', 'Incompatible coverage identifiers', {
                    type: 'multiselect',
                    options: draft.insurance.coverages
                      .filter((_, n) => n !== i)
                      .map((item) => [item.id, `${item.name || 'Unnamed coverage'} · ${item.id}`]),
                    required: false,
                  }) +
                  money(p + '.limit.minimumMinor', 'Minimum selected limit') +
                  money(p + '.limit.maximumMinor', 'Maximum selected limit') +
                  money(p + '.deductible.minimumMinor', 'Minimum deductible') +
                  money(p + '.deductible.maximumMinor', 'Maximum deductible') +
                  field(p + '.rate.method', 'Pricing method', {
                    type: 'select',
                    options: [
                      ['flat', 'Flat amount'],
                      ['per_unit', 'Amount per quantity unit'],
                      ['limit_bps', 'Percentage of selected limit'],
                    ],
                  }) +
                  rate,
              ),
              remove('insurance.coverages', i, 'coverage'),
            );
          })
          .join('') +
        (!draft.insurance.coverages.length
          ? '<p class="ic-empty">Add a coverage, its allowed amounts, rate and source references.</p>'
          : '')
      );
    }
    function predicatePanel(p, predicate, n) {
      const f = fieldFor(predicate.fieldId, p);
      const options = [
        ['eq', 'equals'],
        ['neq', 'does not equal'],
        ...(['integer', 'decimal', 'money', 'date'].includes(f?.type)
          ? [
              ['lt', 'is less than'],
              ['lte', 'is at most'],
              ['gt', 'is greater than'],
              ['gte', 'is at least'],
            ]
          : []),
        ['in', 'is one of'],
        ['not_in', 'is not one of'],
        ['present', 'is present'],
        ['absent', 'is absent'],
      ];
      let value = '';
      if (predicate.kind === 'membership')
        value = field(p + '.values', 'Matching values', {
          type: 'textarea',
          format: 'lines',
          help: `One ${f?.type || 'typed'} value per line. ${f?.type === 'boolean' ? 'Use true or false.' : f?.type === 'money' ? `Use decimal ${currency()} amounts.` : ''}`,
        });
      if (predicate.kind === 'comparison')
        value = field(p + '.value', 'Comparison value', {
          type:
            f?.type === 'boolean' || f?.type === 'choice'
              ? 'select'
              : f?.type === 'date'
                ? 'date'
                : 'text',
          options:
            f?.type === 'boolean'
              ? [
                  ['true', 'True'],
                  ['false', 'False'],
                ]
              : f?.type === 'choice'
                ? f.options.map((o) => [o.id, o.label])
                : [],
          help: f?.type === 'money' ? `Decimal ${currency()} amount; exact scaling on save.` : '',
        });
      return `<div class="ic-predicate"><span class="ic-predicate-number">${n + 1}</span>${field(p + '.fieldId', 'Risk question', { type: 'select', options: fieldsAt(p).map((x) => [x.id, `${x.label} · ${x.id}`]) })}${field(p + '.operator', 'Condition', { type: 'select', options })}${value}${remove(p.split('.').slice(0, -1).join('.'), n, 'condition')}</div>`;
    }
    function ruleCards(listPath, isFactor) {
      return pathGet(listPath)
        .map((r, i) => {
          const p = `${listPath}.${i}`;
          return card(
            r.reason || `${isFactor ? 'Factor' : 'Rule'} ${i + 1}`,
            grid(
              field(p + '.id', isFactor ? 'Factor identifier' : 'Rule identifier') +
                (isFactor
                  ? field(p + '.factorBps', 'Premium multiplier (%)', {
                      help: '100% leaves premium unchanged; 120% applies a 1.20 factor; 80% applies a 0.80 factor. Factors are applied by the server.',
                    })
                  : field(p + '.outcome', 'Matched outcome', {
                      type: 'select',
                      options: [
                        ['refer', 'Refer for underwriting'],
                        ['decline', 'Decline eligibility'],
                      ],
                    })) +
                field(p + '.reason', 'Business reason', { type: 'textarea' }) +
                sourceRefs(p + '.sourceRefs') +
                field(p + '.when.mode', 'Match condition group', {
                  type: 'select',
                  options: [
                    ['all', 'All conditions must match'],
                    ['any', 'Any condition may match'],
                  ],
                }),
            ) +
              `<div class="ic-predicate-list">${r.when.conditions.map((c, n) => predicatePanel(`${p}.when.conditions.${n}`, c, n)).join('')}</div>${button('add-condition', 'Add condition', `data-ic-list="${p}.when.conditions"`)}`,
            remove(listPath, i, isFactor ? 'factor' : 'rule'),
          );
        })
        .join('');
    }
    function rulesPanel() {
      return (
        `<div class="ic-section-intro"><div><h2>Eligibility and underwriting referrals</h2><p>Rules retain both decline and referral evidence. Missing data is unknown, not automatic permission. Case approval is a separate unsupported gate.</p></div>${button('add-rule', 'Add decision rule')}</div>` +
        thisRuleHelp() +
        ruleCards('insurance.eligibilityRules', false)
      );
    }
    const thisRuleHelp = () =>
      !draft.insurance.eligibilityRules.length
        ? '<p class="ic-empty">No decision rules configured. This does not certify customer underwriting appetite or carrier approval.</p>'
        : '';
    function ratingPanel() {
      return (
        card(
          'Whole-term premium',
          grid(
            money('insurance.rating.minimumPremiumMinor', 'Minimum whole-term premium') +
              (isV2()
                ? field('insurance.rating.termBasis', 'Coverage rate term basis', {
                    type: 'select',
                    options: [
                      ['whole_term', 'Whole term'],
                      ['per_day', 'Each inclusive UTC day'],
                    ],
                  })
                : ''),
          ) +
            `<p class="field-help">Coverage rates are authored in Coverages. Conditional factors below apply to the whole-term calculated amount; there is no automatic pro-rata, tax, fee or settlement calculation.</p>`,
        ) +
        `<div class="ic-section-intro"><div><h2>Conditional premium factors</h2><p>Use explicit exact multipliers with a reason and source. Demonstration tariffs do not replace customer-owned external engines.</p></div>${button('add-factor', 'Add rating factor')}</div>` +
        ruleCards('insurance.rating.factors', true) +
        (isV2() ? servicingPanel() + cancellationPanel() : '')
      );
    }
    function servicingPanel() {
      const rules = draft.insurance.servicing;
      return card(
        'Configured policy changes',
        grid(
          field('insurance.servicing.mode', 'Servicing authority', {
            type: 'select',
            options: [
              ['disabled', 'Disabled'],
              ['recalculate_remaining', 'Recalculate remaining exposure'],
            ],
          }) +
            (rules.mode === 'recalculate_remaining'
              ? field('insurance.servicing.allowRiskChanges', 'Allow risk and coverage changes', {
                  type: 'checkbox',
                  required: false,
                }) +
                field('insurance.servicing.allowTermExtension', 'Allow term extension', {
                  type: 'checkbox',
                  required: false,
                }) +
                field('insurance.servicing.calculation', 'Remaining exposure calculation', {
                  type: 'select',
                  options: [
                    ['per_day_remaining', 'Per-day remaining exposure'],
                    ['actual_days_pro_rata', 'Whole-term actual-days pro-rata'],
                  ],
                }) +
                sourceRefs('insurance.servicing.sourceRefs', 'Servicing rule source references')
              : ''),
        ) +
          `<p class="field-help">Servicing uses the retained definition, never new rates from a later release. Inclusive UTC days; exact half-away-from-zero rounding. Term extension requires per-day pricing. Whole-term pro-rata allows risk changes within an unchanged term. Applied minimum premiums, cancellation, backdating and fresh review/provider/payment gates block this bounded workflow.</p>`,
      );
    }
    function cancellationPanel() {
      const rules = draft.insurance.cancellation;
      return (
        card(
          'Cancellation return premium',
          rules
            ? grid(
                field('insurance.cancellation.calculation', 'Return calculation', {
                  type: 'select',
                  options: [
                    ['per_day_remaining', 'Return unexpired daily premium'],
                    ['actual_days_pro_rata', 'Return actual-days portion of whole-term premium'],
                  ],
                }) +
                  sourceRefs(
                    'insurance.cancellation.sourceRefs',
                    'Cancellation rule source references',
                  ),
              ) + button('remove-cancellation', 'Remove cancellation authority')
            : `<p>No cancellation return rule is declared. Cancellation remains blocked for this product.</p>${button('add-cancellation', 'Configure cancellation return rule')}`,
        ) +
        `<p class="field-help">Applied minimum premiums block this bounded calculation. Earned/return premium and commission movement are retained separately from notices and cash refunds; neither is sent automatically.</p>`
      );
    }
    function authorityPanel() {
      return (
        card(
          'Configured authority thresholds',
          grid(
            money('insurance.authority.maximumPremiumMinor', 'Maximum premium within authority') +
              money(
                'insurance.authority.maximumTotalLimitMinor',
                'Maximum sum of selected limits',
              ) +
              sourceRefs('insurance.authority.sourceRefs', 'Authority source references'),
          ) +
            `<p class="field-help">The selected-limit threshold sums comparable per-occurrence currency amounts for one risk. It is a conservative configured authority check, not an aggregate policy limit or claims calculation. These checks can require referral; they do not prove delegated authority, licensing or carrier approval.</p>`,
        ) +
        card(
          'Bind prerequisites',
          `<p>Commission, participant caps, effective dates and payment/approval/provider prerequisites remain in the associated executable runtime policy in Sandbox setup.</p><p class="field-help">Required but unsupported approval remains blocked. Changing a description, source reference or threshold does not approve an individual risk.</p>`,
        )
      );
    }
    function render() {
      const cfg = state().snapshot?.configuration;
      if (!cfg) return '';
      if (!draft)
        return `<section class="panel ic-editor"><div class="panel-heading"><div><h2>Insurance products</h2><p>Author product definitions, risk questions, coverages and supported decision rules.</p></div>${button('new', 'Create insurance product')}</div><div class="panel-body">${!writable() ? '<div class="read-only-note">Read-only configuration. You can inspect definitions; mutations require draft write permission.</div>' : ''}${cfg.products.length ? cfg.products.map((p, i) => `<article class="ic-product-row"><div><h3>${esc(p.name)}</h3><p>${esc(p.id)} · ${esc(p.version)} · ${p.insurance ? 'Structured insurance definition' : 'Legacy metadata'}</p><p class="field-help">${p.insurance ? `${p.insurance.riskFields.length} questions · ${p.insurance.coverages.length} coverages · ${p.insurance.eligibilityRules.length} decision rules` : `${p.fields.length} metadata fields`}</p></div>${button('open', writable() ? 'Edit product' : 'Inspect product', `data-ic-index="${i}"`, false)}</article>`).join('') : '<div class="empty-state"><h3>No product definitions</h3><p>Define the operating entity and process first, then create an insurance product with explicit inputs and source references.</p></div>'}</div></section>`;
      const panel = {
        identity: identityPanel,
        questions: questionPanel,
        coverages: coveragePanel,
        rules: rulesPanel,
        rating: ratingPanel,
        authority: authorityPanel,
      };
      return `<section class="panel ic-editor"><form id="ic-product-form"><div class="panel-heading"><div><h2>${esc(draft.name || 'New insurance product')}</h2><p>${esc(draft.id || 'Identifier not set')} · ${esc(draft.version || 'Version not set')} · ${writable() ? 'Unsaved authoring workspace' : 'Read-only inspection'}</p></div>${button('close', 'Back to products', '', false)}</div><nav class="ic-tabs" aria-label="Insurance product sections">${sections
        .filter(([id]) => draft.insurance || id === 'identity')
        .map(
          ([id, label]) =>
            `<button type="button" data-ic-section="${id}" aria-current="${section === id ? 'page' : 'false'}">${label}</button>`,
        )
        .join(
          '',
        )}</nav><div class="panel-body">${error ? `<div class="message error-message" role="alert" tabindex="-1" id="ic-error">${esc(error)}</div>` : ''}${!writable() ? '<div class="read-only-note">Read-only. Activated versions and unauthorized roles cannot change this definition.</div>' : ''}${panel[section]()}</div><div class="form-actions"><span>Saving updates the configuration draft. Activation is a separate reviewed action.</span><div class="form-actions-buttons">${button('discard', 'Discard product edits')}<button type="submit" class="button primary" ${!editable() ? 'disabled' : ''}>${submitting ? 'Saving…' : 'Save product definition'}</button></div></div></form></section>`;
    }
    function newInsurance() {
      return {
        schemaVersion: 'insurance-product-v1',
        pricingOwnership: 'kernel_deterministic',
        sourceRefs: [],
        territories: [],
        termRules: { minimumDays: '', maximumDays: '', backdating: '' },
        riskFields: [],
        coverages: [],
        eligibilityRules: [],
        rating: { termBasis: 'whole_term', minimumPremiumMinor: '', factors: [] },
        authority: { maximumPremiumMinor: '', maximumTotalLimitMinor: '', sourceRefs: [] },
      };
    }
    function newPredicate(path = '') {
      return {
        kind: 'comparison',
        fieldId: fieldsAt(path)[0]?.id || '',
        operator: 'eq',
        value: '',
      };
    }
    const changed = () => {
      error = '';
      localDirty = true;
      markDirty(true);
    };
    function handleClick(event) {
      const tab = event.target.closest('[data-ic-section]');
      if (tab) {
        if (state().busy || submitting) return true;
        section = tab.dataset.icSection;
        repaint();
        return true;
      }
      const control = event.target.closest('[data-ic-action]');
      if (!control) return false;
      event.preventDefault();
      const action = control.dataset.icAction;
      if (state().busy || submitting) return true;
      if (action === 'open') {
        try {
          openProduct(
            state().snapshot.configuration.products[Number(control.dataset.icIndex)],
            Number(control.dataset.icIndex),
          );
        } catch (cause) {
          showError(cause, 'The product could not be opened for structured authoring.');
        }
        return true;
      }
      if (action === 'close' || action === 'discard') {
        if (
          localDirty &&
          writable() &&
          !window.confirm('Discard unsaved product edits and return to the product list?')
        )
          return true;
        reset();
        markDirty(false);
        repaint();
        return true;
      }
      if (!editable()) return true;
      if (action === 'new') {
        index = null;
        draft = {
          id: '',
          version: '',
          name: '',
          operatingEntityId: '',
          processId: '',
          fields: [],
          requiredCapabilities: [],
          insurance: newInsurance(),
        };
        section = 'identity';
      }
      if (action === 'convert') {
        draft.fields = [];
        draft.insurance = newInsurance();
      }
      if (action === 'upgrade-v2') {
        draft.insurance.schemaVersion = 'insurance-product-v2';
        draft.insurance.riskGroups = [];
        draft.insurance.riskFields.forEach((f) => {
          f.visibleWhen = null;
          f.requiredWhen = null;
        });
        draft.insurance.coverages = draft.insurance.coverages.map(({ basis, ...c }) => ({
          ...c,
          scope: { kind: 'policy' },
          limitBasis: 'per_occurrence',
          aggregateLimit: null,
          layer: { kind: 'primary' },
        }));
        draft.insurance.authority.limitMeasure = 'sum_of_declared_maximum_exposures';
        draft.insurance.servicing = { mode: 'disabled' };
      }
      if (action === 'add-cancellation')
        draft.insurance.cancellation = {
          calculation:
            draft.insurance.rating.termBasis === 'per_day'
              ? 'per_day_remaining'
              : 'actual_days_pro_rata',
          minimumPremiumTreatment: 'block_if_applied',
          sourceRefs: [],
        };
      if (action === 'remove-cancellation') delete draft.insurance.cancellation;
      if (action === 'add-group')
        draft.insurance.riskGroups.push({
          id: '',
          label: '',
          description: '',
          minimumRows: 0,
          maximumRows: 10,
          fields: [],
          eligibilityRules: [],
          sourceRefs: [],
        });
      if (action === 'set-condition')
        pathSet(control.dataset.icPathTarget, {
          mode: 'all',
          conditions: [newPredicate(control.dataset.icPathTarget)],
        });
      if (action === 'clear-condition' || action === 'clear-aggregate')
        pathSet(control.dataset.icPathTarget, null);
      if (action === 'set-aggregate')
        pathSet(control.dataset.icPathTarget, {
          basis: 'policy_term',
          minimumMinor: '',
          maximumMinor: '',
        });
      if (action === 'add-field')
        pathGet(control.dataset.icList || 'insurance.riskFields').push({
          ...(isV2() ? { visibleWhen: null, requiredWhen: null } : {}),
          id: '',
          label: '',
          type: 'text',
          required: true,
          description: '',
          sourceRefs: [],
          minLength: 0,
          maxLength: 200,
        });
      if (action === 'add-option')
        pathGet(control.dataset.icList).push({
          id: '',
          label: '',
        });
      if (action === 'add-cover')
        draft.insurance.coverages.push({
          id: '',
          name: '',
          description: '',
          ...(isV2()
            ? {
                scope: { kind: 'policy' },
                limitBasis: 'per_occurrence',
                aggregateLimit: null,
                layer: { kind: 'primary' },
              }
            : { basis: '' }),
          required: false,
          dependsOn: [],
          excludes: [],
          limit: { minimumMinor: '', maximumMinor: '' },
          deductible: { minimumMinor: '', maximumMinor: '' },
          rate: { method: 'flat', premiumMinor: '' },
          sourceRefs: [],
        });
      if (action === 'add-rule')
        pathGet(control.dataset.icList || 'insurance.eligibilityRules').push({
          id: '',
          reason: '',
          sourceRefs: [],
          outcome: 'refer',
          when: { mode: 'all', conditions: [newPredicate(control.dataset.icList)] },
        });
      if (action === 'add-factor')
        draft.insurance.rating.factors.push({
          id: '',
          reason: '',
          sourceRefs: [],
          factorBps: '100.00',
          when: { mode: 'all', conditions: [newPredicate(control.dataset.icList)] },
        });
      if (action === 'add-condition')
        pathGet(control.dataset.icList).push(newPredicate(control.dataset.icList));
      if (action === 'remove')
        pathGet(control.dataset.icList).splice(Number(control.dataset.icIndex), 1);
      changed();
      repaint();
      return true;
    }
    function handleInput(event) {
      const input = event.target.closest('[data-ic-path]');
      if (!input) return false;
      if (!editable()) return true;
      let value =
        input.type === 'checkbox'
          ? input.checked
          : input.type === 'select-multiple'
            ? [...input.selectedOptions].map((option) => option.value)
            : input.value;
      if (input.dataset.icFormat === 'lines') value = lines(value);
      if (input.dataset.icFormat === 'codes')
        value = String(value)
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
      pathSet(input.dataset.icPath, value);
      changed();
      return true;
    }
    function handleChange(event) {
      const input = event.target.closest('[data-ic-path]');
      if (!input) return false;
      if (!editable()) return true;
      handleInput(event);
      const path = input.dataset.icPath;
      if (/^insurance\.(?:riskFields|riskGroups\.\d+\.fields)\.\d+\.type$/.test(path)) {
        const p = path.slice(0, -5),
          previous = pathGet(p);
        const common = {
          ...(isV2()
            ? { visibleWhen: previous.visibleWhen, requiredWhen: previous.requiredWhen }
            : {}),
          id: previous.id,
          label: previous.label,
          type: previous.type,
          required: previous.required,
          description: previous.description,
          sourceRefs: previous.sourceRefs,
        };
        const additions = {
          text: { minLength: 0, maxLength: 200 },
          choice: { options: [] },
          boolean: {},
          integer: { minimum: '', maximum: '' },
          decimal: { minimum: '', maximum: '', scale: 2 },
          money: { minimumMinor: '', maximumMinor: '' },
          date: { minimum: '', maximum: '' },
        };
        pathSet(p, { ...common, ...additions[previous.type] });
        repaint();
      } else if (path.endsWith('.scope.kind')) {
        pathSet(
          path.slice(0, -5),
          input.value === 'policy' ? { kind: 'policy' } : { kind: 'risk_group', groupId: '' },
        );
        repaint();
      } else if (path.endsWith('.layer.kind')) {
        pathSet(
          path.slice(0, -5),
          input.value === 'primary'
            ? { kind: 'primary' }
            : {
                kind: 'excess',
                underlyingCoverageId: '',
                attachment: { minimumMinor: '', maximumMinor: '' },
              },
        );
        repaint();
      } else if (path === 'insurance.servicing.mode') {
        draft.insurance.servicing =
          input.value === 'disabled'
            ? { mode: 'disabled' }
            : {
                mode: 'recalculate_remaining',
                allowRiskChanges: false,
                allowTermExtension: false,
                calculation: 'per_day_remaining',
                minimumPremiumTreatment: 'block_if_applied',
                sourceRefs: [],
              };
        repaint();
      } else if (/^insurance\.coverages\.\d+\.rate\.method$/.test(path)) {
        const method = input.value;
        pathSet(
          path.slice(0, -7),
          method === 'flat'
            ? { method, premiumMinor: '' }
            : method === 'per_unit'
              ? { method, quantityFieldId: '', premiumPerUnitMinor: '' }
              : { method, rateBps: '' },
        );
        repaint();
      } else if (path.endsWith('.operator') || path.endsWith('.fieldId')) {
        const p = path.slice(0, path.lastIndexOf('.'));
        const old = pathGet(p),
          op = path.endsWith('.fieldId') ? 'eq' : old.operator;
        pathSet(
          p,
          ['present', 'absent'].includes(op)
            ? { kind: 'presence', fieldId: old.fieldId, operator: op }
            : ['in', 'not_in'].includes(op)
              ? { kind: 'membership', fieldId: old.fieldId, operator: op, values: old.values || [] }
              : {
                  kind: 'comparison',
                  fieldId: old.fieldId,
                  operator: op,
                  value: path.endsWith('.fieldId') ? '' : (old.value ?? ''),
                },
        );
        repaint();
      }
      return true;
    }
    function transformConditions(insurance, direction) {
      const groups = [
        {
          fields: insurance.riskFields,
          rules: [...insurance.eligibilityRules, ...insurance.rating.factors],
          path: 'insurance',
        },
        ...(insurance.riskGroups || []).map((g, i) => ({
          fields: g.fields,
          rules: g.eligibilityRules,
          path: 'insurance.riskGroups.' + i,
        })),
      ];
      for (const group of groups) {
        for (const rule of group.rules)
          rule.when.conditions = rule.when.conditions.map((p) =>
            mapPredicate(p, direction, group.path),
          );
        for (const f of group.fields)
          for (const name of ['visibleWhen', 'requiredWhen'])
            if (f[name])
              f[name].conditions = f[name].conditions.map((p) =>
                mapPredicate(p, direction, group.path),
              );
      }
    }
    function serialize() {
      const product = scaledCopy(clone(draft), 'canonical');
      if (product.insurance) {
        product.insurance.termRules.minimumDays = exactInteger(
          product.insurance.termRules.minimumDays,
          'Minimum term (days)',
        );
        product.insurance.termRules.maximumDays = exactInteger(
          product.insurance.termRules.maximumDays,
          'Maximum term (days)',
        );
        for (const f of [
          ...product.insurance.riskFields,
          ...(product.insurance.riskGroups || []).flatMap((g) => g.fields),
        ]) {
          if (f.type === 'text') {
            f.minLength = exactInteger(f.minLength, `${f.id} minimum length`);
            f.maxLength = exactInteger(f.maxLength, `${f.id} maximum length`);
          }
          if (f.type === 'integer') {
            f.minimum = exactInteger(f.minimum, `${f.id} minimum`);
            f.maximum = exactInteger(f.maximum, `${f.id} maximum`);
          }
          if (f.type === 'decimal') f.scale = exactInteger(f.scale, `${f.id} decimal places`);
        }
        for (const group of product.insurance.riskGroups || []) {
          group.minimumRows = exactInteger(group.minimumRows, 'Minimum risk rows');
          group.maximumRows = exactInteger(group.maximumRows, 'Maximum risk rows');
        }
        transformConditions(product.insurance, 'canonical');
      }
      return product;
    }
    async function handleSubmit(event) {
      if (event.target.id !== 'ic-product-form') return false;
      event.preventDefault();
      if (!editable()) return true;
      try {
        const product = serialize(),
          configuration = clone(state().snapshot.configuration);
        if (index === null) configuration.products.push(product);
        else configuration.products[index] = product;
        submitting = true;
        error = '';
        repaint();
        const saved = await save(configuration);
        if (saved) reset();
      } catch (cause) {
        error = cause.message || 'Could not save the insurance definition.';
        showError(cause, 'Could not save product definition.');
      } finally {
        submitting = false;
        repaint();
        document.getElementById('ic-error')?.focus();
      }
      return true;
    }
    function reset() {
      draft = null;
      index = null;
      section = 'identity';
      submitting = false;
      error = '';
      localDirty = false;
    }
    return { render, handleClick, handleInput, handleChange, handleSubmit, reset };
  };
})();

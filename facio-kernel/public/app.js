'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  const titleCase = (value) =>
    String(value ?? '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]/g, ' ')
      .replace(/^./, (letter) => letter.toUpperCase());
  const date = (value) =>
    value
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(value),
        )
      : 'Not set';
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const state = {
    authConfig: null,
    session: null,
    targetId: null,
    epoch: 0,
    setup: null,
    setupError: null,
    setupForm: null,
    controlPendingWrite: null,
    activationReview: null,
    portalError: null,
    token: '',
    context: null,
    catalog: null,
    snapshot: null,
    report: null,
    requirements: null,
    requirementsError: null,
    requirementsLoading: false,
    insurance: null,
    insuranceError: null,
    insuranceLoading: false,
    insuranceRecord: null,
    insurancePanel: 'list',
    insuranceForm: null,
    insurancePendingWrite: null,
    insuranceEvaluation: null,
    view: 'draft',
    page: 'overview',
    tab: 'inspect',
    dirty: false,
    busy: false,
    pendingWrite: null,
    gapSearch: '',
    gapSeverity: 'all',
    gapLimit: 12,
  };
  const paths = {
    overview:
      '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    tenant: '<path d="M4 21V6l8-3 8 3v15M2 21h20M9 21v-5h6v5M8 8h1m6 0h1M8 12h1m6 0h1"/>',
    operatingEntities:
      '<rect x="3" y="9" width="7" height="12" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/><path d="M6 13h1m-1 4h1M17 7h1m-1 4h1m-1 4h1"/>',
    partyDistribution:
      '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
    products: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8M12 13v9m-5-17 9 5"/>',
    programmesBinders:
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 5V3m8 2V3M3 10h18m-14 5h4m-4 3h8"/>',
    processes:
      '<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-5h14v5"/>',
    jurisdictions:
      '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/>',
    finance: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 10h18m-5 5h2M7 5V3"/>',
    documents: '<path d="M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8m-8 4h8"/>',
    integrations:
      '<path d="m9 3 6 6m-9-3 6 6M5 5 3 7a5 5 0 0 0 7 7l2-2m-3 9-6-6m9 3-6-6m13 7 2-2a5 5 0 0 0-7-7l-2 2"/>',
    reporting: '<path d="M4 3v18h18M9 16v-5m5 5V7m5 9V4"/>',
    experience:
      '<rect x="2" y="3" width="20" height="15" rx="2"/><path d="M2 7h20M8 22h8m-4-4v4M5 5h1m2 0h1"/>',
    tenantRelease: '<path d="m12 3 8 4v6c0 5-8 9-8 9s-8-4-8-9V7l8-4Z"/><path d="m8 12 3 3 5-6"/>',
    version:
      '<path d="M7 3v12a4 4 0 0 0 8 0V9M7 7h7a4 4 0 0 0 4-4"/><circle cx="7" cy="3" r="2"/><circle cx="15" cy="9" r="2"/>',
    gap: '<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3v1"/>',
    valid: '<path d="m12 3 8 4v6c0 5-8 9-8 9s-8-4-8-9V7l8-4Z"/><path d="m8 12 3 3 5-6"/>',
  };
  const icon = (id) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[id] || paths.products}</svg>`;
  const badge = (value, label = titleCase(value)) =>
    `<span class="tag ${escape(value)}">${escape(label)}</span>`;
  const category = (id) => state.catalog?.categories.find((item) => item.id === id);
  const categoryName = (id) => category(id)?.name || titleCase(id);
  const canWrite = () =>
    state.context?.permissions.includes('configuration:write') && state.view === 'draft';
  const canInsurance = (action) => state.context?.permissions.includes(`insurance:${action}`);
  const hosted = () => state.authConfig?.mode === 'hosted-sandbox';
  const canConfigureSandbox = () => state.context?.permissions.includes('configuration:write');

  const insuranceEditor = window.createInsuranceConfigEditor({
    escape,
    clone,
    markDirty: (dirty = true) => (dirty ? markDirty() : (state.dirty = false)),
    save,
    getState: () => state,
    render,
    showError,
  });

  async function api(path, options = {}) {
    const epoch = state.epoch;
    const { unscoped = false, ...request } = options;
    const method = request.method || 'GET';
    const response = await fetch(path, {
      ...request,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        ...(!hosted() && state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(hosted() && state.targetId && !unscoped
          ? { 'X-Kernel-Tenant-Id': state.targetId }
          : {}),
        ...(hosted() && method !== 'GET' && state.session?.csrfToken
          ? { 'X-CSRF-Token': state.session.csrfToken }
          : {}),
        ...(request.body ? { 'Content-Type': 'application/json' } : {}),
        ...request.headers,
      },
    });
    const data = await response.json().catch(() => null);
    if (epoch !== state.epoch) {
      const error = new Error(
        'The selected tenant or session changed while the request was loading.',
      );
      error.code = 'STALE_RESPONSE';
      throw error;
    }
    if (!response.ok) {
      const error = new Error(data?.error?.message || `Request failed (${response.status}).`);
      error.code = data?.error?.code || 'REQUEST_FAILED';
      error.status = response.status;
      error.correlationId = data?.error?.correlationId;
      throw error;
    }
    return data;
  }

  async function readConsistentSnapshot(view) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [snapshot, report] = await Promise.all([
        api(`/api/configuration?view=${view}`),
        api(`/api/gaps?view=${view}`),
      ]);
      if (
        snapshot.view === view &&
        report.view === view &&
        snapshot.version === report.version &&
        snapshot.hash === report.configurationHash
      )
        return { snapshot, report };
    }
    const error = new Error(
      'The configuration changed while its validation report was loading. A matching snapshot and report could not be obtained after three attempts. Refresh to try again.',
    );
    error.code = 'VALIDATION_REPORT_STALE';
    throw error;
  }

  function notify(message, type = 'success', html = '') {
    const element = $('#notification');
    element.className = `message ${type === 'error' ? 'error-message' : type === 'warning' ? 'warning-message' : ''}`;
    element.innerHTML = escape(message) + html;
    element.hidden = false;
  }

  function showError(error, fallback) {
    if (error.code === 'STALE_RESPONSE') return;
    const message = `${fallback ? `${fallback} ` : ''}${error.message}${error.correlationId ? ` Reference: ${error.correlationId}` : ''}`;
    notify(message, 'error');
    if (error.status === 401)
      notify(
        hosted()
          ? 'Your organization session is no longer authorized. Sign in again to continue.'
          : 'Your session is no longer authorized. Sign out and open the workspace with a valid access token.',
        'error',
      );
  }

  function setBusy(busy) {
    state.busy = busy;
    $('#refresh-button').disabled = busy;
    $('#view-draft').disabled = busy;
    $('#view-published').disabled = busy;
    $('#logout-button').disabled = busy;
    $('#switch-sandbox').disabled = busy;
    document
      .querySelectorAll(
        '[data-control-action], [data-select-tenant], #tenant-create-form fieldset, #requirements-attach-form fieldset, #runtime-policy-form fieldset',
      )
      .forEach((element) => {
        element.disabled = busy || element.hasAttribute('data-control-unavailable');
        if (element.matches('a[data-select-tenant]'))
          element.setAttribute('aria-disabled', String(element.disabled));
      });
    document.querySelectorAll('[data-save]').forEach((button) => {
      button.disabled = busy || !canWrite();
    });
    document
      .querySelectorAll('#tenant-form input, #tenant-form select, [data-reset]')
      .forEach((input) => {
        input.disabled = busy || !canWrite();
      });
    if ($('#configuration-json')) $('#configuration-json').disabled = busy;
    document.querySelectorAll('[data-insurance-action]').forEach((button) => {
      const permission = button.dataset.insurancePermission;
      button.disabled =
        busy ||
        button.hasAttribute('data-insurance-unavailable') ||
        (permission && !canInsurance(permission));
    });
    document.querySelectorAll('[data-workflow-guard]').forEach((element) => {
      element.disabled =
        busy ||
        element.hasAttribute('data-approval-unavailable') ||
        element.hasAttribute('data-provider-unavailable') ||
        element.hasAttribute('data-documents-unavailable') ||
        element.hasAttribute('data-finance-unavailable') ||
        element.hasAttribute('data-fnol-unavailable');
    });
    document
      .querySelectorAll('#insurance-quote-form fieldset, #insurance-service-form fieldset')
      .forEach((fieldset) => {
        fieldset.disabled =
          busy ||
          fieldset.hasAttribute('data-insurance-unavailable') ||
          !canInsurance(
            fieldset.closest('#insurance-quote-form') &&
              state.insurancePanel !== 'configured-service'
              ? 'quote'
              : 'service',
          );
      });
  }

  function clearTenantState() {
    insuranceEditor.reset();
    insuranceWorkflow.reset();
    insuranceOperations.reset();
    insuranceFnol.reset();
    state.epoch += 1;
    Object.assign(state, {
      targetId: null,
      context: null,
      catalog: null,
      snapshot: null,
      report: null,
      setup: null,
      setupError: null,
      setupForm: null,
      activationReview: null,
      requirements: null,
      requirementsError: null,
      requirementsLoading: false,
      insurance: null,
      insuranceError: null,
      insuranceLoading: false,
      insuranceRecord: null,
      insurancePanel: 'list',
      insuranceForm: null,
      insurancePendingWrite: null,
      insuranceEvaluation: null,
      pendingWrite: null,
      controlPendingWrite: null,
      dirty: false,
    });
    $('#workspace-content').replaceChildren();
    $('#dialog-body').replaceChildren();
    if ($('#detail-dialog').open) $('#detail-dialog').close();
  }

  async function bootstrap() {
    $('#auth-retry').hidden = true;
    $('#login-error').hidden = true;
    $('#auth-status').hidden = false;
    $('#auth-status').textContent = 'Checking workspace sign-in…';
    try {
      const config = await api('/api/auth/config', { unscoped: true });
      if (!['development', 'hosted-sandbox'].includes(config.mode))
        throw new Error('The server did not provide a supported sign-in mode.');
      state.authConfig = config;
      $('#auth-status').hidden = true;
      $('#login-form').hidden = hosted();
      $('#organization-login').hidden = !hosted();
      if (!hosted()) return;
      document.title =
        window.location.pathname === '/studio' ? 'Facio Platform · Studio' : 'Facio Platform';
      $('.login-form-wrap > .eyebrow').textContent = 'FACIO PLATFORM';
      $('.login-copy h1').innerHTML = 'Your customer workspace.<br />Your next step.';
      $('.login-copy > p').textContent =
        'Open Facio Platform, select your customer workspace, and enter Studio to configure its authorized sandbox tenant.';
      $('.login-copy .light-eyebrow').innerHTML = '<span class="status-dot"></span> FACIO PLATFORM';
      $('.login-description').textContent =
        'Sign in with your organization identity, select a customer workspace, then open Studio for an authorized tenant.';
      $('.login-note').textContent = 'Facio Platform · Shared sandbox';
      $('.login-scope-note p').textContent =
        'Shared sandbox workflows use your organization access. Sandbox activation and synthetic transactions do not establish customer acceptance or production readiness.';
      $('#hosting-badge').textContent = 'Hosted sandbox';
      $('#switch-sandbox').hidden = false;
      try {
        state.session = await api('/api/session', { unscoped: true });
      } catch (error) {
        if (error.status === 401) return;
        throw error;
      }
      $('#login-screen').hidden = true;
      $('#app-shell').hidden = false;
      const route = new URL(window.location.href);
      const tenantId = route.searchParams.get('tenant');
      if (tenantId && state.session.tenants.some((tenant) => tenant.id === tenantId))
        await selectTenant(
          tenantId,
          route.searchParams.get('view') === 'insurance' ? 'insurance' : 'setup',
        );
      else {
        state.page = 'sandboxes';
        if (tenantId)
          state.portalError =
            'That tenant is not in your current authorized account list. Choose an available sandbox.';
        render();
      }
    } catch (error) {
      $('#auth-status').hidden = true;
      $('#login-error').textContent = `Could not establish the workspace session. ${error.message}`;
      $('#login-error').hidden = false;
      $('#auth-retry').hidden = false;
    }
  }

  function updateTargetUrl(page = state.page, enterStudio = false) {
    if (!hosted()) return;
    const url = new URL(window.location.href);
    if (enterStudio) url.pathname = '/studio';
    if (state.targetId) {
      url.searchParams.set('tenant', state.targetId);
      url.searchParams.set('view', page);
    } else {
      url.pathname = '/';
      url.searchParams.delete('tenant');
      url.searchParams.delete('view');
    }
    window.history.replaceState(null, '', url);
  }

  function selectedAccount() {
    const tenant = state.session?.tenants.find((item) => item.id === state.targetId);
    return state.session?.accounts.find((account) => account.id === tenant?.accountId);
  }

  function renderHostedIdentity() {
    const principal = state.session.principal;
    const name = principal.email || principal.actorId;
    $('#actor-name').textContent = name;
    $('.actor-avatar').textContent = name.slice(0, 1).toUpperCase();
    $('#hosting-badge').textContent = 'Hosted sandbox';
    $('#contract-hosting-label').textContent = 'Sandbox';
    $('#platform-label').textContent = 'Facio Platform';
    $('#switch-sandbox').textContent = 'Workspaces';
    document.querySelectorAll('.brand-product').forEach((element) => {
      element.textContent = state.targetId ? 'STUDIO' : 'PLATFORM';
    });
    $('#deployment-context').hidden = false;
    const active = state.setup?.activeRelease;
    const compact = (value) =>
      `<code title="${escape(value)}">${escape(value.length > 16 ? value.slice(0, 16) + '…' : value)}</code>`;
    $('#deployment-context').innerHTML =
      `<span>Build ${compact(state.authConfig.buildSha || 'Unreported')}</span><span>Region <strong>${escape(state.authConfig.region || 'Unreported')}</strong></span><span>${active ? `Active release ${compact(active.id)} · v${active.version}` : 'No active release reported'}</span>`;
  }

  function renderSandboxes() {
    if (!state.session) return;
    renderHostedIdentity();
    $('#workspace-name').textContent = 'Facio Platform';
    $('#workspace-environment').textContent = 'Customer workspaces';
    $('#scope-summary').textContent =
      'Choose a server-authorized account and tenant. Selection does not change another tab or MCP session.';
    $('#primary-nav').innerHTML =
      `<button class="nav-item active" type="button" data-page="sandboxes" aria-current="page"><span class="nav-icon">${icon('overview')}</span>Customer workspaces</button>`;
    $('.sidebar-bottom').hidden = true;
    $('#view-draft').parentElement.hidden = true;
    $('#workspace-label').textContent = 'Customer workspaces';
    $('#workspace-mode').textContent = 'FACIO PLATFORM';
    $('#workspace-footnote').textContent = 'Shared sandbox · Customer acceptance not recorded';
    $('#page-title').textContent = 'Your customer workspaces';
    document.title = 'Facio Platform · Customer workspaces';
    $('#page-description').textContent =
      'Select an authorized customer workspace, then enter Studio for its sandbox tenant. Each account retains its own access assignments.';
    const accounts = state.session.accounts;
    const tenants = state.session.tenants;
    const canCreate = accounts.some((account) =>
      ['owner', 'admin', 'builder'].includes(account.role),
    );
    const cards = accounts
      .map(
        (account) =>
          `<section class="panel sandbox-account"><div class="panel-heading"><div><h2>${escape(account.displayName)}</h2><p>Account ${escape(account.id)} · Workspace ${escape(account.workspaceId)} · ${escape(titleCase(account.role))}</p></div>${['owner', 'admin', 'builder'].includes(account.role) ? `<button type="button" class="button secondary" data-control-action="new-tenant" data-account-id="${escape(account.id)}">Create sandbox tenant</button>` : badge('info', 'Read-only account')}</div><div class="panel-body">${
            tenants
              .filter((tenant) => tenant.accountId === account.id)
              .map(
                (tenant) =>
                  `<article class="sandbox-tenant"><div><h3>${escape(tenant.displayName)}</h3><p>${escape(tenant.scope.environment)} · ${escape(tenant.region)} · ${escape(tenant.scope.operatingEntityId)}</p><p class="field-help">${escape(tenant.id)} · ${escape(titleCase(tenant.setupStatus))}</p></div><div class="sandbox-tenant-actions">${badge(tenant.provisioningState.toLowerCase(), tenant.provisioningState)}<a class="button secondary" href="/studio?tenant=${encodeURIComponent(tenant.id)}" data-select-tenant="${escape(tenant.id)}" aria-disabled="${state.busy}">Open Studio</a></div>${tenant.failureCode ? `<div class="message error-message"><p>${escape(tenant.failureCode)} · Provisioning reference ${escape(tenant.operationId)}</p>${account.role !== 'viewer' ? `<button type="button" class="button secondary" data-control-action="retry-tenant" data-operation-id="${escape(tenant.operationId)}">Retry provisioning</button>` : ''}</div>` : ''}</article>`,
              )
              .join('') ||
            '<div class="empty-state"><h3>No authorized tenants</h3><p>Create a sandbox if your account role permits it, or ask an account administrator to assign access.</p></div>'
          }</div></section>`,
      )
      .join('');
    $('#workspace-content').innerHTML =
      `${state.portalError ? `<div class="message error-message" role="alert">${escape(state.portalError)}</div>` : ''}<div class="message warning-message"><strong class="notice-title">Separate evidence for each stage</strong>Provisioned resources, complete setup and a verified insurance journey are different states. An activated sandbox release does not certify customer acceptance.</div>${cards || '<section class="panel"><div class="empty-state"><h2>No account membership</h2><p>Your organization sign-in succeeded. An administrator must assign a commercial account before you can create or open a tenant.</p></div></section>'}${state.setupForm?.kind === 'create-tenant' && canCreate ? renderTenantCreateForm() : ''}`;
    setBusy(state.busy);
  }

  function renderTenantCreateForm() {
    const form = state.setupForm;
    const account = state.session.accounts.find((entry) => entry.id === form.accountId);
    return `<section class="panel sandbox-account"><form id="tenant-create-form"><div class="panel-heading"><div><h2>Create sandbox tenant</h2><p>${escape(account.displayName)} · Ownership and access come from your authenticated account membership.</p></div></div><div class="panel-body"><fieldset ${state.busy ? 'disabled' : ''}><legend class="visually-hidden">Sandbox tenant details</legend><div class="form-grid"><div class="form-field"><label for="sandbox-name">Sandbox display name</label><input id="sandbox-name" name="displayName" required maxlength="200" value="${escape(form.displayName || '')}"></div><div class="form-field"><label for="sandbox-region">Deployed region</label><input id="sandbox-region" name="region" readonly required value="${escape(state.authConfig.region || '')}"><p class="field-help">This shared environment provisions in the server's configured region. Other residency placements require a separate approved deployment.</p></div></div></fieldset><p class="field-help">Environment: Sandbox. The server assigns the tenant, operating entity and provisioning operation identifiers. Display names do not grant access.</p></div><div class="form-actions"><span>Retrying the same request retains its provisioning identity.</span><div class="form-actions-buttons"><button class="button secondary" type="button" data-control-action="discard-form">Discard form</button><button class="button primary" type="submit" data-control-action="submit-create" ${state.busy ? 'disabled' : ''}>Create tenant</button></div></div></form></section>`;
  }

  async function refreshSession() {
    state.session = await api('/api/session', { unscoped: true });
    if (state.targetId && !state.session.tenants.some((tenant) => tenant.id === state.targetId)) {
      clearTenantState();
      state.page = 'sandboxes';
      state.portalError =
        'Your access to the selected tenant is no longer available. Choose an authorized sandbox.';
    }
  }

  async function openSandboxes() {
    if (state.busy || !discardAllowed()) return;
    clearTenantState();
    state.page = 'sandboxes';
    state.portalError = null;
    updateTargetUrl();
    render();
    setBusy(true);
    try {
      await refreshSession();
    } catch (error) {
      if (error.code !== 'STALE_RESPONSE')
        state.portalError = `Account access could not be refreshed. ${error.message}`;
    } finally {
      setBusy(false);
      render();
    }
  }

  async function readConsistentSetup() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [{ snapshot, report }, setup] = await Promise.all([
        readConsistentSnapshot('draft'),
        api('/api/control/setup'),
      ]);
      if (
        setup.candidate.draftVersion === snapshot.version &&
        setup.candidate.draftHash === snapshot.hash
      )
        return { snapshot, report, setup };
    }
    throw new Error(
      'The draft changed while its activation candidate was loading. Refresh to obtain a matching candidate.',
    );
  }

  async function selectTenant(tenantId, view = 'setup', enterStudio = false) {
    if (state.busy || !discardAllowed()) return;
    if (!state.session.tenants.some((tenant) => tenant.id === tenantId)) return;
    clearTenantState();
    state.targetId = tenantId;
    state.page = view;
    state.view = 'draft';
    const epoch = state.epoch;
    updateTargetUrl(view, enterStudio);
    setBusy(true);
    render();
    try {
      const [context, catalog, content] = await Promise.all([
        api('/api/context'),
        api('/api/catalog'),
        readConsistentSetup(),
      ]);
      if (epoch !== state.epoch) return;
      Object.assign(state, { context, catalog, ...content });
      state.portalError = null;
      render();
    } catch (error) {
      if (epoch !== state.epoch) return;
      state.setupError = error;
      render();
    } finally {
      if (epoch === state.epoch) setBusy(false);
    }
    if (epoch === state.epoch && state.snapshot && view === 'insurance') await loadInsurance();
  }

  async function loadSetup() {
    if (!hosted() || !state.targetId) return;
    const epoch = state.epoch;
    state.setup = null;
    state.setupError = null;
    state.setupForm = null;
    state.activationReview = null;
    state.controlPendingWrite = null;
    state.dirty = false;
    setBusy(true);
    render();
    try {
      const content = await readConsistentSetup();
      if (epoch !== state.epoch) return;
      Object.assign(state, content, { view: 'draft' });
    } catch (error) {
      if (epoch === state.epoch) state.setupError = error;
    } finally {
      if (epoch === state.epoch) {
        setBusy(false);
        render();
      }
    }
  }

  async function loadSnapshot({ showLoading = true, targetView = state.view } = {}) {
    setBusy(true);
    if (showLoading) {
      $('#loading-state').hidden = false;
      $('#workspace-content').hidden = true;
    }
    try {
      const { snapshot, report } = await readConsistentSnapshot(targetView);
      insuranceEditor.reset();
      state.view = targetView;
      state.snapshot = snapshot;
      state.report = report;
      state.dirty = false;
      state.pendingWrite = null;
      render();
    } catch (error) {
      showError(error, 'Could not load configuration.');
    } finally {
      setBusy(false);
      $('#loading-state').hidden = true;
      $('#workspace-content').hidden = false;
    }
  }

  async function loadRequirements() {
    const sessionToken = state.token;
    state.requirements = null;
    state.requirementsError = null;
    state.requirementsLoading = true;
    setBusy(true);
    render();
    try {
      const report = await api('/api/requirements');
      if (state.token !== sessionToken) return;
      state.requirements = report;
    } catch (error) {
      if (state.token !== sessionToken) return;
      state.requirementsError = error.message;
    } finally {
      if (state.token === sessionToken) {
        state.requirementsLoading = false;
        setBusy(false);
        render();
      }
    }
  }

  function renderNav() {
    $('#primary-nav').innerHTML =
      (hosted()
        ? `<button class="nav-item" type="button" data-page="sandboxes"><span class="nav-icon">${icon('overview')}</span>Customer workspaces</button><button class="nav-item ${state.page === 'setup' ? 'active' : ''}" type="button" data-page="setup" ${state.page === 'setup' ? 'aria-current="page"' : ''}><span class="nav-icon">${icon('tenantRelease')}</span>Sandbox setup</button>`
        : '') +
      `<button class="nav-item ${state.page === 'overview' ? 'active' : ''}" type="button" data-page="overview" ${state.page === 'overview' ? 'aria-current="page"' : ''}><span class="nav-icon">${icon('overview')}</span>Workspace overview</button><button class="nav-item ${state.page === 'insurance' ? 'active' : ''}" type="button" data-page="insurance" ${state.page === 'insurance' ? 'aria-current="page"' : ''}><span class="nav-icon">${icon('products')}</span>Insurance workspace</button><button class="nav-item ${state.page === 'requirements' ? 'active' : ''}" type="button" data-page="requirements" ${state.page === 'requirements' ? 'aria-current="page"' : ''}><span class="nav-icon">${icon('documents')}</span>Journey requirements</button><div class="nav-label">CONFIGURATION</div>${state.catalog.categories.map((item) => `<button type="button" class="nav-item ${state.page === item.id ? 'active' : ''}" data-page="${escape(item.id)}" ${state.page === item.id ? 'aria-current="page"' : ''}><span class="nav-icon">${icon(item.id)}</span><span>${escape(item.name)}</span><span class="nav-status ${escape(item.support)}" title="${escape(titleCase(item.support))}" aria-label="Support: ${escape(item.support)}"></span></button>`).join('')}`;
  }

  function render() {
    if (hosted() && state.session) {
      if (!state.targetId || state.page === 'sandboxes') {
        renderSandboxes();
        return;
      }
      if (!state.snapshot) {
        renderHostedIdentity();
        $('.sidebar-bottom').hidden = true;
        $('#view-draft').parentElement.hidden = true;
        $('#primary-nav').innerHTML =
          '<button class="nav-item" type="button" data-page="sandboxes">Customer workspaces</button>';
        $('#workspace-name').textContent =
          state.session.tenants.find((tenant) => tenant.id === state.targetId)?.displayName ||
          'Authorized sandbox';
        $('#workspace-environment').textContent = 'Sandbox';
        $('#scope-summary').textContent = `Selected tenant ${state.targetId}`;
        $('#page-title').textContent = 'Opening sandbox setup';
        $('#page-description').textContent =
          'Reading configuration, source attachment and the activation candidate from the same tenant.';
        $('#workspace-content').innerHTML = state.setupError
          ? `<div class="message error-message" role="alert">${escape(state.setupError.message)}<p>Use Refresh to retry, or return to Customer workspaces to inspect provisioning. Unavailable data does not establish tenant readiness.</p></div>`
          : '<div class="loading-state" role="status"><span class="spinner" aria-hidden="true"></span>Loading authorized tenant…</div>';
        return;
      }
    }
    if (!state.snapshot) return;
    const isOverview = state.page === 'overview';
    const isRequirements = state.page === 'requirements';
    const isInsurance = state.page === 'insurance';
    const isSetup = state.page === 'setup';
    const current = category(state.page);
    renderNav();
    $('.sidebar-bottom').hidden = false;
    $('#workspace-name').textContent =
      state.snapshot.configuration.tenant?.displayName || state.context.tenantId;
    $('#workspace-environment').textContent = state.context.environment;
    $('#actor-name').textContent = state.context.actorId;
    $('.actor-avatar').textContent = state.context.actorId.slice(0, 1).toUpperCase();
    $('#scope-summary').innerHTML =
      `<span class="scope-values"><span>Workspace <b>${escape(state.context.workspaceId)}</b></span><i>·</i><span>Tenant <b>${escape(state.context.tenantId)}</b></span><i>·</i><span>Entity <b>${escape(state.context.operatingEntityId)}</b></span><i>·</i><span>${escape(titleCase(state.context.environment))}</span></span>`;
    $('#contract-version').textContent = state.catalog.contractVersion;
    $('#audit-button').hidden = !state.context.permissions.includes('audit:read');
    $('#view-draft').setAttribute('aria-pressed', String(state.view === 'draft'));
    $('#view-published').setAttribute('aria-pressed', String(state.view === 'published'));
    $('#view-draft').parentElement.hidden = isRequirements || isInsurance || isSetup;
    $('#workspace-label').textContent = isInsurance ? 'Kernel workspace' : 'Configuration Studio';
    $('#workspace-mode').textContent = isInsurance
      ? 'INSURANCE RUNTIME'
      : 'CONFIGURATION FOUNDATION';
    $('#workspace-footnote').textContent = isInsurance
      ? 'Insurance runtime · Local development'
      : 'Configuration foundation · Local development';
    document.title = isInsurance ? 'Facio · Insurance workspace' : 'Facio · Configuration Studio';
    $('#page-title').textContent = isSetup
      ? 'Sandbox setup'
      : isInsurance
        ? 'Insurance workspace'
        : isRequirements
          ? 'Journey requirements'
          : isOverview
            ? 'Configuration overview'
            : current.name;
    $('#page-description').textContent = isSetup
      ? 'Attach source requirements, configure the supported runtime, and activate an exact sandbox release.'
      : isOverview
        ? 'The definitions you have. The capabilities you need. A clear view of the gaps.'
        : isInsurance
          ? 'Follow a synthetic quote through binding and versioned policy changes.'
          : isRequirements
            ? 'Source-backed delivery scope and declared open inputs for this workspace.'
            : current.description;
    $('#workspace-content').innerHTML = isSetup
      ? renderSetup()
      : isInsurance
        ? renderInsurance()
        : isRequirements
          ? renderRequirements()
          : !state.report
            ? renderUnavailableReport()
            : isOverview
              ? renderOverview()
              : renderCategory(current);
    if (hosted()) {
      renderHostedIdentity();
      $('#workspace-label').textContent = 'Studio';
      $('#workspace-mode').textContent = isSetup
        ? 'SANDBOX SETUP'
        : isInsurance
          ? 'INSURANCE RUNTIME'
          : 'TENANT CONFIGURATION';
      $('#workspace-footnote').textContent = 'Shared sandbox · Customer acceptance not recorded';
      document.title = `Facio Platform · Studio · ${$('#page-title').textContent}`;
    }
    renderGapRows();
  }

  function controlButton(action, label, { disabled = false, primary = false, extra = '' } = {}) {
    return `<button type="button" class="button ${primary ? 'primary' : 'secondary'}" data-control-action="${action}" ${disabled ? 'disabled data-control-unavailable' : state.busy ? 'disabled' : ''} ${extra}>${escape(label)}</button>`;
  }

  function renderSetup() {
    if (state.setupError)
      return `<div class="message error-message" role="alert"><strong class="notice-title">Setup evidence unavailable</strong>${escape(state.setupError.message)}<p>Refresh before preparing an activation. No readiness status is inferred from this failed read.</p></div>`;
    if (!state.setup)
      return '<div class="loading-state" role="status"><span class="spinner" aria-hidden="true"></span>Loading setup and activation candidate…</div>';
    const { tenant, requirements, runtimeDraft, activeRelease, candidate } = state.setup;
    const editable = canConfigureSandbox();
    const facts = (label, value) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`;
    const sourceForm =
      state.setupForm?.kind === 'requirements'
        ? `<form id="requirements-attach-form" class="setup-source-form"><fieldset ${!editable || state.busy ? 'disabled data-control-unavailable' : ''}><legend class="visually-hidden">Requirements package import</legend><div class="form-field"><label for="requirements-file">Read a requirements package file</label><input id="requirements-file" type="file" accept="application/json,.json"><p class="field-help">Existing RequirementsProfile JSON, up to 200 KB. Reading a file fills the review field; Attach package saves it.</p></div><div class="form-field"><label for="requirements-json">Requirements package JSON</label><textarea id="requirements-json" class="json-editor" required spellcheck="false" rows="12">${escape(state.setupForm.json || '')}</textarea></div></fieldset><p class="field-help">The server validates the package and computes its content hash. External source documents and submitted source checksums remain unverified; importing this package does not record approval.</p><div class="form-actions-buttons">${controlButton('discard-form', 'Discard form')}<button type="submit" class="button primary" data-control-action="submit-requirements" ${!editable ? 'disabled data-control-unavailable' : ''}>Attach package</button></div></form>`
        : '';
    const policies = runtimeDraft.policies
      .map(
        (policy, index) =>
          `<article class="sandbox-tenant"><div><h3>${escape(policy.name)}</h3><p>${escape(policy.id)} · ${escape(policy.version)} · ${escape(policy.currency)}</p><p class="field-help">Maximum ${escape(insuranceMoney(policy.maximumPremiumMinor, policy.currency))} · ${policy.maximumParticipants} participants · Commission ${escape(basisPoints(policy.commission.rateBps))}</p></div><div class="sandbox-tenant-actions">${controlButton('edit-policy', 'Edit draft policy', { disabled: !editable, extra: `data-policy-index="${index}"` })}${controlButton('remove-policy', 'Remove from draft', { disabled: !editable, extra: `data-policy-index="${index}"` })}</div></article>`,
      )
      .join('');
    return `<div class="sandbox-readiness" aria-label="Separate readiness dimensions"><section><span>Infrastructure and access</span><h2>${escape(tenant.provisioningState)}</h2><p>${tenant.provisioningState === 'Ready' ? 'Tenant resources and setup requirements are recorded by the server.' : 'Setup is still progressing. Inspect the required steps below.'} Hosting and recovery acceptance require their own evidence.</p></section><section><span>Configuration and activation</span><h2>${activeRelease ? `Active release v${activeRelease.version}` : candidate.canActivate ? 'Candidate can activate' : 'Setup incomplete'}</h2><p>${requirements ? 'A versioned requirements package is attached.' : 'A requirements package is needed.'} ${candidate.canActivate ? 'The current candidate satisfies the implemented activation checks.' : `${candidate.blockers.length} activation blockers reported.`}</p></section><section><span>Insurance journey evidence</span><h2>${activeRelease ? 'Activated · unverified' : 'No active release'}</h2><p>Supported configured and manual external quote workflows can run. Customer acceptance is not recorded; activation is not a successful scenario test.</p></section></div><section class="panel sandbox-account"><div class="panel-heading"><div><h2>Tenant identity and provisioning</h2><p>${escape(tenant.displayName)} · ${escape(selectedAccount()?.displayName || tenant.accountId)}</p></div>${tenant.failureCode ? controlButton('retry-tenant', 'Retry provisioning', { disabled: !editable, extra: `data-operation-id="${escape(tenant.operationId)}"` }) : ''}</div><div class="panel-body"><dl class="insurance-facts">${facts('Tenant', tenant.id)}${facts('Owner actor', tenant.ownerActorId)}${facts('Region / environment', `${tenant.region} / ${tenant.scope.environment}`)}${facts('Operating entity', tenant.scope.operatingEntityId)}${facts('Provisioning reference', tenant.operationId)}${facts('Setup status', titleCase(tenant.setupStatus))}</dl>${tenant.failureCode ? `<div class="message error-message">${escape(tenant.failureCode)}</div>` : ''}</div></section><section class="panel sandbox-account"><div class="panel-heading"><div><h2>1. Attach source requirements</h2><p>${requirements ? `${escape(requirements.profile.title)} · attachment v${requirements.version} · package ${escape(requirements.profile.version)}` : 'No requirements package attached'}</p></div>${controlButton('attach-requirements', requirements ? 'Attach new version' : 'Import package', { disabled: !editable })}</div><div class="panel-body">${requirements ? `<p class="field-help">${requirements.profile.requirements.length} requirements · Source document claims: ${escape(requirements.sourceClaimsStatus)}</p><p class="requirement-hash">Retained package hash <code>${escape(requirements.sourceProfileHash)}</code></p><button type="button" class="button secondary" data-page="requirements">Inspect Journey requirements</button>` : '<p class="field-help">Import an existing typed requirements package. This changes tenant data without a code release.</p>'}${sourceForm}</div></section><section class="panel sandbox-account"><div class="panel-heading"><div><h2>2. Configure the supported journey</h2><p>Configuration draft v${candidate.draftVersion} · executable policy draft v${runtimeDraft.version}</p></div><button type="button" class="button secondary" data-page="products">Configure insurance products</button></div><div class="panel-body"><p class="field-help">Use the existing configuration screens to define tenant, entity, product and process configuration. Author insurance questions, coverages and rules in Products, then add its operating policy below. Both drafts remain separate from the active immutable release until activation.</p>${policies || '<div class="empty-state"><h3>No executable policies in this draft</h3><p>Define a product in configuration, then add its operating policy.</p></div>'}${controlButton('new-policy', 'Add executable policy', { disabled: !editable || !state.snapshot.configuration.products.length })}${!state.snapshot.configuration.products.length ? '<p class="field-help">A configured product is required before adding its executable policy.</p>' : ''}${state.setupForm?.kind === 'policy' ? renderRuntimePolicyForm() : ''}<details class="insurance-trace"><summary>Runtime draft contract and hash</summary><p class="requirement-hash"><code>${escape(runtimeDraft.hash)}</code></p><pre class="json-output" tabindex="0">${escape(JSON.stringify(runtimeDraft, null, 2))}</pre></details></div></section><section class="panel sandbox-account"><div class="panel-heading"><div><h2>3. Validate and activate</h2><p>The candidate is pinned to exact configuration, source and policy versions.</p></div>${controlButton('review-activation', 'Review activation', { disabled: !editable || !candidate.canActivate, primary: true })}</div><div class="panel-body">${candidate.blockers.length ? `<div class="message warning-message"><strong class="notice-title">Activation blockers</strong><ul>${candidate.blockers.map((blocker) => `<li>${escape(blocker)}</li>`).join('')}</ul></div>` : '<p class="field-help">The server reports that this candidate passes the implemented sandbox activation checks. Unsupported customer journeys remain outside this release.</p>'}<dl class="insurance-facts">${facts('Configuration draft hash', candidate.draftHash)}${facts('Runtime policy draft hash', candidate.runtimeDraftHash)}${facts('Requirements package hash', candidate.requirementsHash || 'Not attached')}${facts('Serving build', state.authConfig.buildSha || 'Unreported')}</dl>${state.activationReview ? renderActivationReview() : ''}</div></section><section class="panel sandbox-account"><div class="panel-heading"><div><h2>4. Run the same tenant application</h2><p>${activeRelease ? `Active release v${activeRelease.version} · ${escape(activeRelease.compatibilityVersion)}` : 'No active sandbox release'}</p></div><button type="button" class="button primary" data-page="insurance" ${!activeRelease ? 'disabled' : ''}>Open Insurance workspace</button></div><div class="panel-body">${activeRelease ? `<dl class="insurance-facts">${facts('Active release', activeRelease.id)}${facts('Release hash', activeRelease.hash)}${facts('Activation build', activeRelease.buildSha)}${facts('Activated at', date(activeRelease.activatedAt))}</dl><p class="field-help">New quotes use the active release. Existing records retain their own release reference. Insurance records use the same durable application services as the API.</p>` : '<p class="field-help">A saved configuration draft does not change the running application. Activate a compatible candidate to make its supported insurance workflow available.</p>'}${renderRecoveryControls()}<details class="insurance-trace"><summary>MCP connection and diagnostic references</summary><p>Endpoint: <code>${escape(window.location.origin + '/mcp')}</code></p><p class="field-help">Use your own authorized identity and explicit tenant target. OAuth connection, renewal and revocation in the actual intern ChatGPT workspace require separate verification.</p><p class="field-help">For a failed scenario, retain tenant ${escape(tenant.id)}, serving build ${escape(state.authConfig.buildSha || 'unreported')}, active release ${escape(activeRelease?.id || 'none')}, operation and correlation reference. Do not include session tokens or source customer data.</p></details></div></section>`;
  }

  function renderActivationReview() {
    const candidate = state.activationReview;
    return `<section class="activation-review" aria-labelledby="activation-title"><h3 id="activation-title">Activate this exact sandbox candidate</h3><p>Configuration v${candidate.draftVersion} and executable policy v${candidate.runtimeDraftVersion} will be retained with the attached requirements as an immutable release. This activates the supported synthetic journey; it does not create a production release or record customer acceptance.</p><p class="requirement-hash">Configuration <code>${escape(candidate.draftHash)}</code><br>Policies <code>${escape(candidate.runtimeDraftHash)}</code><br>Requirements <code>${escape(candidate.requirementsHash)}</code></p><div class="form-actions-buttons">${controlButton('cancel-activation', 'Cancel review')}${controlButton('confirm-activation', 'Activate sandbox release', { disabled: !canConfigureSandbox(), primary: true })}</div></section>`;
  }

  function renderRecoveryControls() {
    const active = state.setup?.activeRelease;
    const editable = canConfigureSandbox();
    return `<details class="insurance-trace"><summary>Activation recovery and MCP connections</summary>${active ? `<form id="sandbox-rollback-form"><fieldset ${!editable ? 'disabled data-control-unavailable' : ''}><legend class="visually-hidden">Select a retained sandbox release</legend><div class="form-field"><label for="rollback-release-id">Retained release ID to restore</label><input id="rollback-release-id" name="releaseId" required pattern="[a-fA-F0-9-]{36}" placeholder="UUID from a previous activation receipt"></div><p class="field-help">Current active release: <code>${escape(active.id)}</code>. This command selects a retained compatible release for new quotes. It does not restore a database backup, change drafts or delete existing insurance history.</p><button type="submit" class="button secondary" data-control-action="submit-rollback" ${!editable ? 'disabled data-control-unavailable' : ''}>Restore retained sandbox release</button></fieldset></form>` : ''}<p class="field-help">Inspect your own MCP authorizations, including ChatGPT connections. Disconnecting revokes all of your MCP client grants; it does not sign out this browser or change tenant data.</p>${controlButton('view-connections', 'Inspect MCP connections')}</details>`;
  }

  function setupField(name, label, { type = 'text', help = '', required = true } = {}) {
    return `<div class="form-field"><label for="policy-${name}">${escape(label)}</label><input id="policy-${name}" name="${name}" type="${type}" ${required ? 'required' : ''} ${['maximumPremium', 'commissionRate'].includes(name) ? 'inputmode="decimal"' : ''} value="${escape(state.setupForm?.[name] ?? '')}">${help ? `<p class="field-help">${escape(help)}</p>` : ''}</div>`;
  }

  function renderRuntimePolicyForm() {
    const form = state.setupForm;
    const editable = canConfigureSandbox();
    const products = state.snapshot.configuration.products;
    return `<form id="runtime-policy-form" class="runtime-policy-form"><h3>${form.index === null ? 'Add executable policy' : 'Edit executable policy draft'}</h3><p class="field-help">Set operating limits, commission and prerequisites for the selected product. Configured pricing and underwriting rules belong to its insurance definition; external quotes retain their supplied price. These fields do not record provider verification, approval or payment.</p><fieldset ${!editable || state.busy ? 'disabled data-control-unavailable' : ''}><legend class="visually-hidden">Executable policy configuration</legend><div class="form-grid"><div class="form-field"><label for="policy-product">Defined product version</label><select id="policy-product" name="product" required>${products.map((product) => `<option value="${escape(product.id + '@' + product.version)}" ${form.product === product.id + '@' + product.version ? 'selected' : ''}>${escape(product.name)} · ${escape(product.version)}</option>`).join('')}</select></div>${setupField('name', 'Policy display name')}<div class="form-field"><label for="policy-currency">Policy currency</label><select id="policy-currency" name="currency" required><option value="">Select currency</option>${Object.keys(
      moneyDigits,
    )
      .map(
        (currency) =>
          `<option ${form.currency === currency ? 'selected' : ''}>${currency}</option>`,
      )
      .join(
        '',
      )}</select></div>${setupField('maximumPremium', 'Maximum premium amount', { help: 'Currency amount with exact decimal places. The registered policy enforces this limit.' })}${setupField('effectiveFrom', 'Policy effective from', { type: 'date' })}${setupField('effectiveTo', 'Policy effective through', { type: 'date' })}${setupField('maximumParticipants', 'Maximum participant count', { type: 'number' })}${setupField('commissionRate', 'Commission rate (%)', { help: 'Percentage of gross premium. Separate calculated interest, with external cash custody.' })}${setupField('recipientId', 'Commission recipient identifier')}${setupField('settlementPartyId', 'Settlement party identifier')}${['payment', 'approval', 'providerVerification'].map((gate) => `<div class="form-field"><label for="policy-${gate}">${escape(titleCase(gate))} prerequisite</label><select id="policy-${gate}" name="${gate}" required><option value="">Choose an explicit requirement</option><option value="not_required" ${form[gate] === 'not_required' ? 'selected' : ''}>Not required for this sandbox policy</option>${gate === 'approval' ? `<option value="independent_review" ${form[gate] === 'independent_review' ? 'selected' : ''}>Independent human review before binding</option>` : ''}<option value="required_unsupported" ${form[gate] === 'required_unsupported' ? 'selected' : ''}>Required; verification is not implemented</option></select></div>`).join('')}</div></fieldset><div class="form-actions-buttons">${controlButton('discard-form', 'Discard form')}<button type="submit" class="button primary" data-control-action="submit-policy" ${!editable ? 'disabled data-control-unavailable' : ''}>Save executable policy draft</button></div></form>`;
  }

  function startRuntimePolicy(index = null) {
    if (!canConfigureSandbox() || !discardAllowed()) return;
    const policy = index === null ? null : state.setup.runtimeDraft.policies[index];
    const first = state.snapshot.configuration.products[0];
    if (!first) return;
    state.setupForm = {
      kind: 'policy',
      index,
      product: policy ? `${policy.id}@${policy.version}` : `${first.id}@${first.version}`,
      name: policy?.name || first.name,
      currency: policy?.currency || state.snapshot.configuration.tenant?.currency || '',
      maximumPremium: policy
        ? integerToDecimal(policy.maximumPremiumMinor, moneyDigits[policy.currency])
        : '',
      effectiveFrom: policy?.effectiveFrom || '',
      effectiveTo: policy?.effectiveTo || '',
      maximumParticipants: policy ? String(policy.maximumParticipants) : '',
      commissionRate: policy ? integerToDecimal(policy.commission.rateBps, 2) : '',
      recipientId: policy?.commission.recipientId || '',
      settlementPartyId: policy?.commission.settlementPartyId || '',
      payment: policy?.requirements.payment || '',
      approval: policy?.requirements.approval || '',
      providerVerification: policy?.requirements.providerVerification || '',
    };
    state.dirty = false;
    render();
    $('#runtime-policy-form').scrollIntoView({ block: 'start' });
    $('#policy-product').focus();
  }

  async function writeControl(path, method, payload, unscoped = false) {
    if (state.busy) return;
    const epoch = state.epoch;
    const pending = state.controlPendingWrite;
    if (
      pending &&
      (pending.path !== path ||
        pending.method !== method ||
        JSON.stringify(pending.payload) !== JSON.stringify(payload))
    ) {
      notify(
        'A prior control command has an uncertain result. Retry that exact command or refresh to inspect durable state before changing it.',
        'warning',
      );
      return;
    }
    if (!pending)
      state.controlPendingWrite = { path, method, payload, idempotencyKey: crypto.randomUUID() };
    const command = state.controlPendingWrite;
    setBusy(true);
    $('#notification').hidden = true;
    try {
      const result = await api(path, {
        method,
        unscoped,
        body: JSON.stringify({ ...payload, idempotencyKey: command.idempotencyKey }),
      });
      if (epoch !== state.epoch) return;
      state.controlPendingWrite = null;
      state.setupForm = null;
      state.activationReview = null;
      state.dirty = false;
      if (!result.candidate) {
        await refreshSession();
        if (epoch !== state.epoch) return;
        setBusy(false);
        await selectTenant(result.tenant.id, 'setup', true);
      } else {
        state.setup = result;
        state.insurance = null;
        state.insuranceRecord = null;
        state.requirements = null;
        state.session.tenants = state.session.tenants.map((tenant) =>
          tenant.id === result.tenant.id ? result.tenant : tenant,
        );
        render();
      }
      notify(
        path.endsWith('/activate')
          ? 'Sandbox release activated. Customer acceptance and scenario execution evidence remain separate.'
          : 'Saved to the authorized tenant. The server retains its version and audit reference.',
      );
    } catch (error) {
      if (epoch !== state.epoch) return;
      if (error.status && error.status < 500) state.controlPendingWrite = null;
      else state.dirty = true;
      showError(
        error,
        error.status === 409
          ? 'The candidate or revision changed. Your inputs are preserved; refresh before preparing a new command.'
          : error.status && error.status < 500
            ? 'The command was not accepted.'
            : 'The result is uncertain. Retry the same command to reuse its request identity.',
      );
    } finally {
      if (epoch === state.epoch) setBusy(false);
    }
  }

  function sourceLocation(source) {
    try {
      const url = new URL(source.location);
      if (url.protocol === 'https:' && !url.username && !url.password)
        return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer" aria-label="Open source: ${escape(source.title)}">${escape(source.location)}</a>`;
    } catch {
      // Local paths and non-URL source identifiers remain inspectable text.
    }
    return escape(source.location);
  }

  const insuranceBoundary =
    '<div class="message warning-message"><strong class="notice-title">Synthetic local insurance workflow</strong>These records demonstrate canonical operations in this development scope. They do not create production policies, customer-approved insurance commitments, received premiums or paid transactions.</div>';
  const moneyDigits = { GBP: 2, USD: 2, EUR: 2, JPY: 0, KWD: 3 };
  // Representation only: exact decimal strings cross the canonical minor-unit boundary.
  function integerToDecimal(value, places) {
    const raw = String(value);
    const negative = raw.startsWith('-');
    const digits = raw.replace(/^-/, '').padStart(places + 1, '0');
    return `${negative ? '-' : ''}${places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits}`;
  }
  function decimalToInteger(value, places, label, signed = false) {
    const raw = String(value).trim();
    const valid = signed
      ? /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/
      : /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
    if (!valid.test(raw) || raw.length > 64)
      throw new Error(
        `${label}: enter a decimal amount, using a dot for decimals and optional grouped thousands.`,
      );
    const [whole, fraction = ''] = raw.replace(/^[+-]/, '').replaceAll(',', '').split('.');
    if (fraction.length > places)
      throw new Error(
        `${label}: use at most ${places} decimal places. Extra digits are not rounded.`,
      );
    const magnitude = (whole + fraction.padEnd(places, '0')).replace(/^0+(?=\d)/, '');
    return `${raw.startsWith('-') && magnitude !== '0' ? '-' : ''}${magnitude}`;
  }
  function percentToBasisPoints(value, label) {
    const integer = decimalToInteger(value, 2, label);
    if (BigInt(integer) > 10000n)
      throw new Error(`${label}: a percentage must be at most 100.00%.`);
    return Number(integer);
  }
  function insuranceMoney(minor, currency) {
    const raw = String(minor ?? '');
    if (!/^-?\d+$/.test(raw) || moneyDigits[currency] === undefined)
      return `${currency || ''} ${raw}`.trim();
    const negative = raw.startsWith('-');
    const digits = raw.replace(/^-/, '').padStart(moneyDigits[currency] + 1, '0');
    const exponent = moneyDigits[currency];
    const whole = (exponent ? digits.slice(0, -exponent) : digits).replace(
      /\B(?=(\d{3})+(?!\d))/g,
      ',',
    );
    return `${currency} ${negative ? '−' : ''}${whole}${exponent ? '.' + digits.slice(-exponent) : ''}`;
  }
  const basisPoints = (value) =>
    `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, '0')}%`;
  function insuranceButton(action, label, permission = null, secondary = true, extra = '') {
    return `<button type="button" class="button ${secondary ? 'secondary' : 'primary'}" data-insurance-action="${escape(action)}" ${permission ? `data-insurance-permission="${escape(permission)}"` : ''} ${state.busy || (permission && !canInsurance(permission)) ? 'disabled' : ''} ${extra}>${escape(label)}</button>`;
  }
  const decisionView = window.createInsuranceDecisionView({
    escape,
    titleCase,
    money: insuranceMoney,
    toMinor: decimalToInteger,
    fromMinor: integerToDecimal,
    moneyDigits,
    field: insuranceField,
    button: insuranceButton,
  });
  const insuranceWorkflow = window.createInsuranceWorkflow({
    api,
    getContext: () => state.context,
    getEpoch: () => state.epoch,
    getRecord: () => state.insuranceRecord?.record,
    isBusy: () => state.busy,
    setBusy,
    render,
    notify,
    showError,
    markDirty: (dirty) => {
      state.dirty = dirty;
    },
    discardAllowed,
    reloadRecord: (id) => loadInsurance(id),
    openForm: () => {
      insuranceOperations.discardDraft();
      insuranceFnol.discardDraft();
      state.insurancePanel = 'list';
      state.insuranceForm = state.insurancePendingWrite = null;
      state.insuranceEvaluation = null;
      state.dirty = false;
    },
    escape,
    titleCase,
    money: insuranceMoney,
    date,
  });
  const insuranceOperations = window.createInsuranceOperations({
    api,
    getContext: () => state.context,
    getEpoch: () => state.epoch,
    getRecord: () => state.insuranceRecord?.record,
    isBusy: () => state.busy,
    setBusy,
    render,
    notify,
    showError,
    markDirty: (dirty) => {
      state.dirty = dirty;
    },
    discardAllowed,
    reloadRecord: (id) => loadInsurance(id),
    escape,
    titleCase,
    money: insuranceMoney,
    toMinor: decimalToInteger,
    fromMinor: integerToDecimal,
    moneyDigits,
    openForm: () => {
      insuranceWorkflow.discardDraft();
      insuranceFnol.discardDraft();
      state.insurancePanel = 'list';
      state.insuranceForm = state.insurancePendingWrite = null;
      state.insuranceEvaluation = null;
      state.dirty = false;
    },
  });
  const insuranceFnol = window.createInsuranceFnol({
    api,
    getContext: () => state.context,
    getEpoch: () => state.epoch,
    getRecord: () => state.insuranceRecord?.record,
    getHistory: () => state.insuranceRecord?.history,
    isBusy: () => state.busy,
    setBusy,
    render,
    notify,
    showError,
    markDirty: (dirty) => {
      state.dirty = dirty;
    },
    discardAllowed,
    escape,
    titleCase,
    openForm: () => {
      insuranceWorkflow.discardDraft();
      insuranceOperations.discardDraft();
      state.insurancePanel = 'list';
      state.insuranceForm = state.insurancePendingWrite = null;
      state.insuranceEvaluation = null;
      state.dirty = false;
    },
  });
  function insuranceDefinition() {
    if (['revise', 'configured-service', 'configured-cancellation'].includes(state.insurancePanel))
      return state.insuranceRetainedDefinition?.insurance || null;
    if (!['create', 'renewal'].includes(state.insurancePanel)) return null;
    return (
      state.insurance?.catalog.policies.find(
        ({ policy }) =>
          policy.id === state.insuranceForm?.productId &&
          policy.version === state.insuranceForm?.productVersion,
      )?.insurance || null
    );
  }
  function insurancePolicy() {
    if (
      ['revise', 'configured-service', 'configured-cancellation'].includes(state.insurancePanel) &&
      state.insuranceRetainedDefinition
    )
      return state.insuranceRetainedDefinition.policy;
    const entry = state.insurance?.catalog.policies.find(
      ({ policy }) =>
        policy.id === state.insuranceForm?.productId &&
        policy.version === state.insuranceForm?.productVersion,
    );
    if (
      state.insurancePanel === 'revise' &&
      entry?.policyHash !== state.insuranceRecord?.record.productPolicyHash
    )
      return null;
    return entry?.policy;
  }
  async function readInsuranceRecord(recordId) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [current, history, definition] = await Promise.all([
        api(`/api/insurance/record?recordId=${encodeURIComponent(recordId)}`),
        api(`/api/insurance/history?recordId=${encodeURIComponent(recordId)}`),
        api(`/api/insurance/record-definition?recordId=${encodeURIComponent(recordId)}`),
      ]);
      const latest = history.revisions.at(-1);
      if (
        latest &&
        latest.version === current.record.version &&
        latest.recordHash === current.record.recordHash &&
        definition.recordId === current.record.id &&
        definition.policyHash === current.record.productPolicyHash &&
        definition.runtimeReleaseId === (current.record.runtimeReleaseId ?? null)
      )
        return { record: current.record, history, definition };
    }
    throw new Error(
      'The record changed while its history was loading. Refresh to obtain a consistent record and version history.',
    );
  }
  async function loadInsurance(recordId = state.insuranceRecord?.record.id) {
    if (!canInsurance('read')) return;
    const epoch = state.epoch;
    insuranceWorkflow.reset();
    insuranceOperations.reset();
    insuranceFnol.reset();
    state.insuranceLoading = true;
    state.insuranceError = null;
    state.insurance = null;
    state.insuranceRecord = null;
    state.insurancePanel = 'list';
    state.insuranceForm = null;
    state.insurancePendingWrite = null;
    state.dirty = false;
    setBusy(true);
    render();
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const [catalog, records, setup] = await Promise.all([
          api('/api/insurance/catalog'),
          api('/api/insurance/records'),
          hosted() ? api('/api/control/setup') : Promise.resolve(null),
        ]);
        if (epoch !== state.epoch) return;
        if (
          setup &&
          catalog.policies.some((entry) => entry.runtimeReleaseId !== setup.activeRelease?.id)
        )
          continue;
        state.insurance = { catalog, records: records.records, hasMore: records.hasMore };
        if (setup) state.setup = setup;
        break;
      }
      if (!state.insurance)
        throw new Error(
          'The active release changed while its runtime catalog was loading. Refresh for matching release evidence.',
        );
      if (recordId) {
        const selected = await readInsuranceRecord(recordId);
        if (epoch !== state.epoch) return;
        state.insuranceRecord = selected;
        await Promise.all([
          insuranceWorkflow.load(selected.record),
          insuranceOperations.load(selected.record),
          insuranceFnol.load(selected.record),
        ]);
      }
    } catch (error) {
      if (epoch !== state.epoch) return;
      state.insuranceError = error;
    } finally {
      if (epoch === state.epoch) {
        state.insuranceLoading = false;
        setBusy(false);
        render();
      }
    }
  }
  async function openInsuranceRecord(recordId) {
    if (state.busy || !discardAllowed()) return;
    const epoch = state.epoch;
    insuranceWorkflow.reset();
    insuranceOperations.reset();
    insuranceFnol.reset();
    state.insurancePanel = 'list';
    state.insuranceForm = null;
    state.insurancePendingWrite = null;
    state.dirty = false;
    setBusy(true);
    try {
      const selected = await readInsuranceRecord(recordId);
      if (epoch !== state.epoch) return;
      state.insuranceRecord = selected;
      await Promise.all([
        insuranceWorkflow.load(selected.record),
        insuranceOperations.load(selected.record),
        insuranceFnol.load(selected.record),
      ]);
      state.insuranceError = null;
    } catch (error) {
      if (epoch !== state.epoch) return;
      state.insuranceRecord = null;
      state.insuranceError = error;
    } finally {
      if (epoch === state.epoch) {
        setBusy(false);
        render();
        $('#insurance-detail-heading')?.focus();
      }
    }
  }
  function renderInsurance() {
    const boundary = hosted()
      ? '<div class="message warning-message"><strong class="notice-title">Shared sandbox insurance workflow</strong>These synthetic operations use the selected tenant’s activated release. They do not create production policies, verified underwriting commitments, received premiums or paid transactions. Customer acceptance is not recorded.</div>'
      : insuranceBoundary;
    if (!canInsurance('read'))
      return `${boundary}<section class="panel"><div class="empty-state"><h2>Insurance access is not granted</h2><p>This session does not have insurance read permission. Configuration and source requirements remain available through their own permissions.</p></div></section>`;
    if (state.insuranceLoading || (!state.insurance && !state.insuranceError))
      return `${boundary}<div class="loading-state" role="status"><span class="spinner" aria-hidden="true"></span>Loading scoped insurance records…</div>`;
    const error = state.insuranceError
      ? `<div class="message error-message" role="alert"><strong class="notice-title">Insurance data unavailable</strong>${escape(state.insuranceError.message)}<p>Use Refresh to retry. Unavailable data is not evidence that a record or runtime product is absent.</p></div>`
      : '';
    if (!state.insurance) return boundary + error;
    const { catalog, records } = state.insurance;
    const products = catalog.policies;
    if (!products.length && !records.length)
      return `${boundary}${error}<section class="panel"><div class="empty-state"><h2>No runtime product registered</h2><p>This authorized workspace, tenant, environment and entity has no registered executable product policy. A source requirements profile does not configure an insurance runtime.</p><p>${hosted() ? 'Use Sandbox setup to activate a compatible executable policy before creating a quote.' : 'Register a versioned synthetic product in the development composition before creating a quote.'}</p></div></section>`;
    const list = `<section class="panel insurance-register"><div class="panel-heading"><div><h2>Quote and policy records</h2><p>${state.insurance.hasMore ? 'Latest ' : ''}${records.length} ${records.length === 1 ? 'record' : 'records'}${state.insurance.hasMore ? ' (more records exist)' : ''} · ${products.length} registered product ${products.length === 1 ? 'version' : 'versions'}</p></div>${insuranceButton('create', 'New quote', 'quote', false, !products.length ? 'disabled data-insurance-unavailable' : '')}</div><div class="panel-body">${records.length ? `<div class="insurance-record-list">${records.map((record) => `<button type="button" class="insurance-record-item ${state.insuranceRecord?.record.id === record.id ? 'selected' : ''}" data-insurance-record="${escape(record.id)}"><span><strong>${escape(record.quote.risk.summary)}</strong><small>${escape(record.id)} · v${record.version}</small></span><span>${badge(record.status)}<strong>${escape(insuranceMoney(record.premiumMinor, record.currency))}</strong></span></button>`).join('')}</div>` : '<div class="empty-state"><h3>No insurance records yet</h3><p>Select a registered product to evaluate a configured risk or retain an external quote. The pricing owner and evidence remain explicit.</p></div>'}</div></section>`;
    return `${boundary}${error}${list}${['create', 'revise', 'configured-service', 'renewal'].includes(state.insurancePanel) ? renderInsuranceQuoteForm() : ''}${state.insuranceRecord ? `<nav class="insurance-record-nav" aria-label="Selected transaction sections"><a href="#insurance-detail-heading">Policy and changes</a><a href="#insurance-approval-title">Review</a><a href="#insurance-documents-title">Documents</a><a href="#insurance-finance-title">Finance</a><a href="#insurance-fnol-title">Loss notices</a></nav>` + renderInsuranceRecord(state.insuranceRecord) + insuranceWorkflow.render() + insuranceOperations.render() + insuranceFnol.render() : ''}${['service', 'configured-cancellation'].includes(state.insurancePanel) ? renderInsuranceServiceForm() : ''}`;
  }
  function insuranceField(
    name,
    label,
    {
      type = 'text',
      value = state.insuranceForm?.[name] ?? '',
      required = true,
      help = '',
      pattern = '',
      full = false,
      readonly = false,
    } = {},
  ) {
    return `<div class="form-field ${full ? 'full-width' : ''}"><label for="insurance-${escape(name)}">${escape(label)}</label><input id="insurance-${escape(name)}" name="${escape(name)}" type="${type}" ${['premiumAmount', 'premiumChange'].includes(name) ? 'inputmode="decimal"' : ''} ${type === 'datetime-local' ? 'step="any"' : ''} value="${escape(value)}" ${required ? 'required' : ''} ${pattern ? `pattern="${escape(pattern)}"` : ''} ${readonly ? 'readonly' : ''} ${help ? `aria-describedby="insurance-${escape(name)}-help"` : ''}>${help ? `<p class="field-help" id="insurance-${escape(name)}-help">${escape(help)}</p>` : ''}</div>`;
  }
  function renderInsuranceQuoteForm() {
    const form = state.insuranceForm;
    const policy = insurancePolicy();
    const revise = state.insurancePanel === 'revise';
    const service = state.insurancePanel === 'configured-service';
    const renewal = state.insurancePanel === 'renewal';
    const permission = canInsurance(service ? 'service' : 'quote');
    const definition = insuranceDefinition();
    if (definition)
      return decisionView.renderForm({
        form,
        definition,
        policy,
        products:
          revise || service
            ? [{ policy }]
            : renewal
              ? state.insurance.catalog.policies.filter(
                  (item) => item.policy.id === state.insuranceRecord.record.productId,
                )
              : state.insurance.catalog.policies,
        busy: state.busy,
        permission,
        evaluation:
          service || renewal ? state.insuranceEvaluation?.evaluation : state.insuranceEvaluation,
        service,
        revise,
        renewal,
        serviceEvaluation: service ? state.insuranceEvaluation : null,
      });
    const productOptions = revise
      ? `<option value="${escape(form.productId + '@' + form.productVersion)}">${escape(form.productId)} · ${escape(form.productVersion)} · retained quote policy</option>`
      : state.insurance.catalog.policies
          .map(
            ({ policy: item }) =>
              `<option value="${escape(item.id + '@' + item.version)}" ${item.id === form.productId && item.version === form.productVersion ? 'selected' : ''}>${escape(item.name)} · ${escape(item.version)} · ${escape(item.currency)}</option>`,
          )
          .join('');
    return `<section class="panel insurance-form-panel"><form id="insurance-quote-form"><div class="panel-heading"><div><h2>${revise ? 'Revise external quote' : 'Create external quote'}</h2><p>Record an externally supplied synthetic decision and premium. This form does not run a rating engine.</p></div></div><div class="panel-body"><fieldset ${!permission || state.busy ? 'disabled' : ''}><legend class="visually-hidden">External quote fields</legend><div class="form-grid"><div class="form-field full-width"><label for="insurance-product">Registered product version</label><select id="insurance-product" name="product" ${revise ? 'disabled' : ''} required>${productOptions}</select></div>${insuranceField('riskSummary', 'Risk description', { full: true, help: 'Use a fictional risk description. Do not enter customer personal or production policy data.' })}${insuranceField('externalRiskReference', 'External risk reference', { required: false })}${insuranceField('sourceReference', 'External quote reference')}${insuranceField('sourceVersion', 'External quote version')}<div class="form-field"><label for="insurance-eligibility">External eligibility decision</label><select id="insurance-eligibility" name="eligibility">${[
      ['quote_ready', 'Quote ready'],
      ['referred', 'Referred'],
      ['declined', 'Declined'],
    ]
      .map(
        ([id, label]) =>
          `<option value="${id}" ${form.eligibility === id ? 'selected' : ''}>${label}</option>`,
      )
      .join(
        '',
      )}</select></div>${insuranceField('startDate', 'Term start', { type: 'date' })}${insuranceField('endDate', 'Term end', { type: 'date' })}${insuranceField('expiresAt', 'Quote expires at (UTC)', { type: 'datetime-local', help: 'Entered time is interpreted as UTC and retained in the quote.' })}${insuranceField('premiumAmount', `Quoted premium (${policy?.currency || state.insuranceRecord?.record.currency || 'currency'})`, { help: policy ? `Enter the external quote amount, for example ${integerToDecimal('50000000', moneyDigits[policy.currency])}. Up to ${moneyDigits[policy.currency]} decimal places; excess precision is rejected. Maximum: ${insuranceMoney(policy.maximumPremiumMinor, policy.currency)}.` : 'Enter the externally quoted currency amount.' })}<div class="form-field full-width"><label for="insurance-evidenceRefs">Source evidence references</label><textarea id="insurance-evidenceRefs" name="evidenceRefs" rows="3" required aria-describedby="insurance-evidence-help">${escape(form.evidenceRefs)}</textarea><p class="field-help" id="insurance-evidence-help">One synthetic evidence identifier per line. Keep source and quote version references reproducible.</p></div></div><div class="insurance-subheading"><div><h3>Capacity participants</h3><p class="field-help">Enter authorized participant identifiers and percentage shares, for example 50.00%. The server validates the total and allocates the quoted premium.</p></div>${insuranceButton('add-participant', 'Add participant', 'quote')}</div><div id="insurance-participants">${form.participants.map((participant, index) => `<div class="insurance-participant" data-participant="${index}"><div class="form-field"><label for="participant-${index}-id">Participant ${index + 1} identifier</label><input id="participant-${index}-id" name="participant-${index}-id" value="${escape(participant.id)}" required></div><div class="form-field"><label for="participant-${index}-role">Participant ${index + 1} role</label><select id="participant-${index}-role" name="participant-${index}-role"><option value="lead" ${participant.role === 'lead' ? 'selected' : ''}>Lead</option><option value="follow" ${participant.role === 'follow' ? 'selected' : ''}>Follow</option></select></div><div class="form-field"><label for="participant-${index}-share">Participant ${index + 1} share (%)</label><input id="participant-${index}-share" name="participant-${index}-share" type="text" inputmode="decimal" value="${escape(participant.sharePercent)}" required></div>${insuranceButton('remove-participant', 'Remove', 'quote', true, `data-participant-index="${index}" ${form.participants.length === 1 ? 'disabled data-insurance-unavailable' : ''}`)}</div>`).join('')}</div></fieldset>${
      policy
        ? `<details class="insurance-trace"><summary>Registered policy and bind gates</summary><dl class="insurance-facts"><div><dt>Product</dt><dd>${escape(policy.id)} · ${escape(policy.version)}</dd></div><div><dt>Effective</dt><dd>${escape(policy.effectiveFrom)} → ${escape(policy.effectiveTo)}</dd></div><div><dt>Maximum participants</dt><dd>${policy.maximumParticipants}</dd></div><div><dt>Configured commission</dt><dd>${escape(basisPoints(policy.commission.rateBps))} of ${escape(titleCase(policy.commission.base))}</dd></div></dl><p class="field-help">Configured gates are enforced by the server: ${Object.entries(
            policy.requirements,
          )
            .map(([key, value]) => `${escape(titleCase(key))}: ${escape(titleCase(value))}`)
            .join(' · ')}.</p></details>`
        : ''
    }</div><div class="form-actions"><span>Saved quote versions and source decisions remain traceable.</span><div class="form-actions-buttons">${insuranceButton('close-form', 'Discard form')}<button type="submit" class="button primary" data-insurance-action="submit-quote" data-insurance-permission="quote" ${!permission || state.busy ? 'disabled' : ''}>${revise ? 'Save quote revision' : 'Create quote'}</button></div></div></form></section>`;
  }
  function renderInsuranceFinancials(financials) {
    if (!financials)
      return '<p class="field-help">Canonical financial allocation is unavailable for this record.</p>';
    return `<div class="insurance-money-summary"><div><span>Total premium</span><strong>${escape(insuranceMoney(financials.premiumMinor, financials.currency))}</strong></div><div><span>Calculated commission · ${escape(basisPoints(financials.commission.rateBps))}</span><strong>${escape(insuranceMoney(financials.commission.amountMinor, financials.currency))}</strong></div></div><div class="insurance-allocation-list">${financials.allocations.map((item) => `<div><span><strong>${escape(item.participantId)}</strong><small>${escape(titleCase(item.role))} · ${escape(basisPoints(item.shareBps))}</small></span><strong>${escape(insuranceMoney(item.premiumMinor, financials.currency))}</strong></div>`).join('')}</div><p class="field-help">Capacity allocations are gross premium shares. Commission is a separate calculated interest, not a deduction, posted ledger or paid amount. Recipient: ${escape(financials.commission.recipientId)}. Settlement party: ${escape(financials.commission.settlementPartyId)}. Cash custody: ${escape(financials.commission.cashCustody)}.</p><details class="insurance-trace"><summary>Calculation trace</summary><dl class="insurance-facts"><div><dt>Calculation version</dt><dd>${escape(financials.calculationVersion)}</dd></div><div><dt>Rounding</dt><dd>${escape(financials.rounding)}</dd></div><div><dt>Allocation method</dt><dd>${escape(financials.allocationMethod)}</dd></div><div><dt>Exact premium minor units</dt><dd><code>${escape(financials.premiumMinor)}</code></dd></div></dl></details>`;
  }
  function sameInsuranceInputMeaning(original, current) {
    if (!original || !current) return false;
    const withoutSources = ({ sourceRefs: _, ...rest }) => rest;
    const meaning = (definition) => ({
      schemaVersion: definition.schemaVersion,
      territories: definition.territories,
      riskFields: definition.riskFields.map(withoutSources),
      riskGroups: (definition.riskGroups || []).map(
        ({ eligibilityRules: _, fields, ...group }) => ({
          ...withoutSources(group),
          fields: fields.map(withoutSources),
        }),
      ),
      coverages: definition.coverages.map(({ rate: _, ...coverage }) => withoutSources(coverage)),
    });
    return JSON.stringify(meaning(original)) === JSON.stringify(meaning(current));
  }

  function renderInsuranceComparison(history, definition) {
    if (history.revisions.length < 2) return '';
    const previous = history.revisions.at(-2),
      current = history.revisions.at(-1);
    const fields = (record) => {
      const input = record.configuredService?.submission ?? record.decision?.submission;
      const result = {
        Status: titleCase(record.status),
        Premium: insuranceMoney(record.premiumMinor, record.currency),
        Commission: insuranceMoney(record.financials.commission.amountMinor, record.currency),
        'Source version': input?.version ?? record.quote.sourceQuote.version,
        'Term start': (input?.term ?? record.quote.term).startDate,
        'Term end': (input?.term ?? record.quote.term).endDate,
        'Effective change': record.lastEffectiveDate || 'None',
      };
      const typedValue = (field, value) =>
        field?.type === 'money'
          ? insuranceMoney(String(value), record.currency)
          : field?.type === 'choice'
            ? `${field.options.find((option) => option.id === value)?.label || value} (${value})`
            : String(value);
      for (const [key, value] of Object.entries(input?.answers || {})) {
        const field = definition?.riskFields.find((item) => item.id === key);
        result[`Risk · ${field?.label || key}`] = typedValue(field, value);
      }
      for (const group of input?.riskGroups || [])
        for (const row of group.rows) {
          result[`${group.groupId} · ${row.rowId}`] = 'Included';
          for (const [key, value] of Object.entries(row.answers)) {
            const field = definition?.riskGroups
              ?.find((item) => item.id === group.groupId)
              ?.fields.find((item) => item.id === key);
            result[`${group.groupId} · ${row.rowId} · ${field?.label || key}`] = typedValue(
              field,
              value,
            );
          }
        }
      for (const coverage of input?.coverages || []) {
        const scope =
          coverage.scope?.kind === 'risk'
            ? `${coverage.scope.groupId} / ${coverage.scope.rowId}`
            : 'Policy';
        result[`${coverage.coverageId} · ${scope}`] =
          `Limit ${insuranceMoney(coverage.limitMinor, record.currency)}; deductible ${insuranceMoney(coverage.deductibleMinor, record.currency)}${coverage.aggregateMinor ? '; aggregate ' + insuranceMoney(coverage.aggregateMinor, record.currency) : ''}${coverage.attachmentMinor ? '; attachment ' + insuranceMoney(coverage.attachmentMinor, record.currency) : ''}`;
      }
      return result;
    };
    const before = fields(previous),
      after = fields(current);
    const changes = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
      (key) => before[key] !== after[key],
    );
    return `<section class="insurance-comparison"><h3>Revision comparison</h3><p class="field-help">Version ${previous.version} → ${current.version}. The table compares retained facts; the decision and financial evidence below determine authority and amounts.</p>${changes.length ? `<div class="finance-table"><table><thead><tr><th scope="col">Changed fact</th><th scope="col">Previous revision</th><th scope="col">Selected revision</th></tr></thead><tbody>${changes.map((key) => `<tr><th scope="row">${escape(key)}</th><td>${escape(before[key] ?? 'Not included')}</td><td>${escape(after[key] ?? 'Not included')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="field-help">No displayed risk, term, status or monetary fact changed. Inspect the immutable history for source and authority evidence.</p>'}</section>`;
  }
  function renderInsuranceRecord({ record, history, definition }) {
    const fact = (label, value) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`;
    return `<section class="panel insurance-record-detail"><div class="panel-heading"><div><h2 id="insurance-detail-heading" tabindex="-1">${escape(record.configuredService?.submission.summary ?? record.quote.risk.summary)}</h2><p>${escape(record.id)} · current revision ${record.version}</p></div>${badge(record.status)}</div><div class="panel-body"><dl class="insurance-facts">${fact('Product', `${record.productId} · ${record.productVersion}`)}${hosted() ? fact('Pinned runtime release', record.runtimeReleaseId || 'Not recorded') : ''}${fact('Source quote', `${record.quote.sourceQuote.reference} · ${record.quote.sourceQuote.version}`)}${fact(record.configuredService ? 'Latest contractual term' : 'Term', `${(record.configuredService?.submission.term ?? record.quote.term).startDate} → ${(record.configuredService?.submission.term ?? record.quote.term).endDate}`)}${fact('Quote expires (UTC)', record.quote.expiresAt.replace('T', ' ').replace('Z', ' UTC'))}${fact(record.decision ? 'Configured decision' : 'External decision', titleCase(record.quote.eligibility))}${fact('Last effective change', record.lastEffectiveDate || 'No servicing change')}</dl>${record.renewal ? `<div class="message success-message">Renewal quote for a separate term. Source policy ${escape(record.renewal.source.recordId)} · version ${record.renewal.source.version}. This quote requires its own review and binding.</div>` : ''}${record.configuredCancellation ? `<div class="message warning-message">Cancellation is retained with effect from ${escape(record.configuredCancellation.effectiveDate)}. Return premium: ${escape(insuranceMoney(record.configuredCancellation.calculation.returnPremiumMinor, record.currency))}. No refund has been requested and no notice has been issued.</div>` : ''}${record.configuredService ? `<div class="message success-message">Contractual change retained with effect from ${escape(record.configuredService.effectiveDate)}. Future-effective changes are scheduled; the original quote remains in the history.</div>${decisionView.renderServiceEvaluation(record.configuredService)}` : ''}${renderInsuranceFinancials(record.financials)}${renderInsuranceComparison(history, definition?.insurance)}${record.approval ? '<div class="message success-message"><strong class="notice-title">Bound using independent human review</strong>The original rule findings below remain unchanged. <a href="#insurance-approval-title">Inspect the retained review and its exact scope.</a></div>' : ''}${record.decision ? decisionView.renderEvaluation(record.approval ? record.decision.evaluation : record.decision.bindEvaluation?.evaluation || record.decision.evaluation, { beforeHumanReview: !!record.approval }) : ''}<div class="insurance-record-actions">${insuranceButton('revise', 'Revise quote', 'quote', true, record.status !== 'quoted' ? 'disabled data-insurance-unavailable' : '')}${record.decision ? insuranceButton('renewal', 'Prepare renewal quote', 'quote', true, record.status !== 'bound' ? 'disabled data-insurance-unavailable' : '') : ''}${insuranceButton('bind', 'Bind selected quote', 'bind', false, record.status !== 'quoted' ? 'disabled data-insurance-unavailable' : '')}${insuranceButton('service', 'Manual policy change', 'service', true, record.status === 'quoted' || record.decision ? 'disabled data-insurance-unavailable' : '')}${record.decision?.submission.schemaVersion === 'insurance-submission-v2' ? insuranceButton('configured-service', 'Change risk or term', 'service', true, record.status !== 'bound' ? 'disabled data-insurance-unavailable' : '') + insuranceButton('configured-cancellation', 'Cancel with configured return', 'service', true, record.status !== 'bound' ? 'disabled data-insurance-unavailable' : '') : ''}</div><p class="field-help">${record.decision ? 'Configured revisions and supported policy changes use the original retained definition. ' : record.status === 'quoted' ? 'Policy changes become available after binding. ' : 'The selected quote has already been bound; use a manual policy change for servicing. '}Commands use this exact revision and quote or record hash. The server checks current state, authority and configured gates before accepting a change.</p><details class="insurance-trace"><summary>Current record and source trace</summary><dl class="insurance-facts">${fact('Record hash', record.recordHash)}${fact('Quote hash', record.quoteHash)}${fact('Product policy hash', record.productPolicyHash)}${fact('Created', date(record.createdAt))}${fact('Updated', date(record.updatedAt))}</dl><pre class="json-output" tabindex="0" aria-label="Current canonical record">${escape(JSON.stringify(record, null, 2))}</pre></details><div class="insurance-subheading"><div><h3>Immutable version history</h3><p class="field-help">Each version retains its original quote, policy state and financial allocation.</p></div><span class="status-count">${history.revisions.length} versions</span></div><div class="insurance-history">${history.revisions.map((revision) => `<details class="insurance-history-item"><summary><span>Version ${revision.version} · ${escape(titleCase(revision.status))}</span><strong>${escape(insuranceMoney(revision.premiumMinor, revision.currency))}</strong></summary><dl class="insurance-facts">${fact('Recorded', date(revision.updatedAt))}${fact('Source quote', `${revision.quote.sourceQuote.reference} · ${revision.quote.sourceQuote.version}`)}${fact('Latest contractual term', `${(revision.configuredService?.submission.term ?? revision.quote.term).startDate} → ${(revision.configuredService?.submission.term ?? revision.quote.term).endDate}`) + fact('Change effective date', revision.lastEffectiveDate || 'No change')}${fact('Record hash', revision.recordHash)}</dl><pre class="json-output" tabindex="0" aria-label="Canonical record version ${revision.version}">${escape(JSON.stringify(revision, null, 2))}</pre></details>`).join('')}</div><details class="insurance-trace"><summary>Event evidence (${history.events.length})</summary><pre class="json-output" tabindex="0" aria-label="Canonical event evidence">${escape(JSON.stringify(history.events, null, 2))}</pre></details></div></section>`;
  }
  function renderInsuranceServiceForm() {
    const form = state.insuranceForm;
    const permission = canInsurance('service');
    if (state.insurancePanel === 'configured-cancellation')
      return renderConfiguredCancellationForm();
    return `<section class="panel insurance-form-panel"><form id="insurance-service-form"><div class="panel-heading"><div><h2>Manual policy change</h2><p>Supply an explicit externally determined adjustment. The server applies the permitted lifecycle transition and allocation.</p></div></div><div class="panel-body"><fieldset ${!permission || state.busy ? 'disabled' : ''}><legend class="visually-hidden">Manual policy change fields</legend><div class="form-grid"><div class="form-field"><label for="insurance-action">Action</label><select id="insurance-action" name="action">${['endorsement', 'cancellation', 'reinstatement'].map((action) => `<option value="${action}" ${form.action === action ? 'selected' : ''}>${titleCase(action)}</option>`).join('')}</select></div>${insuranceField('effectiveDate', 'Effective date', { type: 'date' })}${insuranceField('premiumChange', `Premium change (${state.insuranceRecord.record.currency})`, { help: `Enter a signed currency amount: positive for additional premium, negative for return premium, for example -125.50. Up to ${moneyDigits[state.insuranceRecord.record.currency]} decimal places. No automatic proration or refund payment is performed.` })}${insuranceField('reason', 'Reason and external decision reference', { full: true })}</div></fieldset></div><div class="form-actions"><span>A new version is recorded; prior versions remain unchanged.</span><div class="form-actions-buttons">${insuranceButton('close-form', 'Discard form')}<button type="submit" class="button primary" data-insurance-action="submit-service" data-insurance-permission="service" ${!permission || state.busy ? 'disabled' : ''}>Record policy change</button></div></div></form></section>`;
  }
  function cancellationPayload() {
    const record = state.insuranceRecord.record,
      form = state.insuranceForm;
    return {
      recordId: record.id,
      expectedVersion: record.version,
      recordHash: record.recordHash,
      effectiveDate: form.effectiveDate,
      reason: form.reason.trim(),
      evidenceRefs: String(form.evidenceRefs || '')
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean),
    };
  }
  function renderConfiguredCancellationForm() {
    const preview = state.insuranceEvaluation,
      record = state.insuranceRecord.record;
    const permission = canInsurance('service');
    const calculation = preview?.calculation;
    return `<section class="panel insurance-form-panel"><form id="insurance-service-form"><div class="panel-heading"><div><h2>Configured cancellation</h2><p>Preview the explicit retained return-premium rule before recording cessation of cover.</p></div></div><div class="panel-body"><fieldset ${!permission || state.busy ? 'disabled' : ''}><legend class="visually-hidden">Cancellation evidence</legend><div class="form-grid">${insuranceField('effectiveDate', 'Cancellation effective date', { type: 'date' })}${insuranceField('reason', 'Reason for cancellation', { full: true })}<div class="form-field full-width"><label for="insurance-evidenceRefs">Cancellation evidence references</label><textarea id="insurance-evidenceRefs" name="evidenceRefs" required>${escape(state.insuranceForm.evidenceRefs || '')}</textarea></div></div></fieldset><p class="field-help">Future-effective cancellation is scheduled cessation. This command does not pay a refund or send a notice. Products without an explicit supported cancellation rule remain blocked.</p></div><div class="form-actions"><div class="form-actions-buttons">${insuranceButton('close-form', 'Discard form')}${insuranceButton('evaluate-cancellation', 'Preview cancellation', 'read')}<button type="submit" class="button primary" data-insurance-action="submit-configured-cancellation" data-insurance-permission="service" ${!permission || state.busy || preview?.status !== 'allowed' ? 'disabled data-insurance-unavailable' : ''}>Record configured cancellation</button></div></div></form>${preview ? `<section class="panel-body cancellation-preview"><h3>Cancellation preview · ${escape(titleCase(preview.status))}</h3>${preview.reasons.length ? `<ul>${preview.reasons.map((reason) => `<li>${escape(reason)}</li>`).join('')}</ul>` : ''}${calculation ? `<dl class="insurance-facts"><div><dt>Return premium</dt><dd>${escape(insuranceMoney(calculation.returnPremiumMinor, record.currency))}</dd></div><div><dt>Retained cumulative premium</dt><dd>${escape(insuranceMoney(calculation.resultingPremiumMinor, record.currency))}</dd></div><div><dt>Remaining days</dt><dd>${calculation.remainingDays} of ${calculation.termDays}</dd></div><div><dt>Calculation</dt><dd>${escape(titleCase(calculation.method))}</dd></div></dl>` : ''}<details><summary>Exact cancellation evidence</summary><pre class="json-output">${escape(JSON.stringify(preview, null, 2))}</pre></details></section>` : ''}</section>`;
  }
  function invalidateInsuranceEvaluation() {
    state.insuranceEvaluation = null;
    const formPanel = document.querySelector('.insurance-form-panel');
    formPanel?.querySelector('.decision-result')?.remove();
    formPanel?.querySelector('.decision-service-result')?.remove();
    formPanel?.querySelector('.cancellation-preview')?.remove();
    if (insuranceDefinition()) {
      const submit = document.querySelector(
        '[data-insurance-action="submit-quote"], [data-insurance-action="submit-configured-service"], [data-insurance-action="submit-configured-cancellation"], [data-insurance-action="submit-renewal"]',
      );
      if (submit) {
        submit.disabled = true;
        submit.setAttribute('data-insurance-unavailable', '');
      }
    }
  }
  function captureInsuranceForm() {
    const element = $('#insurance-quote-form') || $('#insurance-service-form');
    if (!element || !state.insuranceForm) return;
    const data = new FormData(element);
    const form = state.insuranceForm;
    const definition = insuranceDefinition();
    if (definition) decisionView.capture(form, definition, element);
    for (const key of [
      'riskSummary',
      'externalRiskReference',
      'sourceReference',
      'sourceVersion',
      'eligibility',
      'startDate',
      'endDate',
      'expiresAt',
      'premiumAmount',
      'evidenceRefs',
      'action',
      'effectiveDate',
      'premiumChange',
      'reason',
    ])
      if (data.has(key)) form[key] = String(data.get(key));
    if (element.id === 'insurance-quote-form' && state.insurancePanel !== 'configured-service')
      form.participants = form.participants.map((_, index) => ({
        id: String(data.get(`participant-${index}-id`) || ''),
        role: String(data.get(`participant-${index}-role`) || 'follow'),
        sharePercent: String(data.get(`participant-${index}-share`) || ''),
      }));
  }
  async function startInsuranceForm(mode) {
    if (!discardAllowed()) return;
    const record = state.insuranceRecord?.record;
    const firstPolicy = (
      mode === 'renewal'
        ? state.insurance.catalog.policies.find(
            (item) => item.policy.id === record?.productId && item.insurance,
          )
        : state.insurance.catalog.policies[0]
    )?.policy;
    if (mode === 'renewal' && !firstPolicy) {
      notify(
        'No active configured version of this product is available for a new term.',
        'warning',
      );
      return;
    }
    if (mode !== 'create' && !record) return;
    if (mode === 'create' && !firstPolicy) return;
    state.insuranceRetainedDefinition = null;
    if (record?.decision && !['create', 'renewal'].includes(mode)) {
      const epoch = state.epoch;
      setBusy(true);
      try {
        const retained = await api(
          `/api/insurance/record-definition?recordId=${encodeURIComponent(record.id)}`,
        );
        if (epoch !== state.epoch) return;
        if (
          retained.policyHash !== record.productPolicyHash ||
          retained.definitionHash !== record.decision.evaluation.definitionHash ||
          retained.runtimeReleaseId !== record.runtimeReleaseId
        )
          throw new Error(
            'The retained product does not match the selected record. Refresh the policy before continuing.',
          );
        state.insuranceRetainedDefinition = retained;
      } catch (error) {
        showError(error, 'The retained product definition could not be loaded.');
        return;
      } finally {
        if (epoch === state.epoch) setBusy(false);
      }
    }

    insuranceWorkflow.discardDraft();
    insuranceOperations.discardDraft();
    insuranceFnol.discardDraft();
    if (mode === 'create') state.insuranceRecord = null;
    state.insuranceEvaluation = null;
    state.insurancePanel = mode;
    state.insurancePendingWrite = null;
    state.dirty = false;
    if (['service', 'configured-cancellation'].includes(mode))
      state.insuranceForm = {
        action: 'endorsement',
        effectiveDate: '',
        premiumChange: '',
        reason: '',
      };
    else {
      const quote = ['revise', 'configured-service', 'renewal'].includes(mode)
        ? record.quote
        : null;
      state.insuranceForm = {
        answers: {},
        coverages: {},
        territory: '',
        productId: quote ? record.productId : firstPolicy.id,
        productVersion: quote && mode !== 'renewal' ? record.productVersion : firstPolicy.version,
        riskSummary: quote?.risk.summary || '',
        externalRiskReference: quote?.risk.externalRiskReference || '',
        sourceReference: quote?.sourceQuote.reference || '',
        sourceVersion: quote?.sourceQuote.version || '',
        eligibility: quote?.eligibility || 'quote_ready',
        startDate: quote?.term.startDate || '',
        endDate: quote?.term.endDate || '',
        expiresAt: quote?.expiresAt ? quote.expiresAt.replace(/Z$/, '') : '',
        premiumAmount: quote
          ? integerToDecimal(quote.premiumMinor, moneyDigits[record.currency])
          : '',
        evidenceRefs: quote?.sourceQuote.evidenceRefs.join('\n') || '',
        participants: quote
          ? quote.participants.map((item) => ({
              id: item.id,
              role: item.role,
              sharePercent: integerToDecimal(item.shareBps, 2),
            }))
          : [{ id: '', role: 'lead', sharePercent: '' }],
      };
    }
    if (record?.decision && ['revise', 'configured-service'].includes(mode)) {
      decisionView.seedFromSubmission(
        state.insuranceForm,
        state.insuranceRetainedDefinition.insurance,
        record.configuredService?.submission ?? record.decision.submission,
        record.currency,
      );
      state.insuranceForm.mode = mode;
      state.insuranceForm.effectiveDate = '';
      state.insuranceForm.serviceReason = '';
    }
    if (mode === 'renewal') {
      const active = state.insurance.catalog.policies.find(
        (item) => item.policy.id === firstPolicy.id && item.policy.version === firstPolicy.version,
      );
      if (
        firstPolicy.currency === record.currency &&
        sameInsuranceInputMeaning(state.insuranceRecord?.definition?.insurance, active?.insurance)
      )
        decisionView.seedFromSubmission(
          state.insuranceForm,
          insuranceDefinition(),
          record.configuredService?.submission ?? record.decision.submission,
          firstPolicy.currency,
        );
      else {
        Object.assign(state.insuranceForm, {
          answers: {},
          riskGroups: [],
          coverages: {},
          territory: '',
          premiumAmount: '',
        });
        notify(
          'The active product definition changed. Enter risk answers and selected coverage terms again; the original policy remains available for comparison.',
          'warning',
        );
      }
      Object.assign(state.insuranceForm, {
        mode,
        sourceReference: '',
        sourceVersion: '',
        startDate: '',
        endDate: '',
        expiresAt: '',
        evidenceRefs: '',
      });
    }
    render();
    $('.insurance-form-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    $('.insurance-form-panel input')?.focus({ preventScroll: true });
  }
  async function executeInsuranceWrite(path, method, payload) {
    if (state.busy) return;
    const epoch = state.epoch;
    const pendingPayload = state.insurancePendingWrite
      ? (({ idempotencyKey, ...body }) => body)(state.insurancePendingWrite.body)
      : null;
    if (
      state.insurancePendingWrite &&
      (path !== state.insurancePendingWrite.path ||
        method !== state.insurancePendingWrite.method ||
        JSON.stringify(payload) !== JSON.stringify(pendingPayload))
    ) {
      notify(
        'A previous command has an uncertain result. Retry that same command, or refresh and inspect persisted history before preparing another change.',
        'warning',
      );
      return;
    }
    if (!state.insurancePendingWrite)
      state.insurancePendingWrite = {
        path,
        method,
        body: { ...payload, idempotencyKey: crypto.randomUUID() },
      };
    const pending = state.insurancePendingWrite;
    setBusy(true);
    $('#notification').hidden = true;
    try {
      const result = await api(pending.path, {
        method: pending.method,
        body: JSON.stringify(pending.body),
      });
      state.insurancePendingWrite = null;
      state.dirty = false;
      state.insurancePanel = 'list';
      state.insuranceForm = null;
      state.insuranceRecord = null;
      await loadInsurance(result.record.id);
      if (state.insuranceError)
        notify(
          `The command saved record ${result.record.id} as version ${result.record.version}, but its refreshed view is unavailable. Use Refresh to retrieve persisted history.`,
          'warning',
        );
      else
        notify(
          `Synthetic record saved · version ${result.record.version}. Original versions remain in history.`,
        );
    } catch (error) {
      if (epoch !== state.epoch) return;
      if (error.status && error.status < 500) state.insurancePendingWrite = null;
      else state.dirty = true;
      showError(
        error,
        error.code === 'VERSION_CONFLICT'
          ? 'The selected record or quote is stale. Your form is preserved; refresh the record before preparing a new change.'
          : error.status && error.status < 500
            ? 'The command was not accepted.'
            : 'The result is uncertain. Retry without changing the form to reuse the same request.',
      );
    } finally {
      if (epoch === state.epoch) setBusy(false);
    }
  }
  async function submitInsuranceQuote() {
    if (!canInsurance('quote') || state.busy) return;
    captureInsuranceForm();
    const form = state.insuranceForm;
    const definition = insuranceDefinition();
    if (definition) {
      if (!state.insuranceEvaluation)
        throw new Error('Evaluate this risk before retaining the quote.');
      if (state.insurancePanel === 'renewal') {
        await executeInsuranceWrite('/api/insurance/renewal-quotes', 'POST', {
          ...renewalPayload(decisionView.submission(form, definition, insurancePolicy().currency)),
          participants: form.participants.map((item) => ({
            id: item.id.trim(),
            role: item.role,
            shareBps: percentToBasisPoints(item.sharePercent, 'Participant share'),
          })),
          expectedRenewalHash: state.insuranceEvaluation.renewalHash,
        });
        return;
      }
      const record = state.insuranceRecord?.record;
      const revise = state.insurancePanel === 'revise';
      await executeInsuranceWrite('/api/insurance/configured-quotes', revise ? 'PUT' : 'POST', {
        ...(revise
          ? { recordId: record.id, expectedVersion: record.version, recordHash: record.recordHash }
          : { productId: form.productId, productVersion: form.productVersion }),
        submission: decisionView.submission(form, definition, insurancePolicy().currency),
        participants: form.participants.map((item) => ({
          id: item.id.trim(),
          role: item.role,
          shareBps: percentToBasisPoints(item.sharePercent, 'Participant share'),
        })),
        expectedEvaluationHash: state.insuranceEvaluation.evaluationHash,
      });
      return;
    }
    const quote = {
      sourceQuote: {
        reference: form.sourceReference.trim(),
        version: form.sourceVersion.trim(),
        evidenceRefs: form.evidenceRefs
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      },
      risk: {
        summary: form.riskSummary.trim(),
        externalRiskReference: form.externalRiskReference.trim() || null,
      },
      term: { startDate: form.startDate, endDate: form.endDate },
      expiresAt: new Date(form.expiresAt + 'Z').toISOString(),
      eligibility: form.eligibility,
      premiumMinor: decimalToInteger(
        form.premiumAmount,
        moneyDigits[
          state.insurancePanel === 'revise'
            ? state.insuranceRecord.record.currency
            : insurancePolicy().currency
        ],
        'Quoted premium',
      ),
      participants: form.participants.map((item) => ({
        id: item.id.trim(),
        role: item.role,
        shareBps: percentToBasisPoints(item.sharePercent, `Participant ${item.id || 'share'}`),
      })),
    };
    if (state.insurancePanel === 'revise') {
      const record = state.insuranceRecord.record;
      await executeInsuranceWrite('/api/insurance/quotes', 'PUT', {
        recordId: record.id,
        expectedVersion: record.version,
        recordHash: record.recordHash,
        quote,
      });
    } else
      await executeInsuranceWrite('/api/insurance/quotes', 'POST', {
        productId: form.productId,
        productVersion: form.productVersion,
        quote,
      });
  }
  function renewalPayload(submission) {
    const source = state.insuranceRecord.record;
    return {
      sourceRecordId: source.id,
      sourceVersion: source.version,
      sourceRecordHash: source.recordHash,
      productId: state.insuranceForm.productId,
      productVersion: state.insuranceForm.productVersion,
      submission,
    };
  }
  function configuredServicePayload(submission) {
    const record = state.insuranceRecord.record;
    return {
      recordId: record.id,
      expectedVersion: record.version,
      recordHash: record.recordHash,
      submission,
      effectiveDate: state.insuranceForm.effectiveDate,
      reason: state.insuranceForm.serviceReason.trim(),
      evidenceRefs: state.insuranceForm.evidenceRefs
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean),
    };
  }
  async function submitConfiguredService() {
    if (!canInsurance('service') || state.busy) return;
    captureInsuranceForm();
    if (state.insuranceEvaluation?.status !== 'allowed')
      throw new Error('Preview an allowed change before recording it.');
    await executeInsuranceWrite('/api/insurance/configured-service', 'POST', {
      ...configuredServicePayload(
        decisionView.submission(
          state.insuranceForm,
          insuranceDefinition(),
          insurancePolicy().currency,
        ),
      ),
      expectedEvaluationHash: state.insuranceEvaluation.evaluationHash,
    });
  }
  async function submitInsuranceService() {
    if (!canInsurance('service') || state.busy) return;
    captureInsuranceForm();
    const form = state.insuranceForm;
    const record = state.insuranceRecord.record;
    if (state.insurancePanel === 'configured-cancellation') {
      if (state.insuranceEvaluation?.status !== 'allowed')
        throw new Error('Preview an allowed cancellation before committing it.');
      await executeInsuranceWrite('/api/insurance/configured-cancellation', 'POST', {
        ...cancellationPayload(),
        expectedEvaluationHash: state.insuranceEvaluation.evaluationHash,
      });
      return;
    }
    await executeInsuranceWrite('/api/insurance/service', 'POST', {
      recordId: record.id,
      expectedVersion: record.version,
      recordHash: record.recordHash,
      action: form.action,
      premiumDeltaMinor: decimalToInteger(
        form.premiumChange,
        moneyDigits[record.currency],
        'Premium change',
        true,
      ),
      effectiveDate: form.effectiveDate,
      reason: form.reason.trim(),
    });
  }

  function renderRequirements() {
    if (state.requirementsLoading || (!state.requirements && !state.requirementsError))
      return '<div class="loading-state" role="status"><span class="spinner" aria-hidden="true"></span>Loading source requirements…</div>';
    if (state.requirementsError)
      return `<div class="message error-message" role="alert"><strong class="notice-title">Source requirements unavailable</strong>${escape(state.requirementsError)}<p>Source coverage is unavailable until this request succeeds. Use Refresh to try again.</p></div>`;
    const report = state.requirements;
    if (report.sourceStatus === 'source_not_attached')
      return '<section class="panel"><div class="empty-state"><h2>No source profile attached</h2><p>No journey requirements package is attached to this authorized workspace, tenant, environment and entity. Source coverage is unavailable.</p><p>Insurance runtime evidence is pending. Customer acceptance is not recorded.</p></div></section>';
    const profile = report.profile;
    const sourceName = (id) => profile.sources.find((source) => source.id === id)?.title || id;
    return `<div class="message warning-message"><strong class="notice-title">Delivery scope · evidence pending</strong>Insurance runtime evidence is pending. Customer acceptance is not recorded. These requirements describe expected outcomes and source boundaries; they do not establish working insurance journeys.</div><section class="panel wide-panel"><div class="panel-heading"><div><h2>${escape(profile.title)}</h2><p>${profile.requirements.length} ${profile.requirements.length === 1 ? 'requirement' : 'requirements'} · ${profile.sources.length} ${hosted() ? 'source references' : profile.sources.length === 1 ? 'source capture' : 'source captures'} · Profile version ${escape(profile.version)}</p></div></div><div class="panel-body"><p class="field-help">This versioned source package is independent of draft and published configuration.</p><p class="requirement-hash">Source profile hash <code>${escape(report.sourceProfileHash)}</code></p></div></section><section class="journey-requirements-list" aria-label="Source requirements">${profile.requirements.map((requirement) => `<article class="panel requirement-card"><div class="requirement-heading"><span class="code-chip">${escape(requirement.id)}</span>${badge(requirement.priority)}</div><h3>${escape(requirement.title)}</h3><p>${escape(requirement.expectedOutcome)}</p><div class="requirement-categories" aria-label="Related configuration categories">${requirement.categories.map((id) => `<button type="button" class="button secondary small" data-page="${escape(id)}">${escape(categoryName(id))}</button>`).join('')}</div><details class="requirement-details"><summary>Source boundaries and open inputs</summary><p>${escape(requirement.sourceBoundary)}</p><h4>Source references</h4><ul>${requirement.sourceRefs.map((reference) => `<li>${escape(sourceName(reference.sourceId))} · ${escape(reference.locator)}</li>`).join('')}</ul><h4>Declared dependencies</h4>${requirement.dependencies.length ? `<ul>${requirement.dependencies.map((dependency) => `<li>${escape(dependency)}</li>`).join('')}</ul>` : '<p>No dependency was declared in this mapping. This does not certify that all inputs are available.</p>'}</details></article>`).join('')}</section><section class="panel wide-panel"><div class="panel-heading"><div><h2>${hosted() ? 'Declared source references' : 'Source captures'}</h2><p>${hosted() ? 'The requirements package is retained and hashed by the server. Submitted document locations, capture timestamps and source checksums remain unverified claims.' : 'Hashes identify the captured source evidence; source statements do not certify implementation or approval.'}</p></div></div><div class="panel-body">${profile.sources.map((source) => `<details class="requirement-details source-capture"><summary>${escape(source.title)}</summary><dl class="requirement-source-facts"><dt>Source version</dt><dd>${escape(source.version || 'Not specified in source')}</dd><dt>Captured</dt><dd>${escape(date(source.capturedAt))}</dd><dt>Location</dt><dd>${sourceLocation(source)}</dd><dt>${hosted() ? 'Submitted SHA-256 (unverified)' : 'SHA-256'}</dt><dd><code>${escape(source.sha256)}</code></dd><dt>Source boundary</dt><dd>${escape(source.sourceBoundary)}</dd></dl></details>`).join('')}</div></section>`;
  }

  function renderUnavailableReport() {
    return `${snapshotMeta()}<div class="message warning-message" role="status"><strong class="notice-title">Validation report unavailable</strong>The ${escape(state.view)} definition below is version ${state.snapshot.version}. Its matching gap report could not be loaded. Metadata validity and gap counts are unavailable until a consistent report can be retrieved.<br><button type="button" class="button secondary small" data-reload-conflict>Refresh definition and report</button></div><section class="panel wide-panel"><div class="panel-heading"><div><h2>${escape(titleCase(state.view))} definition · v${state.snapshot.version}</h2><p>This snapshot is available for inspection. Production readiness is unavailable.</p></div></div><div class="panel-body"><pre class="json-output" tabindex="0" aria-label="Available configuration snapshot">${escape(JSON.stringify(state.snapshot.configuration, null, 2))}</pre></div></section>`;
  }

  function snapshotMeta() {
    const snapshot = state.snapshot;
    return `<div class="snapshot-meta"><span><strong>${titleCase(state.view)} v${snapshot.version}</strong></span><span>Updated ${escape(date(snapshot.updatedAt))}</span><span>Hash <code title="${escape(snapshot.hash)}">${escape(snapshot.hash.slice(0, 12))}</code></span>${snapshot.releaseId ? `<span>Release <strong>${escape(snapshot.releaseId)}</strong></span>` : '<span>No release assigned</span>'}${snapshot.effectiveAt ? `<span>Effective ${escape(date(snapshot.effectiveAt))}</span>` : ''}</div>`;
  }

  function renderOverview() {
    const categories = state.catalog.categories;
    const complete = categories.filter((item) => item.support === 'complete').length;
    const partial = categories.filter((item) => item.support === 'partial').length;
    const blockers = state.report.gaps.filter((gap) => gap.severity === 'blocker').length;
    const definitionValid = state.report.definitionValid;
    const displayed = categories.slice(0, 6);
    return `<section class="definition-banner" aria-label="Configuration scope"><div><div class="eyebrow">YOUR CONFIGURATION, IN FOCUS</div><h2>A foundation you can inspect and improve.</h2><p>Explore the supported definitions, make a scoped draft change, and understand what still needs configuration or engineering.</p></div><div class="banner-status"><span class="status-caption">PRODUCTION READINESS</span><div class="readiness-unavailable"><span aria-hidden="true"></span>Unavailable in this release</div><p class="field-help">Metadata validation does not certify production readiness.</p></div></section><section class="metrics-grid" aria-label="Configuration summary">${metric('Definition metadata', definitionValid ? 'Valid' : 'Needs attention', definitionValid ? 'Within the implemented metadata checks' : 'Review configuration validation gaps', 'valid', definitionValid ? 'teal' : 'amber')}${metric('Capability coverage', `${complete}<small>/ ${categories.length}</small>`, `${partial} partial · ${categories.length - complete - partial} other support states`, 'overview', '', true)}${metric('Open gaps', String(state.report.gaps.length), `${blockers} ${blockers === 1 ? 'blocker' : 'blockers'} identified in this view`, 'gap', state.report.gaps.length ? 'amber' : 'teal')}${metric(`${titleCase(state.view)} version`, `v${state.snapshot.version}`, `Contract ${state.catalog.contractVersion} · ${titleCase(state.context.environment)}`, 'version')}</section>${snapshotMeta()}<section aria-labelledby="categories-heading"><div class="section-heading"><div><h2 id="categories-heading">Configuration categories</h2><p>Inspect definition metadata and the implementation status of each capability.</p></div><button type="button" class="text-button" data-all-categories>View all ${categories.length} <span aria-hidden="true">↗</span></button></div><div class="category-grid" id="category-grid">${displayed.map(categoryCard).join('')}</div><p class="category-list-note" id="category-list-note">Showing ${displayed.length} of ${categories.length} categories. All categories are available in the navigation.</p></section>${gapSection()}`;
  }

  function metric(label, value, description, symbol, color = '', raw = false) {
    const long = String(value).length > 14 && !raw;
    return `<div class="panel metric-card"><div class="metric-top"><span>${escape(label)}</span><span class="nav-icon">${icon(symbol)}</span></div><div class="metric-value ${color} ${long ? 'metric-long' : ''}">${raw ? value : escape(value)}</div><p class="metric-bottom">${escape(description)}</p></div>`;
  }

  function categoryCard(item) {
    const gaps = state.report.gaps.filter((gap) => gap.category === item.id).length;
    return `<button type="button" class="panel category-card" data-page="${escape(item.id)}"><span class="category-card-top"><span class="category-symbol">${icon(item.id)}</span>${badge(item.support)}</span><h3>${escape(item.name)}</h3><p>${escape(item.description)}</p><span class="category-card-footer"><span class="surface-label" aria-label="Available surfaces">${Object.entries(
      item.surfaces,
    )
      .map(
        ([key, value]) =>
          `<b class="surface-${value ? 'enabled' : 'disabled'}" title="${key.toUpperCase()}: ${value ? 'Available for the documented scope' : 'Not available'}">${key.toUpperCase()} ${value ? '✓' : '—'}</b>`,
      )
      .join(
        '<span aria-hidden="true">·</span>',
      )}</span><span>${gaps} ${gaps === 1 ? 'gap' : 'gaps'} <span aria-hidden="true">↗</span></span></span></button>`;
  }

  function renderCategory(item) {
    const supported = Object.hasOwn(state.snapshot.configuration, item.id);
    return `${snapshotMeta()}<div class="category-detail-header"><span class="category-symbol">${icon(item.id)}</span><div><h2>${escape(item.name)} definition</h2><p>Current ${escape(state.view)} metadata within your authorized tenant and operating entity scope.</p></div>${badge(item.support)}</div><div class="detail-layout"><section class="panel">${supported ? `<div class="definition-tabs" role="group" aria-label="Definition view"><button type="button" data-tab="inspect" aria-pressed="${state.tab === 'inspect'}">${item.id === 'tenant' ? 'Tenant profile' : item.id === 'products' ? 'Insurance products' : 'Inspect fields'}</button><button type="button" data-tab="json" aria-pressed="${state.tab === 'json'}">Definition JSON</button></div>${state.tab === 'json' ? jsonEditor() : item.id === 'tenant' ? tenantForm() : item.id === 'products' ? insuranceEditor.render() : definitionInspector(item.id)}` : `<div class="unsupported-note">${badge(item.support, `${titleCase(item.support)} capability`)}<h3>This capability needs ${item.support === 'unknown' ? 'discovery' : 'further implementation'}.</h3><p>${escape(item.description)}</p><p>No configuration editor or executable insurance journey is available for this category. The gaps below describe the current state, required work, and responsible owner.</p></div>`}</section>${categoryFacts(item)}</div><div class="read-only-note"><strong>Validation scope:</strong> ${escape(state.report.validationScope)}. Production readiness is unavailable. ${item.simulation ? 'Simulation is reported as available by the capability catalog.' : 'Simulation is not implemented for this category.'}</div>${gapSection()}`;
  }

  function categoryFacts(item) {
    return `<aside class="panel detail-facts" aria-label="Capability details"><h3>Capability details</h3><dl><div class="fact-row"><dt>Owner</dt><dd>${escape(item.owner)}</dd></div><div class="fact-row"><dt>Milestone</dt><dd>${escape(item.milestone)}</dd></div><div class="fact-row"><dt>Requirement references</dt><dd class="requirements-list">${item.requirementIds.map((id) => `<span class="code-chip">${escape(id)}</span>`).join('') || 'No references supplied'}</dd></div><div class="fact-row"><dt>Available surfaces</dt><dd>${
      Object.entries(item.surfaces)
        .filter(([, value]) => value)
        .map(([key]) => key.toUpperCase())
        .join(' · ') || 'No implemented surfaces'
    }</dd></div><div class="fact-row"><dt>Validation</dt><dd>${item.validation ? 'Metadata checks available' : 'Not implemented'}</dd></div><div class="fact-row"><dt>Simulation</dt><dd>${item.simulation ? 'Available' : 'Not implemented'}</dd></div><div class="fact-row"><dt>Contract</dt><dd>${escape(state.catalog.contractVersion)}</dd></div></dl></aside>`;
  }

  function tenantForm() {
    const tenant = state.snapshot.configuration.tenant || {};
    const readonly = !canWrite();
    const disabled = readonly ? 'disabled' : '';
    const input = (name, label, { pattern = '', max = '', placeholder = '', full = false } = {}) =>
      `<div class="form-field ${full ? 'full-width' : ''}"><label for="tenant-${name}">${label}</label><input id="tenant-${name}" name="${name}" value="${escape(tenant[name] || '')}" required ${disabled} ${pattern ? `pattern="${pattern}"` : ''} ${max ? `maxlength="${max}"` : ''} placeholder="${placeholder}" autocomplete="off"></div>`;
    return `<form id="tenant-form"><div class="panel-heading"><div><h2>Tenant profile</h2><p>Set the identity and regional defaults for this tenant definition.</p></div><span class="metadata-badge">METADATA</span></div><div class="panel-body">${readonly ? `<div class="read-only-note"><strong>Read-only ${state.view}.</strong> ${state.view === 'published' ? 'The published definition is immutable. Switch to Draft to make a change.' : 'Your session does not have configuration write permission.'}</div>` : ''}${!state.snapshot.configuration.tenant ? '<div class="read-only-note">No tenant profile is configured. Complete the required fields to create one in the draft.</div>' : ''}<div class="form-grid">${input('displayName', 'Tenant display name', { max: 200, placeholder: 'Your tenant name', full: true })}${input('locale', 'Locale', { pattern: '[a-z]{2}(-[A-Z]{2})?', placeholder: 'en-GB' })}${input('currency', 'Currency', { pattern: '[A-Z]{3}', max: 3, placeholder: 'GBP' })}${input('timeZone', 'Time zone', { max: 100, placeholder: 'Europe/London' })}<div class="form-field"><label for="tenant-residency">Data residency region</label><select id="tenant-residency" name="residency" required ${disabled}><option value="">Select a region</option>${[
      ['eu', 'European Union'],
      ['uk', 'United Kingdom'],
      ['us', 'United States'],
      ['au', 'Australia'],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}" ${tenant.residency === value ? 'selected' : ''}>${label}</option>`,
      )
      .join(
        '',
      )}</select></div></div><p class="field-help">Locale uses a language code such as en-GB. Currency uses three uppercase letters. These are definition values; they do not provision services or enforce residency.</p></div><div class="form-actions"><span id="edit-status">${readonly ? 'Inspection only' : 'Changes are saved to the current draft.'}</span><div class="form-actions-buttons"><button type="button" class="button secondary" data-reset ${disabled}>Discard changes</button><button type="submit" class="button primary" data-save ${disabled}>Save draft <span aria-hidden="true">↗</span></button></div></div></form>`;
  }

  function jsonEditor() {
    return `<form id="json-form"><div class="panel-heading"><div><h2>Full configuration definition</h2><p>Expert editor for the complete configuration aggregate, including related categories.</p></div><span class="metadata-badge">JSON</span></div><div class="panel-body"><div class="read-only-note">${canWrite() ? 'Saving replaces the draft definition with these values. Unknown fields and unsupported aggregate structures are rejected by the contract.' : `This ${escape(state.view)} definition is read-only for your current session.`}</div><label class="definition-json-label" for="configuration-json">Configuration JSON · contract ${escape(state.catalog.contractVersion)}</label><textarea id="configuration-json" class="json-editor" spellcheck="false" ${canWrite() ? '' : 'readonly'}>${escape(JSON.stringify(state.snapshot.configuration, null, 2))}</textarea></div><div class="form-actions"><span id="edit-status">${canWrite() ? 'Validated by the server when you save.' : 'Inspection only'}</span><div class="form-actions-buttons"><button type="button" class="button secondary" data-reset ${canWrite() ? '' : 'disabled'}>Discard changes</button><button type="submit" class="button primary" data-save ${canWrite() ? '' : 'disabled'}>Save draft <span aria-hidden="true">↗</span></button></div></div></form>`;
  }

  function definitionInspector(id) {
    const values = state.snapshot.configuration[id];
    return `<div class="panel-heading"><div><h2>Definition records</h2><p>Inspect the existing schema fields and their configured values.</p></div><span class="status-count"><strong>${values.length}</strong> records</span></div><div class="panel-body"><div class="read-only-note">These are configuration definitions. Registered synthetic insurance operations are available separately in the Insurance workspace; these definitions do not execute integrations or process transitions. ${canWrite() ? 'Use Definition JSON to edit the supported fields.' : ''}</div>${values.length ? values.map((record) => definitionRecord(id, record)).join('') : '<div class="empty-state"><span class="empty-symbol" aria-hidden="true">◇</span><h3>No definition records</h3><p>This category has no records in the current view. Review its gaps to understand what is required.</p></div>'}</div>`;
  }

  function definitionRecord(id, record) {
    const ordinary = Object.entries(record).filter(
      ([key]) => !['name', 'fields', 'stages', 'transitions'].includes(key),
    );
    const fields = (keys, rows) =>
      `<div class="table-wrap"><table class="field-table"><thead><tr>${keys.map((key) => `<th scope="col">${escape(titleCase(key))}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${keys.map((key) => `<td>${escape(typeof row[key] === 'boolean' ? (row[key] ? 'Yes' : 'No') : row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    return `<article class="definition-record"><div class="record-heading"><strong>${escape(record.name || record.id)}</strong>${record.version ? `<span class="code-chip">v${escape(record.version)}</span>` : ''}</div><div class="record-fields"><dl>${ordinary.map(([key, value]) => `<dt>${escape(titleCase(key))}</dt><dd>${escape(Array.isArray(value) ? value.join(', ') || 'None configured' : value)}</dd>`).join('')}</dl></div>${record.fields ? `<h3 class="record-subheading">Product fields</h3>${record.fields.length ? fields(['id', 'label', 'type', 'required'], record.fields) : '<p class="field-help">No product fields configured.</p>'}` : ''}${record.stages ? `<h3 class="record-subheading">Process stages</h3>${record.stages.length ? fields(['id', 'label', 'terminal'], record.stages) : '<p class="field-help">No stages configured.</p>'}` : ''}${record.transitions ? `<h3 class="record-subheading">Transition definitions</h3>${record.transitions.length ? fields(['from', 'to', 'command'], record.transitions) : '<p class="field-help">No transitions configured.</p>'}` : ''}</article>`;
  }

  function gapSection() {
    return `<section class="gap-section" aria-labelledby="gaps-heading"><div class="section-heading"><div><h2 id="gaps-heading">${state.page === 'overview' ? 'Gap inventory' : `${escape(categoryName(state.page))} gaps`}</h2><p>Current state, required work, and ownership. Select a gap for the full context.</p></div><span class="status-count">${badge(state.report.definitionValid ? 'valid' : 'invalid', state.report.definitionValid ? 'Metadata valid' : 'Metadata needs attention')}</span></div><div class="panel"><div class="gap-toolbar"><span class="gap-count" id="gap-count"></span><div class="gap-controls"><div class="gap-search"><label class="visually-hidden" for="gap-search">Search gaps</label><input id="gap-search" type="search" placeholder="Search gaps or requirements…" value="${escape(state.gapSearch)}"></div><label class="visually-hidden" for="gap-severity">Filter gaps by severity</label><select id="gap-severity"><option value="all" ${state.gapSeverity === 'all' ? 'selected' : ''}>All severities</option><option value="blocker" ${state.gapSeverity === 'blocker' ? 'selected' : ''}>Blockers</option><option value="warning" ${state.gapSeverity === 'warning' ? 'selected' : ''}>Warnings</option><option value="info" ${state.gapSeverity === 'info' ? 'selected' : ''}>Information</option></select></div></div><div class="table-wrap" id="gap-table-container"></div><div class="gap-footer"><span aria-hidden="true">◇</span>Server-reported gaps · Configuration metadata validation · Production readiness unavailable</div></div></section>`;
  }

  function renderGapRows() {
    const target = $('#gap-table-container');
    if (!target) return;
    const scoped = state.report.gaps.filter(
      (gap) => state.page === 'overview' || gap.category === state.page,
    );
    const query = state.gapSearch.toLowerCase();
    const gaps = scoped.filter(
      (gap) =>
        (state.gapSeverity === 'all' || gap.severity === state.gapSeverity) &&
        `${gap.field} ${gap.currentState} ${gap.expectedState} ${gap.requirementId} ${gap.owner} ${gap.remediation} ${categoryName(gap.category)}`
          .toLowerCase()
          .includes(query),
    );
    const displayed = gaps.slice(0, state.gapLimit);
    $('#gap-count').textContent =
      `${gaps.length} ${gaps.length === 1 ? 'gap' : 'gaps'}${gaps.length !== scoped.length ? ` of ${scoped.length}` : ''} · ${titleCase(state.view)} v${state.report.version}`;
    if (!gaps.length) {
      target.innerHTML = `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">${scoped.length ? '⌕' : '✓'}</span><h3>${scoped.length ? 'No matching gaps' : 'No metadata gaps reported'}</h3><p>${scoped.length ? 'Try another search or severity filter.' : 'The server reports no gaps for this selection within the implemented metadata checks. Production readiness remains unavailable.'}</p></div>`;
      return;
    }
    target.innerHTML = `<table class="gap-table"><thead><tr><th scope="col">Severity</th><th scope="col">Gap & current state</th><th scope="col">Category / requirement</th><th scope="col">Owner / next step</th><th scope="col"><span class="visually-hidden">Details</span></th></tr></thead><tbody>${displayed.map((gap) => `<tr><td>${badge(gap.severity)}</td><td><span class="gap-title">${escape(titleCase(gap.field))}</span><span class="gap-subtitle">${escape(gap.currentState)}</span></td><td><span>${escape(categoryName(gap.category))}</span><span class="gap-subtitle">${escape(gap.requirementId)}</span></td><td><span class="gap-owner">${escape(gap.owner)}</span><span class="gap-subtitle">${escape(gap.code === 'REQUIRES_ENGINEERING' ? 'Engineering required' : gap.code === 'DISCOVERY_REQUIRED' ? 'Discovery required' : 'Configuration change')}</span></td><td><button type="button" class="row-button" data-gap="${escape(gap.id)}" aria-label="Inspect gap: ${escape(gap.field)}">↗</button></td></tr>`).join('')}</tbody></table>${gaps.length > displayed.length ? `<div class="gap-toolbar"><span class="gap-count">Showing ${displayed.length} of ${gaps.length} gaps</span><button type="button" class="button secondary small" data-more-gaps>Show more gaps</button></div>` : ''}`;
  }

  function navigate(page) {
    if (state.busy || page === state.page) return;
    if (hosted() && page === 'sandboxes') {
      void openSandboxes();
      return;
    }
    if (!discardAllowed()) return;
    insuranceEditor.reset();
    insuranceWorkflow.discardDraft();
    insuranceOperations.discardDraft();
    insuranceFnol.discardDraft();
    state.page = page;
    state.tab = 'inspect';
    state.gapSearch = '';
    state.gapSeverity = 'all';
    state.gapLimit = 12;
    state.dirty = false;
    state.pendingWrite = null;
    state.insurancePanel = 'list';
    state.insuranceForm = null;
    state.insurancePendingWrite = null;
    state.setupForm = null;
    state.activationReview = null;
    $('#notification').hidden = true;
    render();
    updateTargetUrl(page);
    if (page === 'setup') void loadSetup();
    if (page === 'requirements' && !state.requirements) void loadRequirements();
    if (page === 'insurance' && !state.insurance && canInsurance('read')) void loadInsurance();
    closeMenu();
    $('#main-content').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function discardAllowed() {
    if (
      insuranceWorkflow.hasPendingWrite() ||
      insuranceOperations.hasPendingWrite() ||
      insuranceFnol.hasPendingWrite()
    )
      return window.confirm(
        'A workflow, document or financial request has an uncertain result. Continue and inspect retained workflow evidence before submitting a new request?',
      );
    if (state.controlPendingWrite)
      return window.confirm(
        'A control command has an uncertain result. Continue and inspect durable tenant state before submitting a new command?',
      );
    if (state.insurancePendingWrite)
      return window.confirm(
        'A synthetic insurance command has an uncertain result. Continue and inspect persisted records before submitting a new command?',
      );
    return (
      !state.dirty || window.confirm('You have unsaved form changes. Discard them and continue?')
    );
  }

  function markDirty() {
    state.dirty = true;
    state.pendingWrite = null;
    const element = $('#edit-status');
    if (element) element.textContent = 'Unsaved changes · Published configuration is unchanged.';
  }

  async function save(configuration) {
    if (state.busy || !canWrite()) return;
    if (!state.pendingWrite)
      state.pendingWrite = {
        expectedVersion: state.snapshot.version,
        idempotencyKey: crypto.randomUUID(),
        configuration,
      };
    setBusy(true);
    const buttons = [...document.querySelectorAll('[data-save]')];
    buttons.forEach((button) => {
      button.textContent = 'Saving…';
    });
    try {
      const result = await api('/api/draft', {
        method: 'PUT',
        body: JSON.stringify(state.pendingWrite),
      });
      insuranceEditor.reset();
      state.snapshot = result.snapshot;
      state.report = null;
      state.dirty = false;
      state.pendingWrite = null;
      try {
        const { snapshot, report } = await readConsistentSnapshot('draft');
        state.snapshot = snapshot;
        state.report = report;
        render();
        const savedMessage = `${result.summary || 'Draft saved successfully.'}${snapshot.version !== result.snapshot.version ? ` Your change was saved as version ${result.snapshot.version}; the workspace now displays the latest version ${snapshot.version}.` : ''}`;
        notify(
          savedMessage,
          'success',
          result.diff.length
            ? `<ul class="changes-list">${result.diff
                .slice(0, 8)
                .map((change) => `<li>${escape(change.path)}</li>`)
                .join(
                  '',
                )}${result.diff.length > 8 ? `<li>And ${result.diff.length - 8} more changed paths.</li>` : ''}</ul>`
            : '',
        );
      } catch (error) {
        render();
        showError(
          error,
          `Your draft was saved as version ${result.snapshot.version}, but its validation report is unavailable.`,
        );
      }
      return true;
    } catch (error) {
      if (error.status === 409) {
        state.pendingWrite = null;
        notify(
          'The draft changed after you opened it. Your unsaved input is preserved. Review or copy your changes, then load the latest draft before saving again.',
          'warning',
          '<br><button type="button" class="button secondary small" data-reload-conflict>Load latest draft</button>',
        );
      } else
        showError(
          error,
          error.status
            ? 'Draft was not saved.'
            : 'The save result could not be confirmed. Retry without editing to reuse the same request.',
        );
      buttons.forEach((button) => {
        button.innerHTML = 'Save draft <span aria-hidden="true">↗</span>';
      });
    } finally {
      setBusy(false);
    }
  }

  function openDialog(title, eyebrow, html) {
    $('#dialog-title').textContent = title;
    $('#dialog-eyebrow').textContent = eyebrow;
    $('#dialog-body').innerHTML = `<div class="dialog-body-content">${html}</div>`;
    if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  }

  function gapDialog(id) {
    const gap = state.report.gaps.find((item) => item.id === id);
    if (!gap) return;
    const fact = (label, value, full = false, className = '') =>
      `<div class="${full ? 'full-width' : ''}"><dt>${escape(label)}</dt><dd class="${className}">${escape(value)}</dd></div>`;
    openDialog(
      titleCase(gap.field),
      `${categoryName(gap.category)} · ${gap.requirementId}`,
      `<div class="dialog-tags">${badge(gap.severity)}${badge(gap.kind)}<span class="code-chip">${escape(gap.code)}</span></div><dl class="dialog-facts">${fact('Current state', gap.currentState, true)}${fact('Expected state', gap.expectedState, true)}${fact('Next step', gap.remediation, true, 'remediation')}${fact('Affected journey', gap.affectedJourney, true)}${fact('Owner', gap.owner)}${fact('Tenant', gap.tenantId)}${fact('Product', gap.productId || 'Tenant-level gap')}${fact('Process', gap.processId || 'Not process-specific')}${fact('Gap reference', gap.id, true)}</dl>`,
    );
  }

  async function resourceDialog(resource) {
    const resources = {
      openapi: ['API contract', '/api/openapi.json'],
      mcp: ['MCP discovery', '/api/mcp-discovery'],
      audit: ['Audit log', '/api/audit'],
    };
    if (!resources[resource]) return;
    const [title, path] = resources[resource];
    const epoch = state.epoch;
    openDialog(
      title,
      'AUTHORIZED WORKSPACE RESOURCE',
      '<div class="loading-state"><span class="spinner" aria-hidden="true"></span>Loading resource…</div>',
    );
    try {
      const data = await api(path);
      if (epoch !== state.epoch) return;
      const json = JSON.stringify(data, null, 2);
      openDialog(
        title,
        'AUTHORIZED WORKSPACE RESOURCE',
        `<p class="field-help dialog-resource-note">Fetched with your current session authorization from ${escape(path)}.</p><pre class="json-output" tabindex="0">${escape(json)}</pre>`,
      );
    } catch (error) {
      if (epoch !== state.epoch) return;
      openDialog(
        title,
        'RESOURCE UNAVAILABLE',
        `<div class="message error-message" role="alert">${escape(error.message)}${error.correlationId ? `<br>Reference: ${escape(error.correlationId)}` : ''}</div>`,
      );
    }
  }

  function closeMenu() {
    $('#sidebar').classList.remove('is-open');
    $('#menu-toggle').setAttribute('aria-expanded', 'false');
  }

  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('#access-token');
    state.token = input.value.trim();
    if (!state.token) return;
    $('#login-error').hidden = true;
    $('#login-submit').disabled = true;
    $('#login-submit').textContent = 'Opening workspace…';
    try {
      const [context, catalog, { snapshot, report }] = await Promise.all([
        api('/api/context'),
        api('/api/catalog'),
        readConsistentSnapshot('draft'),
      ]);
      Object.assign(state, {
        context,
        catalog,
        snapshot,
        report,
        view: 'draft',
        page: 'overview',
        tab: 'inspect',
        dirty: false,
        pendingWrite: null,
      });
      input.value = '';
      $('#login-screen').hidden = true;
      $('#app-shell').hidden = false;
      render();
      $('#main-content').focus({ preventScroll: true });
    } catch (error) {
      state.token = '';
      $('#login-error').textContent =
        error.status === 401
          ? 'The access token was not accepted. Use the token provided by your local server.'
          : `Could not open the workspace. ${error.message}`;
      $('#login-error').hidden = false;
    } finally {
      $('#login-submit').disabled = false;
      $('#login-submit').innerHTML = 'Open workspace <span aria-hidden="true">↗</span>';
    }
  });

  $('#logout-button').addEventListener('click', async () => {
    if (!discardAllowed()) return;
    if (hosted()) {
      setBusy(true);
      try {
        await api('/auth/logout', { method: 'POST', unscoped: true, body: '{}' });
        clearTenantState();
        state.session = null;
        window.location.assign('/');
      } catch (error) {
        showError(error, 'Could not end the organization session.');
        setBusy(false);
      }
      return;
    }
    insuranceEditor.reset();
    insuranceWorkflow.reset();
    insuranceOperations.reset();
    insuranceFnol.reset();
    state.epoch += 1;
    Object.assign(state, {
      token: '',
      context: null,
      catalog: null,
      snapshot: null,
      report: null,
      requirements: null,
      requirementsError: null,
      requirementsLoading: false,
      insurance: null,
      insuranceError: null,
      insuranceLoading: false,
      insuranceRecord: null,
      insurancePanel: 'list',
      insuranceForm: null,
      insurancePendingWrite: null,
      insuranceEvaluation: null,
      dirty: false,
      pendingWrite: null,
    });
    $('#workspace-content').replaceChildren();
    $('#primary-nav').replaceChildren();
    $('#scope-summary').replaceChildren();
    $('#dialog-body').replaceChildren();
    $('#notification').hidden = true;
    if ($('#detail-dialog').open) $('#detail-dialog').close();
    $('#app-shell').hidden = true;
    $('#login-screen').hidden = false;
    $('#access-token').value = '';
    $('#access-token').focus();
  });

  $('#refresh-button').addEventListener('click', async () => {
    if (!discardAllowed()) return;
    $('#notification').hidden = true;
    if (hosted() && state.page === 'sandboxes') await openSandboxes();
    else if (hosted() && !state.snapshot && state.targetId)
      await selectTenant(state.targetId, state.page);
    else if (state.page === 'setup') await loadSetup();
    else if (state.page === 'insurance') await loadInsurance();
    else if (state.page === 'requirements') await loadRequirements();
    else await loadSnapshot();
  });

  document.addEventListener('click', async (event) => {
    if (await insuranceEditor.handleClick(event)) return;
    const targetButton = event.target.closest('[data-select-tenant]');
    if (targetButton) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (!state.busy && !targetButton.disabled)
        await selectTenant(targetButton.dataset.selectTenant, 'setup', true);
    }
    const control = event.target.closest('[data-control-action]');
    if (control && !state.busy && !control.disabled) {
      const action = control.dataset.controlAction;
      if (action === 'view-connections') {
        setBusy(true);
        try {
          const result = await api('/auth/connections', { unscoped: true });
          openDialog(
            'Your MCP connections',
            'ORGANIZATION SESSION',
            `<p class="field-help">${result.connections.length} active client grants. These are your own authorizations; client identifiers do not certify a successful ChatGPT connection test.</p>${result.connections.map((connection) => `<p class="field-help">Client <code>${escape(connection.clientId)}</code> · Expires ${escape(date(connection.expiresAt))}</p>`).join('')}${controlButton('disconnect-mcp', 'Disconnect all MCP connections', { disabled: !result.connections.length })}`,
          );
        } catch (error) {
          showError(error, 'Connection grants could not be inspected.');
        } finally {
          setBusy(false);
        }
      }
      if (action === 'disconnect-mcp') {
        setBusy(true);
        try {
          await api('/auth/connections/revoke', { method: 'POST', body: '{}', unscoped: true });
          openDialog(
            'MCP connections revoked',
            'ORGANIZATION SESSION',
            '<p>Your MCP client grants have been revoked. A client must reconnect with your own organization identity before making further authorized requests.</p>',
          );
        } catch (error) {
          showError(error, 'Could not revoke MCP connections.');
        } finally {
          setBusy(false);
        }
      }
      if (action === 'new-tenant') {
        const account = state.session.accounts.find(
          (entry) => entry.id === control.dataset.accountId,
        );
        if (!account || !['owner', 'admin', 'builder'].includes(account.role) || !discardAllowed())
          return;
        state.setupForm = { kind: 'create-tenant', accountId: account.id, displayName: '' };
        state.controlPendingWrite = null;
        state.dirty = false;
        render();
        $('#sandbox-name').focus();
      }
      if (action === 'discard-form' && discardAllowed()) {
        state.setupForm = null;
        state.controlPendingWrite = null;
        state.dirty = false;
        render();
      }
      if (action === 'retry-tenant')
        await writeControl(
          '/api/control/tenants/retry',
          'POST',
          { operationId: control.dataset.operationId },
          true,
        );
      if (action === 'attach-requirements' && canConfigureSandbox() && discardAllowed()) {
        state.setupForm = {
          kind: 'requirements',
          json: state.setup.requirements
            ? JSON.stringify(state.setup.requirements.profile, null, 2)
            : '',
        };
        state.controlPendingWrite = null;
        state.dirty = false;
        render();
        $('#requirements-json').focus();
      }
      if (action === 'new-policy') startRuntimePolicy();
      if (action === 'edit-policy') startRuntimePolicy(Number(control.dataset.policyIndex));
      if (action === 'remove-policy' && canConfigureSandbox() && discardAllowed())
        await writeControl('/api/control/runtime-draft', 'PUT', {
          expectedVersion: state.setup.runtimeDraft.version,
          policies: state.setup.runtimeDraft.policies.filter(
            (_, index) => index !== Number(control.dataset.policyIndex),
          ),
        });
      if (
        action === 'review-activation' &&
        canConfigureSandbox() &&
        state.setup?.candidate.canActivate &&
        discardAllowed()
      ) {
        state.activationReview = clone(state.setup.candidate);
        render();
        $('.activation-review').scrollIntoView({ block: 'start' });
      }
      if (action === 'cancel-activation') {
        state.activationReview = null;
        render();
      }
      if (action === 'confirm-activation' && canConfigureSandbox() && state.activationReview) {
        const { draftVersion, draftHash, requirementsHash, runtimeDraftVersion, runtimeDraftHash } =
          state.activationReview;
        await writeControl('/api/control/activate', 'POST', {
          draftVersion,
          draftHash,
          requirementsHash,
          runtimeDraftVersion,
          runtimeDraftHash,
        });
      }
    }
    if (await insuranceWorkflow.handleClick(event)) return;
    if (await insuranceOperations.handleClick(event)) return;
    if (await insuranceFnol.handleClick(event)) return;
    const insuranceRecord = event.target.closest('[data-insurance-record]');
    if (insuranceRecord) await openInsuranceRecord(insuranceRecord.dataset.insuranceRecord);
    const insuranceAction = event.target.closest('[data-insurance-action]');
    if (insuranceAction && !state.busy && !insuranceAction.disabled) {
      const action = insuranceAction.dataset.insuranceAction;
      const permission = insuranceAction.dataset.insurancePermission;
      if (permission && !canInsurance(permission)) return;
      if (
        [
          'create',
          'revise',
          'service',
          'configured-service',
          'configured-cancellation',
          'renewal',
        ].includes(action)
      )
        await startInsuranceForm(action);
      if (['add-risk-row', 'remove-risk-row'].includes(action)) {
        if (state.insurancePendingWrite && !discardAllowed()) return;
        captureInsuranceForm();
        if (
          decisionView.handleAction(
            action,
            insuranceAction,
            state.insuranceForm,
            insuranceDefinition(),
          )
        ) {
          state.insurancePendingWrite = null;
          invalidateInsuranceEvaluation();
          state.dirty = true;
          render();
        }
      }
      if (action === 'evaluate-cancellation') {
        if (!$('#insurance-service-form')?.reportValidity()) return;
        captureInsuranceForm();
        const epoch = state.epoch;
        invalidateInsuranceEvaluation();
        setBusy(true);
        try {
          const result = await api('/api/insurance/cancellation/evaluate', {
            method: 'POST',
            body: JSON.stringify(cancellationPayload()),
          });
          if (epoch === state.epoch) state.insuranceEvaluation = result;
        } catch (error) {
          showError(error, 'Cancellation could not be evaluated.');
        } finally {
          if (epoch === state.epoch) {
            setBusy(false);
            render();
          }
        }
      }
      if (['evaluate', 'evaluate-service', 'evaluate-renewal'].includes(action)) {
        const element = $('#insurance-quote-form');
        if (!element?.reportValidity()) return;
        captureInsuranceForm();
        const definition = insuranceDefinition();
        if (!definition) return;
        const epoch = state.epoch;
        state.insuranceEvaluation = null;
        setBusy(true);
        try {
          const submission = decisionView.submission(
            state.insuranceForm,
            definition,
            insurancePolicy().currency,
          );
          const result = await api(
            action === 'evaluate-service'
              ? '/api/insurance/service/evaluate'
              : action === 'evaluate-renewal'
                ? '/api/insurance/renewal/evaluate'
                : '/api/insurance/evaluate',
            {
              method: 'POST',
              body: JSON.stringify(
                action === 'evaluate-service'
                  ? configuredServicePayload(submission)
                  : action === 'evaluate-renewal'
                    ? renewalPayload(submission)
                    : {
                        productId: state.insuranceForm.productId,
                        productVersion: state.insuranceForm.productVersion,
                        submission,
                        ...(state.insurancePanel === 'revise'
                          ? { recordId: state.insuranceRecord.record.id }
                          : {}),
                      },
              ),
            },
          );
          if (epoch === state.epoch) state.insuranceEvaluation = result;
        } catch (error) {
          showError(error, 'The risk could not be evaluated.');
        } finally {
          if (epoch === state.epoch) {
            setBusy(false);
            render();
            $('.decision-result')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      }
      if (action === 'close-form' && discardAllowed()) {
        state.insurancePanel = 'list';
        state.insuranceForm = null;
        state.insurancePendingWrite = null;
        state.dirty = false;
        render();
      }
      if (['add-participant', 'remove-participant'].includes(action)) {
        if (state.insurancePendingWrite && !discardAllowed()) return;
        captureInsuranceForm();
        const participants = state.insuranceForm?.participants;
        if (!participants) return;
        if (action === 'add-participant')
          participants.push({ id: '', role: 'follow', sharePercent: '' });
        else if (participants.length > 1)
          participants.splice(Number(insuranceAction.dataset.participantIndex), 1);
        state.insurancePendingWrite = null;
        state.dirty = true;
        render();
        if (action === 'add-participant') $(`#participant-${participants.length - 1}-id`)?.focus();
      }
      if (action === 'bind' && state.insuranceRecord && discardAllowed()) {
        const record = state.insuranceRecord.record;
        insuranceWorkflow.discardDraft();
        insuranceOperations.discardDraft();
        insuranceFnol.discardDraft();
        await executeInsuranceWrite('/api/insurance/bind', 'POST', {
          recordId: record.id,
          expectedVersion: record.version,
          quoteHash: record.quoteHash,
          ...(insuranceWorkflow.bindApprovalId()
            ? { approvalId: insuranceWorkflow.bindApprovalId() }
            : {}),
        });
      }
    }
    const pageButton = event.target.closest('[data-page]');
    if (pageButton) navigate(pageButton.dataset.page);
    const viewButton = event.target.closest('[data-view]');
    if (viewButton && viewButton.dataset.view !== state.view && !state.busy) {
      if (!discardAllowed()) return;
      $('#notification').hidden = true;
      await loadSnapshot({ targetView: viewButton.dataset.view });
    }
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton && tabButton.dataset.tab !== state.tab && !state.busy) {
      if (!discardAllowed()) return;
      insuranceEditor.reset();
      state.tab = tabButton.dataset.tab;
      state.dirty = false;
      state.pendingWrite = null;
      render();
    }
    if (event.target.closest('[data-reset]') && !state.busy && discardAllowed()) {
      state.dirty = false;
      state.pendingWrite = null;
      render();
    }
    if (event.target.closest('[data-all-categories]')) {
      $('#category-grid').innerHTML = state.catalog.categories.map(categoryCard).join('');
      $('#category-list-note').textContent =
        `Showing all ${state.catalog.categories.length} configuration categories.`;
      event.target.closest('[data-all-categories]').hidden = true;
    }
    if (event.target.closest('[data-more-gaps]')) {
      state.gapLimit += 20;
      renderGapRows();
    }
    const gapButton = event.target.closest('[data-gap]');
    if (gapButton) gapDialog(gapButton.dataset.gap);
    const resourceButton = event.target.closest('[data-resource]');
    if (resourceButton) await resourceDialog(resourceButton.dataset.resource);
    if (event.target.closest('[data-reload-conflict]') && discardAllowed()) {
      $('#notification').hidden = true;
      await loadSnapshot();
    }
  });

  document.addEventListener('input', (event) => {
    if (insuranceWorkflow.handleInput(event)) return;
    if (insuranceOperations.handleInput(event)) return;
    if (insuranceFnol.handleInput(event)) return;
    if (insuranceEditor.handleInput(event)) return;
    if (
      event.target.closest(
        '#tenant-create-form, #runtime-policy-form, #requirements-attach-form, #sandbox-rollback-form',
      ) &&
      state.setupForm
    ) {
      if (event.target.id === 'requirements-json') state.setupForm.json = event.target.value;
      else if (event.target.name) state.setupForm[event.target.name] = event.target.value;
      state.dirty = true;
    }
    if (event.target.closest('#insurance-quote-form, #insurance-service-form')) {
      captureInsuranceForm();
      invalidateInsuranceEvaluation();
      if (insuranceDefinition() && $('#insurance-quote-form'))
        decisionView.refreshQuestions(
          state.insuranceForm,
          insuranceDefinition(),
          $('#insurance-quote-form'),
          insurancePolicy().currency,
        );
      state.dirty = true;
    }
    if (event.target.closest('#tenant-form') || event.target.id === 'configuration-json')
      markDirty();
    if (event.target.id === 'gap-search') {
      state.gapSearch = event.target.value;
      state.gapLimit = 12;
      renderGapRows();
    }
  });
  document.addEventListener('change', async (event) => {
    if (await insuranceFnol.handleChange(event)) return;
    if (await insuranceEditor.handleChange(event)) return;
    if (event.target.closest('#tenant-create-form, #runtime-policy-form') && state.setupForm) {
      if (event.target.name) state.setupForm[event.target.name] = event.target.value;
      state.dirty = true;
    }
    if (event.target.id === 'requirements-file' && state.setupForm?.kind === 'requirements') {
      const file = event.target.files[0];
      const epoch = state.epoch;
      if (file)
        try {
          if (file.size > 200000) throw new Error('The requirements JSON package exceeds 200 KB.');
          const source = await file.text();
          if (epoch !== state.epoch || state.setupForm?.kind !== 'requirements') return;
          JSON.parse(source);
          state.setupForm.json = source;
          state.dirty = true;
          $('#requirements-json').value = source;
        } catch (error) {
          showError(error, 'The package could not be read.');
        }
    }
    if (event.target.closest('#insurance-quote-form, #insurance-service-form')) {
      captureInsuranceForm();
      invalidateInsuranceEvaluation();
      if (insuranceDefinition() && $('#insurance-quote-form'))
        decisionView.refreshQuestions(
          state.insuranceForm,
          insuranceDefinition(),
          $('#insurance-quote-form'),
          insurancePolicy().currency,
        );
      state.dirty = true;
      if (event.target.id === 'insurance-product') {
        const selected = state.insurance.catalog.policies.find(
          ({ policy }) => `${policy.id}@${policy.version}` === event.target.value,
        )?.policy;
        if (selected) {
          state.insuranceForm.answers = {};
          state.insuranceForm.riskGroups = [];
          state.insuranceForm.coverages = {};
          state.insuranceForm.territory = '';
          state.insuranceForm.productId = selected.id;
          state.insuranceForm.productVersion = selected.version;
          render();
          $('#insurance-product')?.focus();
        }
      }
    }
    if (event.target.id === 'gap-severity') {
      state.gapSeverity = event.target.value;
      state.gapLimit = 12;
      renderGapRows();
    }
    if (event.target.closest('#tenant-form')) markDirty();
  });
  document.addEventListener('submit', async (event) => {
    if (await insuranceWorkflow.handleSubmit(event)) return;
    if (await insuranceOperations.handleSubmit(event)) return;
    if (await insuranceFnol.handleSubmit(event)) return;
    if (await insuranceEditor.handleSubmit(event)) return;
    if (event.target.id === 'sandbox-rollback-form') {
      event.preventDefault();
      if (!state.busy && canConfigureSandbox() && state.setup?.activeRelease) {
        await writeControl('/api/control/rollback', 'POST', {
          releaseId: $('#rollback-release-id').value.trim(),
          expectedActiveReleaseId: state.setup.activeRelease.id,
        });
      }
    }
    if (
      ['tenant-create-form', 'requirements-attach-form', 'runtime-policy-form'].includes(
        event.target.id,
      )
    ) {
      event.preventDefault();
      if (state.busy) return;
      try {
        if (event.target.id === 'tenant-create-form') {
          const values = Object.fromEntries(new FormData(event.target));
          await writeControl(
            '/api/control/tenants',
            'POST',
            {
              accountId: state.setupForm.accountId,
              displayName: String(values.displayName).trim(),
              environment: 'sandbox',
              region: String(values.region),
            },
            true,
          );
        } else if (event.target.id === 'requirements-attach-form' && canConfigureSandbox()) {
          const profile = JSON.parse($('#requirements-json').value);
          await writeControl('/api/control/requirements', 'PUT', {
            expectedVersion: state.setup.requirements?.version || 0,
            profile,
          });
        } else if (event.target.id === 'runtime-policy-form' && canConfigureSandbox()) {
          const values = Object.fromEntries(new FormData(event.target));
          const product = state.snapshot.configuration.products.find(
            (entry) => `${entry.id}@${entry.version}` === values.product,
          );
          if (!product) throw new Error('Select a product from the current configuration draft.');
          if (moneyDigits[values.currency] === undefined)
            throw new Error('Select a supported policy currency.');
          const policy = {
            id: product.id,
            version: product.version,
            name: String(values.name).trim(),
            currency: values.currency,
            effectiveFrom: values.effectiveFrom,
            effectiveTo: values.effectiveTo,
            maximumPremiumMinor: decimalToInteger(
              values.maximumPremium,
              moneyDigits[values.currency],
              'Maximum premium',
            ),
            maximumParticipants: Number(values.maximumParticipants),
            commission: {
              rateBps: percentToBasisPoints(values.commissionRate, 'Commission rate'),
              base: 'gross_premium',
              recipientId: String(values.recipientId).trim(),
              settlementPartyId: String(values.settlementPartyId).trim(),
              cashCustody: 'external',
            },
            requirements: {
              payment: values.payment,
              approval: values.approval,
              providerVerification: values.providerVerification,
            },
          };
          const policies = clone(state.setup.runtimeDraft.policies);
          if (state.setupForm.index === null) policies.push(policy);
          else policies[state.setupForm.index] = policy;
          await writeControl('/api/control/runtime-draft', 'PUT', {
            expectedVersion: state.setup.runtimeDraft.version,
            policies,
          });
        }
      } catch (error) {
        showError(error, 'Review the supplied configuration.');
      }
    }
    if (['insurance-quote-form', 'insurance-service-form'].includes(event.target.id)) {
      event.preventDefault();
      try {
        if (event.target.id === 'insurance-quote-form') {
          if (state.insurancePanel === 'configured-service') await submitConfiguredService();
          else await submitInsuranceQuote();
        } else await submitInsuranceService();
      } catch (error) {
        showError(error, 'Check the supplied form values.');
      }
    }
    if (event.target.id === 'tenant-form') {
      event.preventDefault();
      const configuration = clone(state.snapshot.configuration);
      configuration.tenant = Object.fromEntries(new FormData(event.target));
      await save(configuration);
    }
    if (event.target.id === 'json-form') {
      event.preventDefault();
      let configuration;
      try {
        configuration = JSON.parse($('#configuration-json').value);
      } catch (error) {
        notify(`The definition is not valid JSON. ${error.message}`, 'error');
        $('#configuration-json').focus();
        return;
      }
      await save(configuration);
    }
  });
  $('#scope-button').addEventListener('click', () =>
    openDialog(
      'Authorized session scope',
      'SERVER-ASSIGNED CONTEXT',
      `<p class="field-help dialog-resource-note">Scope and permissions are assigned by the server. This inspection does not change your access.</p><pre class="json-output" tabindex="0">${escape(JSON.stringify(state.context || state.session?.principal, null, 2))}</pre>`,
    ),
  );
  $('#dialog-close').addEventListener('click', () => $('#detail-dialog').close());
  $('#detail-dialog').addEventListener('click', (event) => {
    if (event.target === $('#detail-dialog')) {
      const rect = event.target.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        event.target.close();
    }
  });
  $('#menu-toggle').addEventListener('click', () => {
    const open = $('#sidebar').classList.toggle('is-open');
    $('#menu-toggle').setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#sidebar') && !event.target.closest('#menu-toggle')) closeMenu();
  });
  window.addEventListener('beforeunload', (event) => {
    if (state.dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  $('#switch-sandbox').addEventListener('click', () => {
    void openSandboxes();
  });
  $('#auth-retry').addEventListener('click', () => {
    void bootstrap();
  });
  void bootstrap();
})();

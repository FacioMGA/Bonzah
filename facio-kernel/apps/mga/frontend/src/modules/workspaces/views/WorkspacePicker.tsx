import { Button, Input, Select, Textarea } from '@/src/shared/ui';
import React, { useRef, useState } from 'react';
import type { CreateTenant, PlatformSession } from '../api/platformClient';
import { platformApi, PlatformError } from '../api/platformClient';
import { useWorkspaceDirectory } from './useWorkspaceDirectory';
import { safeBrandUrl } from '@/src/shared/lib/tenant/runtimeProfile';

type Props = {
  session: PlatformSession;
  onSelect: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
};
const fieldClass = 'ui-input mt-2';

export function WorkspacePicker({ session, onSelect, onRefresh, onLogout }: Props) {
  const directory = useWorkspaceDirectory(session);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [createdTenantId, setCreatedTenantId] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState('');
  const pending = useRef<CreateTenant | null>(null);
  const eligibleOrganizations = directory.organizations.filter((item) =>
    ['OWNER', 'ADMIN', 'BUILDER'].includes(item.role.toUpperCase()),
  );
  const selectedTemplate = directory.templates.find(
    (item) => `${item.id}@${item.version}` === templateKey,
  );
  const select = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await onSelect(id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Workspace could not be opened.');
      setBusy(false);
    }
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || directory.templateLoading) return;
    if (createdTenantId) {
      await select(createdTenantId);
      return;
    }
    if (!pending.current) {
      const form = new FormData(event.currentTarget);
      const template = directory.templates.find(
        (item) => `${item.id}@${item.version}` === form.get('template'),
      );
      if (!template) {
        setError('Select an available registered template.');
        return;
      }
      const white = String(form.get('white') || '').trim(),
        blue = String(form.get('blue') || '').trim();
      if (
        (white || blue) &&
        !(
          white &&
          blue &&
          safeBrandUrl(white)?.startsWith('https:') &&
          safeBrandUrl(blue)?.startsWith('https:')
        )
      ) {
        setError('Supply both logo URLs using HTTPS, or leave both empty for a text brand.');
        return;
      }
      const primaryColor = String(form.get('primaryColor') || '').trim();
      const secondaryColor = String(form.get('secondaryColor') || '').trim();
      pending.current = {
        organizationId: String(form.get('organizationId')),
        templateId: template.id,
        templateVersion: template.version,
        templateHash: template.hash,
        jurisdiction: String(form.get('jurisdiction') || ''),
        currency: String(form.get('currency') || ''),
        tenantSlug: String(form.get('tenantSlug') || '').trim(),
        displayName: String(form.get('displayName') || '').trim(),
        legalName: String(form.get('legalName') || '').trim(),
        declaredRole: String(form.get('declaredRole')) as CreateTenant['declaredRole'],
        locale: String(form.get('locale') || '').trim(),
        timeZone: String(form.get('timeZone') || '').trim(),
        addressLines: String(form.get('addressLines') || '')
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean),
        contactEmail: String(form.get('contactEmail') || '').trim(),
        contactPhone: String(form.get('contactPhone') || '').trim(),
        ...(white && blue ? { brandLogos: { white, blue } } : {}),
        ...(primaryColor ? { primaryColor } : {}),
        ...(secondaryColor ? { secondaryColor } : {}),
        idempotencyKey: crypto.randomUUID(),
      };
    }
    setBusy(true);
    setError('');
    try {
      const result = await platformApi.create(pending.current);
      pending.current = null;
      setUncertain(false);
      setCreatedTenantId(result.tenant.id);
      try {
        await onRefresh();
        await onSelect(result.tenant.id);
      } catch (failure) {
        setError(
          'Workspace was created. ' +
            (failure instanceof Error ? failure.message : 'Opening could not be confirmed.') +
            ' Use Open created workspace to retry access.',
        );
      }
    } catch (failure) {
      const ambiguous =
        !(failure instanceof PlatformError) || failure.status >= 500 || failure.status === 0;
      if (!ambiguous) pending.current = null;
      setUncertain(ambiguous);
      setError(failure instanceof Error ? failure.message : 'Creation could not be confirmed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="h-screen overflow-y-auto bg-brand-canvas p-4 md:p-10">
      <div className="mx-auto max-w-6xl space-y-8 pb-12">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest font-black text-slate-500">
              Facio Platform
            </p>
            <h1 className="mt-2 text-3xl font-black text-slate-900">Your insurance workspaces</h1>
            <p className="mt-3 text-slate-600">
              Select an authorized tenant to open policies, quotes, wizards and workspace settings.
            </p>
          </div>
          <Button
            type="button"
            className="rounded-xl px-4 py-3 border border-slate-200"
            onClick={onLogout}
            disabled={busy}
          >
            Sign out
          </Button>
        </header>
        <p className="text-sm text-slate-600">
          Signed in as {session.user.name}. Organization membership and operating tenant access are
          checked by the server.
        </p>
        {directory.error && (
          <p role="alert" className="ui-card ui-card-pad text-rose-800">
            {directory.error}
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="rounded-2xl bg-rose-50 text-rose-800 border border-rose-200 p-5"
          >
            {error}
            {uncertain && (
              <p className="mt-2">
                The request may already have completed. Retry unchanged to inspect the same
                operation; do not create a second tenant for this request.
              </p>
            )}
          </div>
        )}
        <div className="md:col-span-2 flex flex-wrap gap-3 items-end">
          <label className="text-sm font-bold flex-1">
            Find an organization
            <Input
              className={fieldClass}
              value={directory.organizationSearch}
              onChange={(event) => directory.setOrganizationSearch(event.target.value)}
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={directory.loading}
            onClick={() => void directory.load('organizations', false)}
          >
            Search organizations
          </Button>
          {directory.organizationCursor && (
            <Button
              type="button"
              variant="secondary"
              disabled={directory.loading}
              onClick={() => void directory.load('organizations', true)}
            >
              Load more organizations
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            className="rounded-xl bg-slate-900 text-white font-bold px-5 py-3 disabled:opacity-50"
            disabled={busy || !eligibleOrganizations.length}
            onClick={() => {
              setCreating(true);
              setError('');
            }}
          >
            Create workspace
          </Button>
          <Button
            type="button"
            className="rounded-xl border border-slate-300 px-5 py-3"
            disabled={busy}
            onClick={() => void onRefresh().catch((failure) => setError(String(failure.message)))}
          >
            Refresh workspaces
          </Button>
        </div>
        {!eligibleOrganizations.length && (
          <p className="text-sm text-slate-600">
            No organization currently permits this identity to create tenants. An organization
            administrator manages access.
          </p>
        )}
        {!directory.templates.length && (
          <p className="text-sm text-amber-900 bg-amber-50 rounded-xl p-4">
            No reusable tenant template is registered. Existing authorized workspaces remain
            available.
          </p>
        )}
        {creating && (
          <form
            onSubmit={submit}
            className="ui-card ui-card-pad space-y-6"
            aria-label="Create MGA workspace"
          >
            <div>
              <h2 className="text-2xl font-black">Create your MGA workspace</h2>
              <p className="text-sm text-slate-600 mt-2">
                Define the operating organization, its presentation and the registered insurance
                configuration. Creation opens the full policies, quotes, wizards and settings
                application.
              </p>
            </div>
            <fieldset
              disabled={busy || uncertain || Boolean(createdTenantId)}
              className="grid grid-cols-1 md:grid-cols-2 gap-5"
            >
              <legend className="sr-only">Tenant identity and configuration</legend>
              <div className="md:col-span-2">
                <h3 className="text-lg font-black">1. Organization and operating identity</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Your organization controls access. Each workspace has an independent operating
                  tenant and configuration.
                </p>
              </div>

              <label className="font-bold text-sm">
                Organization
                <Select
                  name="organizationId"
                  required
                  className={fieldClass}
                  value={directory.organizationId}
                  onChange={(event) => {
                    directory.setOrganizationId(event.target.value);
                    setTemplateKey('');
                  }}
                >
                  <option value="" disabled>
                    Select an organization
                  </option>
                  {eligibleOrganizations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.role}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="font-bold text-sm">
                Declared operating role
                <Select name="declaredRole" required className={fieldClass} defaultValue="">
                  <option value="" disabled>
                    Select the declared role
                  </option>
                  <option value="MGA">Managing general agent</option>
                  <option value="BROKER">Insurance broker</option>
                  <option value="COVERHOLDER">Coverholder</option>
                </Select>
                <span className="block text-xs font-normal text-slate-500 mt-2">
                  A declared business role does not grant a licence or delegated underwriting
                  authority.
                </span>
              </label>
              <label className="font-bold text-sm">
                Trading / workspace name
                <Input
                  name="displayName"
                  required
                  maxLength={160}
                  className={fieldClass}
                  autoComplete="organization"
                />
              </label>
              <label className="font-bold text-sm">
                Registered legal name
                <Input
                  name="legalName"
                  required
                  maxLength={160}
                  className={fieldClass}
                  autoComplete="organization"
                />
              </label>
              <label className="font-bold text-sm">
                Tenant identifier
                <Input
                  name="tenantSlug"
                  required
                  pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*"
                  minLength={3}
                  maxLength={63}
                  className={fieldClass}
                  autoComplete="off"
                  placeholder="your-team-workspace"
                />
                <span className="block text-xs font-normal text-slate-500 mt-2">
                  Unique lowercase identifier; not an insurance account or policy number.
                </span>
              </label>
              <div className="md:col-span-2 border-t border-slate-100 pt-5">
                <h3 className="text-lg font-black">2. Insurance configuration and region</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Jurisdiction and currency must match the selected server-registered template.
                  Unsupported combinations cannot be activated by a form setting.
                </p>
              </div>
              <label className="font-bold text-sm md:col-span-2">
                Registered insurance template
                <Select
                  name="template"
                  required
                  className={fieldClass}
                  value={templateKey}
                  onChange={(event) => setTemplateKey(event.target.value)}
                >
                  <option value="" disabled>
                    {directory.templateLoading
                      ? 'Loading available templates…'
                      : 'Select a registered template'}
                  </option>
                  {directory.templates.map((item) => (
                    <option key={`${item.id}@${item.version}`} value={`${item.id}@${item.version}`}>
                      {item.name} · v{item.version} · {item.countryCode || item.jurisdiction} ·{' '}
                      {item.currency}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="font-bold text-sm">
                Operating jurisdiction
                <Select
                  key={'jurisdiction-' + templateKey}
                  name="jurisdiction"
                  required
                  className={fieldClass}
                  defaultValue=""
                  disabled={!selectedTemplate}
                >
                  <option value="" disabled>
                    Confirm jurisdiction
                  </option>
                  {selectedTemplate && (
                    <option value={selectedTemplate.jurisdiction || selectedTemplate.countryCode}>
                      {selectedTemplate.jurisdiction || selectedTemplate.countryCode}
                    </option>
                  )}
                </Select>
              </label>
              <label className="font-bold text-sm">
                Operating currency
                <Select
                  key={'currency-' + templateKey}
                  name="currency"
                  required
                  className={fieldClass}
                  defaultValue=""
                  disabled={!selectedTemplate}
                >
                  <option value="" disabled>
                    Confirm currency
                  </option>
                  {selectedTemplate && (
                    <option value={selectedTemplate.currency}>{selectedTemplate.currency}</option>
                  )}
                </Select>
              </label>
              <label className="font-bold text-sm">
                Workspace locale
                <Input
                  name="locale"
                  required
                  className={fieldClass}
                  placeholder="For example en-GB"
                />
              </label>
              <label className="font-bold text-sm">
                Business time zone
                <Input
                  name="timeZone"
                  required
                  className={fieldClass}
                  placeholder="For example Europe/Nicosia"
                />
                <span className="block text-xs font-normal text-slate-500 mt-2">
                  Use an IANA time zone. The server validates this value.
                </span>
              </label>
              <p className="md:col-span-2 text-sm text-slate-600">
                Deployment region:{' '}
                <strong>
                  {session.region ||
                    selectedTemplate?.region ||
                    'Not reported by the hosting environment'}
                </strong>
                . Locale and jurisdiction settings do not move stored data.
              </p>
              <div className="md:col-span-2 border-t border-slate-100 pt-5">
                <h3 className="text-lg font-black">3. Office and contact</h3>
              </div>
              <label className="font-bold text-sm md:col-span-2">
                Office address
                <Textarea
                  name="addressLines"
                  required
                  rows={3}
                  className={fieldClass}
                  placeholder="Street and building&#10;City / postal code&#10;Country"
                />
                <span className="block text-xs font-normal text-slate-500 mt-2">
                  One address line per row.
                </span>
              </label>
              <label className="font-bold text-sm">
                Contact email
                <Input
                  name="contactEmail"
                  type="email"
                  required
                  maxLength={254}
                  className={fieldClass}
                />
              </label>
              <label className="font-bold text-sm">
                Contact phone
                <Input
                  name="contactPhone"
                  type="tel"
                  required
                  maxLength={80}
                  className={fieldClass}
                />
              </label>
              <div className="md:col-span-2 border-t border-slate-100 pt-5">
                <h3 className="text-lg font-black">4. Workspace branding</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Provide hosted HTTPS logos or use your trading name as a text brand. Both logo
                  variants are needed when adding images.
                </p>
              </div>
              <label className="font-bold text-sm">
                Logo for dark backgrounds (HTTPS)
                <Input
                  name="white"
                  type="url"
                  className={fieldClass}
                  placeholder="Optional HTTPS image URL"
                />
              </label>
              <label className="font-bold text-sm">
                Logo for light backgrounds (HTTPS)
                <Input
                  name="blue"
                  type="url"
                  className={fieldClass}
                  placeholder="Optional HTTPS image URL"
                />
              </label>
              <label className="font-bold text-sm">
                Primary color
                <Input
                  name="primaryColor"
                  pattern="#[0-9A-Fa-f]{6}"
                  className={fieldClass}
                  placeholder="Optional #RRGGBB"
                />
              </label>
              <label className="font-bold text-sm">
                Secondary color
                <Input
                  name="secondaryColor"
                  pattern="#[0-9A-Fa-f]{6}"
                  className={fieldClass}
                  placeholder="Optional #RRGGBB"
                />
              </label>
            </fieldset>
            <p className="text-sm text-amber-950 bg-amber-50 rounded-xl p-4">
              Registered templates in this environment are synthetic. Their retained product and
              binder rules govern execution; creating an organization profile does not establish
              insurer approval, live payment or legal authority.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-slate-900 text-white font-bold px-5 py-3 disabled:opacity-50"
              >
                {busy
                  ? 'Creating and opening workspace…'
                  : createdTenantId
                    ? 'Open created workspace'
                    : uncertain
                      ? 'Retry unchanged creation'
                      : 'Create and open workspace'}
              </Button>
              {!uncertain && (
                <Button
                  type="button"
                  disabled={busy}
                  className="rounded-xl border border-slate-300 px-5 py-3"
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </Button>
              )}
            </div>
            <details className="text-sm text-slate-600">
              <summary>Registered template scope</summary>
              {directory.templates.map((template) => (
                <div key={template.id} className="mt-3">
                  <strong>
                    {template.name} · v{template.version}
                  </strong>
                  <ul className="list-disc pl-5">
                    {template.limitations?.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <code className="break-all text-xs">{template.hash}</code>
                </div>
              ))}
            </details>
          </form>
        )}
        <div className="flex flex-wrap gap-3 items-end">
          <label className="font-bold text-sm flex-1">
            Find a workspace
            <Input
              className={fieldClass}
              placeholder="Workspace name or identifier"
              value={directory.tenantSearch}
              onChange={(event) => directory.setTenantSearch(event.target.value)}
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={busy || directory.loading}
            onClick={() => void directory.load('tenants', false)}
          >
            Search workspaces
          </Button>
        </div>
        <section className="grid grid-cols-1 md:grid-cols-2 gap-5" aria-label="Authorized tenants">
          {directory.tenants.map((tenant) => (
            <article key={tenant.id} className="ui-card ui-card-pad flex flex-col gap-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500 font-bold">
                  {tenant.role} · {tenant.profile.countryCode} · {tenant.profile.currency}
                </p>
                <h2 className="mt-2 text-xl font-black">
                  {tenant.displayName || tenant.profile.runtimeSettings?.branding.displayName}
                </h2>
                <p className="mt-2 text-slate-600 text-sm">{tenant.tenantSlug}</p>
              </div>
              <Button
                type="button"
                className="self-start rounded-xl bg-slate-900 text-white font-bold px-5 py-3 disabled:opacity-50"
                disabled={busy}
                onClick={() => void select(tenant.id)}
              >
                Open workspace
              </Button>
            </article>
          ))}
          {!directory.tenants.length && (
            <div className="ui-card ui-card-pad md:col-span-2">
              <h2 className="text-xl font-black">No authorized tenants yet</h2>
              <p className="mt-2 text-slate-600">
                Create a tenant using a registered template, or ask your organization administrator
                to assign an existing one.
              </p>
            </div>
          )}
        </section>
        {directory.tenantCursor && (
          <Button
            type="button"
            variant="secondary"
            disabled={busy || directory.loading}
            onClick={() => void directory.load('tenants', true)}
          >
            Load more workspaces
          </Button>
        )}
      </div>
    </main>
  );
}

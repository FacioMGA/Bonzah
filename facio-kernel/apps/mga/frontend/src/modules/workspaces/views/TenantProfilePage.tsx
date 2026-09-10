import { Button, Input, Select, Textarea } from '@/src/shared/ui';
import React, { useEffect, useRef, useState } from 'react';
import { useOperatingTenant } from '@/src/shared/lib/tenant/TenantBrand';
import { safeBrandUrl } from '@/src/shared/lib/tenant/runtimeProfile';
import {
  platformApi,
  PlatformError,
  type EditableProfile,
  type VersionedProfile,
} from '../api/platformClient';

type FormValues = {
  displayName: string;
  legalName: string;
  declaredRole: EditableProfile['declaredRole'] | '';
  locale: string;
  timeZone: string;
  addressLines: string;
  contactEmail: string;
  contactPhone: string;
  white: string;
  blue: string;
  primaryColor: string;
  secondaryColor: string;
};
function formValues(value: VersionedProfile): FormValues {
  const p = value.profile;
  return {
    legalName: p.legalName || p.runtimeSettings?.branding.legalName || '',
    declaredRole: p.declaredRole || '',
    locale: p.locale || '',
    timeZone: p.timeZone || '',
    addressLines: (p.addressLines || p.runtimeSettings?.branding.addressLines || []).join('\n'),
    secondaryColor: p.secondaryColor || p.runtimeSettings?.branding.secondaryColor || '',
    displayName: p.displayName || p.runtimeSettings?.branding.displayName || '',
    contactEmail: p.contactEmail || p.runtimeSettings?.contact.email || '',
    contactPhone: p.contactPhone || p.runtimeSettings?.contact.phone || '',
    white: p.brandLogos?.white || p.brandLogo?.white || '',
    blue: p.brandLogos?.blue || p.brandLogo?.blue || '',
    primaryColor: p.primaryColor || p.runtimeSettings?.branding.primaryColor || '',
  };
}

export function TenantProfilePage() {
  const tenant = useOperatingTenant();
  const [retained, setRetained] = useState<VersionedProfile | null>(null);
  const [values, setValues] = useState<FormValues | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [saved, setSaved] = useState(false);
  const pending = useRef<{
    expectedVersion: number;
    profile: EditableProfile;
    idempotencyKey: string;
  } | null>(null);
  const canEdit = tenant?.role === 'ADMIN';
  const load = async () => {
    if (!tenant) return;
    setBusy(true);
    setError('');
    try {
      const result = await platformApi.profile(tenant.id);
      setRetained(result);
      setValues(formValues(result));
      setDirty(false);
      setUncertain(false);
      pending.current = null;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Profile could not be loaded.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!tenant) return;
    const controller = new AbortController();
    void platformApi
      .profile(tenant.id, controller.signal)
      .then((result) => {
        setRetained(result);
        setValues(formValues(result));
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [tenant]);
  useEffect(() => {
    if (!dirty && !uncertain) return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const navigate = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (target && !window.confirm('Discard the unsaved tenant profile?')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', leave);
    document.addEventListener('click', navigate, true);
    return () => {
      window.removeEventListener('beforeunload', leave);
      document.removeEventListener('click', navigate, true);
    };
  }, [dirty, uncertain]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!tenant || !retained || !values || !canEdit || busy) return;
    if (!pending.current) {
      const { white, blue, primaryColor, secondaryColor, addressLines, declaredRole, ...identity } =
        values;
      if (!declaredRole) {
        setError('Select the declared operating role.');
        return;
      }
      if (
        (white || blue) &&
        !(
          white &&
          blue &&
          safeBrandUrl(white)?.startsWith('https:') &&
          safeBrandUrl(blue)?.startsWith('https:')
        )
      ) {
        setError('Use two HTTPS logo URLs, or leave both empty.');
        return;
      }
      pending.current = {
        expectedVersion: retained.version,
        profile: {
          ...identity,
          declaredRole,
          addressLines: addressLines
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
          ...(white && blue ? { brandLogos: { white, blue } } : {}),
          ...(primaryColor ? { primaryColor } : {}),
          ...(secondaryColor ? { secondaryColor } : {}),
        },
        idempotencyKey: crypto.randomUUID(),
      };
    }
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const result = await platformApi.saveProfile(tenant.id, pending.current);
      pending.current = null;
      setRetained(result);
      setValues(formValues(result));
      setDirty(false);
      setUncertain(false);
      setSaved(true);
    } catch (failure) {
      const ambiguous =
        !(failure instanceof PlatformError) || failure.status >= 500 || failure.status === 0;
      if (!ambiguous) pending.current = null;
      setUncertain(ambiguous);
      setError(failure instanceof Error ? failure.message : 'Profile save could not be confirmed.');
    } finally {
      setBusy(false);
    }
  };
  if (!tenant) return <p role="alert">Select an authorized operating tenant first.</p>;
  const update = (name: keyof FormValues, value: string) => {
    setValues((current) => (current ? { ...current, [name]: value } : null));
    setDirty(true);
    setSaved(false);
  };
  const input = (name: keyof FormValues, label: string, type = 'text', required = true) => (
    <label className="font-bold text-sm">
      {label}
      <Input
        name={name}
        type={type}
        required={required}
        value={values?.[name] || ''}
        onChange={(event) => update(name, event.target.value)}
        className="ui-input mt-2"
        {...(name === 'primaryColor' || name === 'secondaryColor'
          ? { pattern: '#[a-fA-F0-9]{6}', placeholder: '#RRGGBB' }
          : {})}
      />
    </label>
  );
  return (
    <div className="ui-page space-y-6">
      <header>
        <p className="text-xs uppercase tracking-widest text-slate-500 font-bold">
          Workspace settings
        </p>
        <h1 className="text-3xl font-black mt-2">Tenant profile</h1>
        <p className="text-slate-600 mt-3">
          Branding and contact details for {tenant.displayName}. The declared operating role does
          not establish delegated authority. These settings do not alter product rates or historical
          insurance evidence.
        </p>
      </header>
      {error && (
        <div className="rounded-xl bg-rose-50 text-rose-900 p-4" role="alert">
          {error}
          {uncertain && (
            <p className="mt-2">
              The save may have completed. Retry the unchanged request, or reload the retained
              profile to reconcile it.
            </p>
          )}
        </div>
      )}
      {saved && (
        <div className="rounded-xl bg-emerald-50 text-emerald-900 p-4" role="status">
          Profile version {retained?.version} saved.{' '}
          <Button
            type="button"
            className="underline font-bold"
            onClick={() => window.location.reload()}
          >
            Reload workspace branding
          </Button>
        </div>
      )}
      <form onSubmit={save} className="ui-card ui-card-pad space-y-6">
        {!canEdit && (
          <p className="text-sm text-slate-600">
            Inspection only. An authorized tenant administrator can update this profile.
          </p>
        )}
        {!values ? (
          <p role="status">Loading retained profile…</p>
        ) : (
          <fieldset
            disabled={!canEdit || busy || uncertain}
            className="grid grid-cols-1 md:grid-cols-2 gap-5"
          >
            <legend className="sr-only">Tenant branding and contact</legend>
            {input('displayName', 'Trading / workspace name')}
            {input('legalName', 'Registered legal name')}
            <label className="font-bold text-sm">
              Declared operating role
              <Select
                required
                name="declaredRole"
                className="ui-input mt-2"
                value={values.declaredRole}
                onChange={(event) => update('declaredRole', event.target.value)}
              >
                <option value="" disabled>
                  Select the declared role
                </option>
                <option value="MGA">Managing general agent</option>
                <option value="BROKER">Insurance broker</option>
                <option value="COVERHOLDER">Coverholder</option>
              </Select>
            </label>
            {input('locale', 'Workspace locale')}
            {input('timeZone', 'Business time zone')}
            <label className="font-bold text-sm md:col-span-2">
              Office address
              <Textarea
                name="addressLines"
                required
                rows={3}
                value={values.addressLines}
                onChange={(event) => update('addressLines', event.target.value)}
                className="ui-input mt-2"
              />
            </label>
            {input('contactEmail', 'Contact email', 'email')}
            {input('contactPhone', 'Contact phone', 'tel')}
            {input('primaryColor', 'Primary color', 'text', false)}
            {input('secondaryColor', 'Secondary color', 'text', false)}
            {input('white', 'Logo for dark backgrounds (HTTPS)', 'url', false)}
            {input('blue', 'Logo for light backgrounds (HTTPS)', 'url', false)}
          </fieldset>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            disabled={!canEdit || busy || !values || (!dirty && !uncertain)}
            className="rounded-xl bg-slate-900 px-5 py-3 text-white font-bold disabled:opacity-50"
          >
            {busy ? 'Saving…' : uncertain ? 'Retry unchanged save' : 'Save tenant profile'}
          </Button>
          <Button
            type="button"
            disabled={busy}
            className="rounded-xl border border-slate-300 px-5 py-3"
            onClick={() => {
              if (
                (!dirty && !uncertain) ||
                window.confirm('Reload the retained profile and discard this draft?')
              )
                void load();
            }}
          >
            Reload retained profile
          </Button>
        </div>
      </form>
      <section className="ui-card ui-card-pad">
        <h2 className="text-xl font-black">Operating configuration</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-5 text-sm">
          {Object.entries({
            Country: tenant.profile.country,
            Currency: tenant.profile.currency,
            'Legal pack': tenant.profile.legalPack,
            'Public base URL': tenant.profile.publicBaseUrl,
            'Tenant identifier': tenant.tenantSlug,
            'Profile version': retained?.version ?? 'Loading',
          }).map(([label, value]) => (
            <div key={label}>
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-bold mt-1 break-all">{String(value)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-slate-600 mt-5">
          Product, binder, questionnaire and workflow settings remain in their existing Workspace
          Settings screens. Jurisdiction and template authority are validated by the server; they
          are not changed by this profile form.
        </p>
      </section>
    </div>
  );
}

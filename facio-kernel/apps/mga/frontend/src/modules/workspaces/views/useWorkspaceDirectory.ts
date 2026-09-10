import { useEffect, useRef, useState } from 'react';
import { platformApi, type PlatformSession, type TenantTemplate } from '../api/platformClient';

/** Cursor pages are discovery only. Every selection is authorized again by the server. */
export function useWorkspaceDirectory(session: PlatformSession) {
  const [tenants, setTenants] = useState(session.tenants);
  const [organizations, setOrganizations] = useState(session.organizations);
  const [tenantCursor, setTenantCursor] = useState(session.tenantNextCursor);
  const [organizationCursor, setOrganizationCursor] = useState(session.organizationNextCursor);
  const [tenantSearch, setTenantSearch] = useState('');
  const [organizationSearch, setOrganizationSearch] = useState('');
  const [templates, setTemplates] = useState<TenantTemplate[]>(session.templates);
  const [organizationId, setOrganizationId] = useState('');
  const [loading, setLoading] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const applied = useRef({ tenants: '', organizations: '' });
  useEffect(() => {
    epoch.current += 1;
    setTenants(session.tenants);
    setOrganizations(session.organizations);
    setTenantCursor(session.tenantNextCursor);
    setOrganizationCursor(session.organizationNextCursor);
    setTenantSearch('');
    setOrganizationSearch('');
    applied.current = { tenants: '', organizations: '' };
    setLoading(false);
  }, [session]);
  useEffect(() => {
    if (!organizationId) {
      setTemplates(session.templates);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setTemplates([]);
    setTemplateLoading(true);
    setError('');
    void platformApi
      .templates(organizationId, controller.signal)
      .then((result) => {
        if (active) setTemplates(result.templates);
      })
      .catch((failure: unknown) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Registered templates could not be loaded.',
          );
      })
      .finally(() => {
        if (active) setTemplateLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [organizationId, session.templates]);
  const load = async (kind: 'tenants' | 'organizations', append: boolean) => {
    const current = ++epoch.current;
    setLoading(true);
    setError('');
    const search = append
      ? applied.current[kind]
      : (kind === 'tenants' ? tenantSearch : organizationSearch).trim();
    const cursor = append ? (kind === 'tenants' ? tenantCursor : organizationCursor) : undefined;
    try {
      if (kind === 'tenants') {
        const result = await platformApi.tenants({
          ...(cursor ? { cursor } : {}),
          ...(search ? { search } : {}),
        });
        if (current !== epoch.current) return;
        setTenants((previous) =>
          append
            ? [...new Map([...previous, ...result.tenants].map((item) => [item.id, item])).values()]
            : result.tenants,
        );
        setTenantCursor(result.nextCursor);
      } else {
        const result = await platformApi.organizations({
          ...(cursor ? { cursor } : {}),
          ...(search ? { search } : {}),
        });
        if (current !== epoch.current) return;
        setOrganizations((previous) =>
          append
            ? [
                ...new Map(
                  [...previous, ...result.organizations].map((item) => [item.id, item]),
                ).values(),
              ]
            : result.organizations,
        );
        setOrganizationCursor(result.nextCursor);
      }
      applied.current[kind] = search;
    } catch (failure) {
      if (current === epoch.current)
        setError(failure instanceof Error ? failure.message : 'Directory could not be loaded.');
    } finally {
      if (current === epoch.current) setLoading(false);
    }
  };
  return {
    tenants,
    organizations,
    tenantCursor,
    organizationCursor,
    tenantSearch,
    setTenantSearch,
    organizationSearch,
    setOrganizationSearch,
    templates,
    organizationId,
    setOrganizationId,
    loading,
    templateLoading,
    error,
    load,
  };
}

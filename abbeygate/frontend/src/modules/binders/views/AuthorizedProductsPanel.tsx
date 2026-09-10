/**
 * Binder "Authorized Products" panel.
 *
 * Every binder in a Lloyd's-grade setup must explicitly declare the products
 * (lines of business) it underwrites. Each row in this panel corresponds to a
 * `BinderProductAuthority` record and drives:
 *   - Policy binding guard (a policy's productType must match an ACTIVE authority)
 *   - BDX per-(binder × product) segmentation + class-of-business mapping
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Select, StatusPill, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/src/shared/ui';
import { http } from '@/src/shared/api/http';

type AuthorityRow = {
  id: string;
  binderId: string;
  productCode: string;
  classOfBusiness: string;
  riskCode?: string | null;
  territorialScope: string[];
  maxPremiumAnnual?: string | number | null;
  maxPolicyPeriodDays?: number | null;
  maxAdvanceInceptionDays?: number | null;
  authorityClasses: string[];
  status: 'ACTIVE' | 'SUSPENDED' | string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  notes?: string | null;
  productDefinition?: { code: string; displayName: string; icon?: string | null } | null;
};

type NewAuthorityDraft = {
  productCode: string;
  classOfBusiness: string;
  riskCode: string;
  territorialScope: string;
  authorityClasses: string;
};

type ProductDefinitionOption = {
  code: string;
  displayName: string;
  icon?: string | null;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Request aborted');
  error.name = 'AbortError';
  throw error;
}

async function fetchAuthorities(binderId: string, signal?: AbortSignal): Promise<AuthorityRow[]> {
  const response = await http.request<AuthorityRow[]>(`binders/${encodeURIComponent(binderId)}/authorities`, { signal });
  throwIfAborted(signal);
  if (!response.success) throw new Error(response.error?.message || 'Failed to load authorities');
  return Array.isArray(response.data) ? response.data : [];
}

async function fetchActiveProductDefinitions(signal?: AbortSignal): Promise<ProductDefinitionOption[]> {
  const response = await http.request<ProductDefinitionOption[]>('products', { signal });
  throwIfAborted(signal);
  if (!response.success) throw new Error(response.error?.message || 'Failed to load product definitions');
  return Array.isArray(response.data) ? response.data : [];
}

async function createAuthority(binderId: string, draft: NewAuthorityDraft): Promise<AuthorityRow> {
  const response = await http.request<AuthorityRow>(`binders/${encodeURIComponent(binderId)}/authorities`, {
    method: 'POST',
    body: JSON.stringify({
      productCode: draft.productCode.trim().toUpperCase(),
      classOfBusiness: draft.classOfBusiness.trim().toUpperCase(),
      riskCode: draft.riskCode.trim() || undefined,
      territorialScope: draft.territorialScope.split(',').map((s) => s.trim()).filter(Boolean),
      authorityClasses: draft.authorityClasses.split(',').map((s) => s.trim()).filter(Boolean),
    }),
  });
  if (!response.success || !response.data) throw new Error(response.error?.message || 'Failed to create authority');
  return response.data;
}

async function patchAuthority(binderId: string, productCode: string, patch: Partial<AuthorityRow>): Promise<AuthorityRow> {
  const response = await http.request<AuthorityRow>(`binders/${encodeURIComponent(binderId)}/authorities/${encodeURIComponent(productCode)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!response.success || !response.data) throw new Error(response.error?.message || 'Failed to update authority');
  return response.data;
}

export function AuthorizedProductsPanel({ binderId }: { binderId: string }) {
  const [rows, setRows] = useState<AuthorityRow[]>([]);
  const [products, setProducts] = useState<ProductDefinitionOption[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<NewAuthorityDraft>({
    productCode: '',
    classOfBusiness: '',
    riskCode: '',
    territorialScope: 'CY',
    authorityClasses: '',
  });

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAuthorities(binderId, signal);
      setRows(data);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setError((err as Error)?.message || 'Failed to load authorities');
    } finally {
      setLoading(false);
    }
  }, [binderId]);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  useEffect(() => {
    const ctrl = new AbortController();
    const loadProducts = async () => {
      try {
        setProductsLoading(true);
        const data = await fetchActiveProductDefinitions(ctrl.signal);
        setProducts(data);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setError((err as Error)?.message || 'Failed to load product definitions');
      } finally {
        setProductsLoading(false);
      }
    };
    void loadProducts();
    return () => ctrl.abort();
  }, []);

  const handleCreate = async () => {
    try {
      await createAuthority(binderId, draft);
      setDraft({ productCode: '', classOfBusiness: '', riskCode: '', territorialScope: 'CY', authorityClasses: '' });
      setShowAdd(false);
      await load();
    } catch (err) {
      setError((err as Error)?.message || 'Failed to create authority');
    }
  };

  const handleToggleStatus = async (row: AuthorityRow) => {
    try {
      await patchAuthority(binderId, row.productCode, {
        status: row.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
      });
      await load();
    } catch (err) {
      setError((err as Error)?.message || 'Failed to update authority');
    }
  };

  const availableProducts = products.filter((product) => !rows.some((row) => row.productCode === product.code));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-2xl font-black text-slate-900 tracking-tight">Authorized products</div>
          <div className="text-sm text-slate-500 font-semibold mt-1">
            Declare which products this binder underwrites. Policies cannot bind unless a matching ACTIVE authority exists.
          </div>
        </div>
        <Button onClick={() => setShowAdd((v) => !v)} variant="secondary">
          {showAdd ? 'Cancel' : 'Add authority'}
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
          {error}
        </div>
      )}

      {showAdd && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
          <Select
            aria-label="Product definition"
            value={draft.productCode}
            onChange={(e) => setDraft((d) => ({ ...d, productCode: e.target.value }))}
            disabled={productsLoading || availableProducts.length === 0}
          >
            <option value="">{productsLoading ? 'Loading products…' : 'Choose a product'}</option>
            {availableProducts.map((product) => (
              <option key={product.code} value={product.code}>{product.displayName} ({product.code})</option>
            ))}
          </Select>
          <Input placeholder="Class of business" value={draft.classOfBusiness} onChange={(e) => setDraft((d) => ({ ...d, classOfBusiness: e.target.value }))} />
          <Input placeholder="Risk code" value={draft.riskCode} onChange={(e) => setDraft((d) => ({ ...d, riskCode: e.target.value }))} />
          <Input placeholder="Territory scope (CY, PT)" value={draft.territorialScope} onChange={(e) => setDraft((d) => ({ ...d, territorialScope: e.target.value }))} />
          <Input placeholder="Authority classes" value={draft.authorityClasses} onChange={(e) => setDraft((d) => ({ ...d, authorityClasses: e.target.value }))} />
          {!productsLoading && availableProducts.length === 0 ? (
            <p className="md:col-span-5 text-sm font-semibold text-slate-600">Every active product definition is already assigned to this binder.</p>
          ) : null}
          <div className="md:col-span-5 flex justify-end">
            <Button onClick={handleCreate} disabled={!draft.productCode.trim() || !draft.classOfBusiness.trim()}>Create</Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm font-semibold text-slate-500">Loading authorities…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          This binder has no product authorities. Policies cannot bind against it until at least one authority is added.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Class of business</TableHead>
              <TableHead>Risk code</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="font-extrabold">{row.productCode}</div>
                  <div className="text-xs text-slate-500">{row.productDefinition?.displayName || ''}</div>
                </TableCell>
                <TableCell>{row.classOfBusiness}</TableCell>
                <TableCell>{row.riskCode || '—'}</TableCell>
                <TableCell>{Array.isArray(row.territorialScope) && row.territorialScope.length ? row.territorialScope.join(', ') : '—'}</TableCell>
                <TableCell>
                  <StatusPill tone={row.status === 'ACTIVE' ? 'success' : 'warning'} label={row.status} />
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" onClick={() => handleToggleStatus(row)}>
                    {row.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

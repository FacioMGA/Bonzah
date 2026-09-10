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
  maxPremiumAnnual: string;
  maxPolicyPeriodDays: string;
  maxAdvanceInceptionDays: string;
  authorityClasses: string;
  effectiveFrom: string;
  effectiveTo: string;
  originalEffectiveFrom?: string;
  originalEffectiveTo?: string;
  notes: string;
};

type AuthorityPayload = {
  classOfBusiness: string;
  riskCode?: string;
  territorialScope: string[];
  maxPremiumAnnual?: number;
  maxPolicyPeriodDays?: number;
  maxAdvanceInceptionDays?: number;
  authorityClasses: string[];
  effectiveFrom?: string;
  effectiveTo?: string;
  notes?: string;
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

function emptyDraft(): NewAuthorityDraft {
  return {
    productCode: '',
    classOfBusiness: '',
    riskCode: '',
    territorialScope: 'CY',
    maxPremiumAnnual: '',
    maxPolicyPeriodDays: '',
    maxAdvanceInceptionDays: '',
    authorityClasses: '',
    effectiveFrom: '',
    effectiveTo: '',
    notes: '',
  };
}

function dateInputValue(value?: string | null): string {
  return value ? value.slice(0, 10) : '';
}

function optionalNumber(value: string, field: string, options: { integer?: boolean; positive?: boolean } = {}): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (options.positive && parsed <= 0) || (options.integer && !Number.isInteger(parsed))) {
    throw new Error(`${field} must be ${options.positive ? 'a positive' : 'a non-negative'}${options.integer ? ' whole' : ''} number.`);
  }
  return parsed;
}

function dateForPayload(value: string, original?: string): string | undefined {
  if (!value) return undefined;
  return original && dateInputValue(original) === value
    ? original
    : `${value}T00:00:00.000Z`;
}

function toAuthorityPayload(draft: NewAuthorityDraft): AuthorityPayload {
  const effectiveFrom = dateForPayload(draft.effectiveFrom, draft.originalEffectiveFrom);
  const effectiveTo = dateForPayload(draft.effectiveTo, draft.originalEffectiveTo);
  if (effectiveFrom && effectiveTo && new Date(effectiveFrom).getTime() > new Date(effectiveTo).getTime()) {
    throw new Error('Effective from must be on or before effective to.');
  }
  return {
    classOfBusiness: draft.classOfBusiness.trim().toUpperCase(),
    riskCode: draft.riskCode.trim(),
    territorialScope: draft.territorialScope.split(',').map((scope) => scope.trim()).filter(Boolean),
    maxPremiumAnnual: optionalNumber(draft.maxPremiumAnnual, 'Annual premium limit'),
    maxPolicyPeriodDays: optionalNumber(draft.maxPolicyPeriodDays, 'Policy-period limit', { integer: true, positive: true }),
    maxAdvanceInceptionDays: optionalNumber(draft.maxAdvanceInceptionDays, 'Advance-inception limit', { integer: true }),
    authorityClasses: draft.authorityClasses.split(',').map((authorityClass) => authorityClass.trim()).filter(Boolean),
    effectiveFrom,
    effectiveTo,
    notes: draft.notes.trim(),
  };
}

function authorityDraft(row?: AuthorityRow): NewAuthorityDraft {
  if (!row) return emptyDraft();
  return {
    productCode: row.productCode,
    classOfBusiness: row.classOfBusiness,
    riskCode: row.riskCode || '',
    territorialScope: row.territorialScope.join(', '),
    maxPremiumAnnual: row.maxPremiumAnnual == null ? '' : String(row.maxPremiumAnnual),
    maxPolicyPeriodDays: row.maxPolicyPeriodDays == null ? '' : String(row.maxPolicyPeriodDays),
    maxAdvanceInceptionDays: row.maxAdvanceInceptionDays == null ? '' : String(row.maxAdvanceInceptionDays),
    authorityClasses: row.authorityClasses.join(', '),
    effectiveFrom: dateInputValue(row.effectiveFrom),
    effectiveTo: dateInputValue(row.effectiveTo),
    originalEffectiveFrom: row.effectiveFrom || undefined,
    originalEffectiveTo: row.effectiveTo || undefined,
    notes: row.notes || '',
  };
}

async function createAuthority(binderId: string, draft: NewAuthorityDraft): Promise<AuthorityRow> {
  const response = await http.request<AuthorityRow>(`binders/${encodeURIComponent(binderId)}/authorities`, {
    method: 'POST',
    body: JSON.stringify({
      productCode: draft.productCode.trim().toUpperCase(),
      ...toAuthorityPayload(draft),
    }),
  });
  if (!response.success || !response.data) throw new Error(response.error?.message || 'Failed to create authority');
  return response.data;
}

async function patchAuthority(binderId: string, productCode: string, patch: Partial<AuthorityPayload> & { status?: AuthorityRow['status'] }): Promise<AuthorityRow> {
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
  const [draft, setDraft] = useState<NewAuthorityDraft>(emptyDraft);
  const [editingRow, setEditingRow] = useState<AuthorityRow | null>(null);

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
      setDraft(emptyDraft());
      setShowAdd(false);
      await load();
    } catch (err) {
      setError((err as Error)?.message || 'Failed to create authority');
    }
  };

  const handleEdit = (row: AuthorityRow) => {
    setError(null);
    setShowAdd(false);
    setEditingRow(row);
    setDraft(authorityDraft(row));
  };

  const handleSaveEdit = async () => {
    if (!editingRow) return;
    if ((editingRow.maxPremiumAnnual != null && !draft.maxPremiumAnnual.trim())
      || (editingRow.maxPolicyPeriodDays != null && !draft.maxPolicyPeriodDays.trim())
      || (editingRow.maxAdvanceInceptionDays != null && !draft.maxAdvanceInceptionDays.trim())
      || (editingRow.effectiveFrom && !draft.effectiveFrom)
      || (editingRow.effectiveTo && !draft.effectiveTo)) {
      setError('This authority API supports replacing limits and dates, but not clearing an existing limit or effective date. Enter a replacement value instead.');
      return;
    }
    try {
      await patchAuthority(binderId, editingRow.productCode, toAuthorityPayload(draft));
      setEditingRow(null);
      setDraft(emptyDraft());
      await load();
    } catch (err) {
      setError((err as Error)?.message || 'Failed to update authority');
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
        <Button onClick={() => {
          setEditingRow(null);
          setShowAdd((wasOpen) => {
            if (!wasOpen) setDraft(emptyDraft());
            return !wasOpen;
          });
        }} variant="secondary">
          {showAdd ? 'Cancel' : 'Add authority'}
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
          {error}
        </div>
      )}

      {showAdd && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
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
          <Input aria-label="Annual premium limit" type="number" min="0" placeholder="Annual premium limit" value={draft.maxPremiumAnnual} onChange={(e) => setDraft((d) => ({ ...d, maxPremiumAnnual: e.target.value }))} />
          <Input aria-label="Maximum policy period days" type="number" min="1" step="1" placeholder="Maximum policy period days" value={draft.maxPolicyPeriodDays} onChange={(e) => setDraft((d) => ({ ...d, maxPolicyPeriodDays: e.target.value }))} />
          <Input aria-label="Maximum advance inception days" type="number" min="0" step="1" placeholder="Maximum advance inception days" value={draft.maxAdvanceInceptionDays} onChange={(e) => setDraft((d) => ({ ...d, maxAdvanceInceptionDays: e.target.value }))} />
          <Input aria-label="Effective from" type="date" value={draft.effectiveFrom} onChange={(e) => setDraft((d) => ({ ...d, effectiveFrom: e.target.value }))} />
          <Input aria-label="Effective to" type="date" value={draft.effectiveTo} onChange={(e) => setDraft((d) => ({ ...d, effectiveTo: e.target.value }))} />
          <Input aria-label="Authority notes" placeholder="Authority notes" value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
          {!productsLoading && availableProducts.length === 0 ? (
            <p className="md:col-span-3 text-sm font-semibold text-slate-600">Every active product definition is already assigned to this binder.</p>
          ) : null}
          <div className="md:col-span-3 flex justify-end">
            <Button onClick={handleCreate} disabled={!draft.productCode.trim() || !draft.classOfBusiness.trim()}>Create</Button>
          </div>
        </div>
      )}

      {editingRow && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-3 text-sm font-bold text-slate-700">
            Editing {editingRow.productCode}. The product itself is fixed to preserve its canonical authority record.
          </div>
          <Input placeholder="Class of business" value={draft.classOfBusiness} onChange={(e) => setDraft((d) => ({ ...d, classOfBusiness: e.target.value }))} />
          <Input placeholder="Risk code" value={draft.riskCode} onChange={(e) => setDraft((d) => ({ ...d, riskCode: e.target.value }))} />
          <Input placeholder="Territory scope (CY, PT)" value={draft.territorialScope} onChange={(e) => setDraft((d) => ({ ...d, territorialScope: e.target.value }))} />
          <Input placeholder="Authority classes" value={draft.authorityClasses} onChange={(e) => setDraft((d) => ({ ...d, authorityClasses: e.target.value }))} />
          <Input aria-label="Annual premium limit" type="number" min="0" placeholder="Annual premium limit" value={draft.maxPremiumAnnual} onChange={(e) => setDraft((d) => ({ ...d, maxPremiumAnnual: e.target.value }))} />
          <Input aria-label="Maximum policy period days" type="number" min="1" step="1" placeholder="Maximum policy period days" value={draft.maxPolicyPeriodDays} onChange={(e) => setDraft((d) => ({ ...d, maxPolicyPeriodDays: e.target.value }))} />
          <Input aria-label="Maximum advance inception days" type="number" min="0" step="1" placeholder="Maximum advance inception days" value={draft.maxAdvanceInceptionDays} onChange={(e) => setDraft((d) => ({ ...d, maxAdvanceInceptionDays: e.target.value }))} />
          <Input aria-label="Effective from" type="date" value={draft.effectiveFrom} onChange={(e) => setDraft((d) => ({ ...d, effectiveFrom: e.target.value }))} />
          <Input aria-label="Effective to" type="date" value={draft.effectiveTo} onChange={(e) => setDraft((d) => ({ ...d, effectiveTo: e.target.value }))} />
          <Input aria-label="Authority notes" placeholder="Authority notes" value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
          <div className="md:col-span-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setEditingRow(null); setDraft(emptyDraft()); }}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={!draft.classOfBusiness.trim()}>Save authority</Button>
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
              <TableHead>Authority terms</TableHead>
              <TableHead>Effective period</TableHead>
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
                  <div className="text-xs font-semibold text-slate-700 space-y-1">
                    <div>Annual premium: {row.maxPremiumAnnual == null ? '—' : row.maxPremiumAnnual}</div>
                    <div>Policy period: {row.maxPolicyPeriodDays == null ? '—' : `${row.maxPolicyPeriodDays} days`}</div>
                    <div>Advance inception: {row.maxAdvanceInceptionDays == null ? '—' : `${row.maxAdvanceInceptionDays} days`}</div>
                    <div>Classes: {row.authorityClasses.length ? row.authorityClasses.join(', ') : '—'}</div>
                  </div>
                </TableCell>
                <TableCell className="text-xs font-semibold text-slate-700">
                  <div>{dateInputValue(row.effectiveFrom) || '—'}</div>
                  <div>{dateInputValue(row.effectiveTo) || '—'}</div>
                </TableCell>
                <TableCell>
                  <StatusPill tone={row.status === 'ACTIVE' ? 'success' : 'warning'} label={row.status} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => handleEdit(row)}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => handleToggleStatus(row)}>
                      {row.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

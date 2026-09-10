/**
 * PermissionMatrix
 *
 * Domain × Action toggle grid for role permission editing.
 *
 * DESIGN:
 * - Rows   = permission domains (Policies, Claims, Billing…)
 * - Cols   = actions within each domain (view, create, edit, bind…)
 * - Cell   = Toggle pill: enabled (indigo), disabled (slate), not-applicable (empty)
 * - SYSTEM roles: all toggles disabled with lock indicator
 * - Constraints: cells with constraint hints show a ⚙ popover button
 *
 * The component is fully controlled — parent manages `enabledIds` set.
 */
import React from 'react';

export type PermissionDef = {
  id: string;
  resource: string;
  action: string;
  displayName: string;
  description: string;
  constraints?: Record<string, unknown> | null;
};

interface Props {
  permissions: PermissionDef[];        // All available permissions (full catalogue)
  enabledIds: Set<string>;             // Permission IDs currently granted to this role
  readOnly?: boolean;                  // SYSTEM roles: read-only
  onChange?: (enabledIds: Set<string>) => void;
  // Optional constraint state
  constraintValues?: Record<string, Record<string, unknown>>; // permId → constraint values
  onConstraintChange?: (permId: string, values: Record<string, unknown>) => void;
}

/** Group permissions by domain (resource) */
function groupByDomain(permissions: PermissionDef[]): Map<string, PermissionDef[]> {
  const map = new Map<string, PermissionDef[]>();
  for (const p of permissions) {
    const existing = map.get(p.resource) ?? [];
    map.set(p.resource, [...existing, p]);
  }
  return map;
}

const DOMAIN_ICONS: Record<string, string> = {
  policies:     'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  claims:       'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  billing:      'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  endorsements: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  documents:    'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z',
  users:        'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  programs:     'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
  binders:      'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  reports:      'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  settings:     'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
};

const DEFAULT_ICON = 'M4 6h16M4 10h16M4 14h16M4 18h16';

function ActionToggle({
  perm,
  enabled,
  readOnly,
  onToggle,
  constraintValues,
  onConstraintChange,
}: {
  perm: PermissionDef;
  enabled: boolean;
  readOnly: boolean;
  onToggle: () => void;
  constraintValues?: Record<string, unknown>;
  onConstraintChange?: (values: Record<string, unknown>) => void;
}) {
  const [constraintOpen, setConstraintOpen] = React.useState(false);
  const hasConstraints = !!perm.constraints && Object.keys(perm.constraints).length > 0;

  return (
    <div className="flex items-center gap-1.5 group relative">
      {/* Toggle pill */}
      <button
        type="button"
        onClick={readOnly ? undefined : onToggle}
        disabled={readOnly}
        title={readOnly ? `${perm.displayName} — system role (read-only)` : perm.description}
        className={`
          flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all duration-150
          ${readOnly ? 'cursor-default opacity-80' : 'cursor-pointer'}
          ${enabled
            ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300'
            : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
          }
        `}
      >
        {/* LED dot */}
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${enabled ? 'bg-indigo-500' : 'bg-slate-300'}`} />
        {/* Action label — capitalize first char */}
        <span>{perm.action.replace(/_/g, ' ')}</span>
        {/* Lock icon for read-only */}
        {readOnly && (
          <svg className="w-3 h-3 opacity-40 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
          </svg>
        )}
      </button>

      {/* Constraint button (visible only when enabled + has constraints) */}
      {hasConstraints && enabled && !readOnly && (
        <button
          type="button"
          onClick={() => setConstraintOpen((o) => !o)}
          className="p-1 rounded-md text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors flex-shrink-0"
          title="Edit constraints"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
        </button>
      )}

      {/* Constraint popover */}
      {constraintOpen && hasConstraints && perm.constraints && (
        <div className="absolute top-8 left-0 z-40 bg-white border border-slate-200 rounded-xl shadow-xl p-4 w-56">
          <p className="text-xs font-bold text-slate-700 mb-3">Constraints — {perm.displayName}</p>
          <div className="space-y-3">
            {'maxAmount' in perm.constraints && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Max Amount (£)</label>
                <input
                  type="number"
                  value={String(constraintValues?.maxAmount ?? perm.constraints.maxAmount ?? '')}
                  onChange={(e) => onConstraintChange?.({ ...constraintValues, maxAmount: Number(e.target.value) })}
                  className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="e.g. 5000"
                />
              </div>
            )}
            {'requiresApproval' in perm.constraints && (
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-600">Requires Approval</label>
                <button
                  type="button"
                  onClick={() => onConstraintChange?.({ ...constraintValues, requiresApproval: !(constraintValues?.requiresApproval ?? perm.constraints?.requiresApproval) })}
                  className={`w-9 h-5 rounded-full transition-colors ${constraintValues?.requiresApproval ?? perm.constraints.requiresApproval ? 'bg-indigo-500' : 'bg-slate-200'}`}
                >
                  <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${constraintValues?.requiresApproval ?? perm.constraints.requiresApproval ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => setConstraintOpen(false)}
            className="mt-3 w-full text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

export function PermissionMatrix({ permissions, enabledIds, readOnly = false, onChange, constraintValues, onConstraintChange }: Props) {
  const grouped = React.useMemo(() => groupByDomain(permissions), [permissions]);

  const toggle = (permId: string) => {
    if (readOnly || !onChange) return;
    const next = new Set(enabledIds);
    if (next.has(permId)) next.delete(permId);
    else next.add(permId);
    onChange(next);
  };

  const enabledCount = enabledIds.size;
  const totalCount = permissions.length;

  return (
    <div className="space-y-0">
      {/* Status bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-300"
              style={{ width: `${totalCount > 0 ? (enabledCount / totalCount) * 100 : 0}%` }}
            />
          </div>
          <span className="text-xs text-slate-500">
            <strong className="text-slate-800">{enabledCount}</strong> / {totalCount} permissions enabled
          </span>
        </div>
        {!readOnly && onChange && enabledCount > 0 && (
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="text-xs text-slate-400 hover:text-red-500 transition-colors font-medium"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Domain groups */}
      <div className="space-y-3">
        {Array.from(grouped.entries()).map(([domain, perms]) => {
          const domainEnabledCount = perms.filter((p) => enabledIds.has(p.id)).length;
          const allEnabled = domainEnabledCount === perms.length;
          const someEnabled = domainEnabledCount > 0 && !allEnabled;

          return (
            <div key={domain} className="border border-slate-100 rounded-xl overflow-hidden">
              {/* Domain header */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={DOMAIN_ICONS[domain] ?? DEFAULT_ICON} />
                  </svg>
                  <span className="text-xs font-bold text-slate-700 capitalize">{domain}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                    allEnabled ? 'bg-indigo-100 text-indigo-600' : someEnabled ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-400'
                  }`}>
                    {domainEnabledCount}/{perms.length}
                  </span>
                </div>
                {/* Domain-level toggle-all (edit mode only) */}
                {!readOnly && onChange && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = new Set(enabledIds);
                      if (allEnabled) perms.forEach((p) => next.delete(p.id));
                      else perms.forEach((p) => next.add(p.id));
                      onChange(next);
                    }}
                    className="text-[10px] font-semibold text-slate-400 hover:text-indigo-600 transition-colors px-2 py-0.5 rounded hover:bg-indigo-50"
                  >
                    {allEnabled ? 'Disable all' : 'Enable all'}
                  </button>
                )}
              </div>

              {/* Action pills */}
              <div className="px-4 py-3 flex flex-wrap gap-2">
                {perms.map((perm) => (
                  <ActionToggle
                    key={perm.id}
                    perm={perm}
                    enabled={enabledIds.has(perm.id)}
                    readOnly={readOnly}
                    onToggle={() => toggle(perm.id)}
                    constraintValues={constraintValues?.[perm.id]}
                    onConstraintChange={(vals) => onConstraintChange?.(perm.id, vals)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

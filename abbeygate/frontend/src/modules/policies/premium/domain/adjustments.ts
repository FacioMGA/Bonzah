import { asRecord } from '@/src/shared/lib/record';
export type Adjustment = {
  id?: string;
  lineType?: 'pricing' | 'schedule_note' | string;
  name?: string;
  type?: string;
  mode?: 'pct' | 'amount' | string;
  value?: number | string;
  reason?: string;
  reasonText?: string;
  scopeType?: 'policy' | 'coverage' | string;
  scopeRef?: string;
  schedulePresentation?: 'inherent' | 'separate_line' | string;
  endorsementId?: string | null;
  category?: 'EXCLUSION' | 'SUB_LIMIT' | 'CONDITION_WARRANTY' | 'OTHER' | string;
  text?: string;
};

export function parseAdjustments(qd: Record<string, unknown>): Adjustment[] {
  const rawAdj = qd.uwAdjustments;
  const compatAdj = asRecord(qd.uwAdjustment);
  if (Array.isArray(rawAdj)) return rawAdj as Adjustment[];
  if (compatAdj.type || compatAdj.value) return [compatAdj as Adjustment];
  return [];
}

export function makeAdjustmentId(): string {
  return `adj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeAdjustment(adj: Adjustment, idx: number): Adjustment {
  const lineTypeRaw = String(adj.lineType || '').toLowerCase();
  const lineType = lineTypeRaw === 'schedule_note' ? 'schedule_note' : 'pricing';
  const typeRaw = String(adj.type || '').toLowerCase();
  const type = typeRaw === 'loading' ? 'loading' : 'discount';
  const modeRaw = String(adj.mode || '').toLowerCase();
  const mode = modeRaw === 'amount' ? 'amount' : 'pct';
  const valueRaw = adj.value ?? 0;
  const valueNum = Number(valueRaw);
  const value = Number.isFinite(valueNum) ? valueNum : 0;
  const reason = String(adj.reasonText || adj.reason || '').trim();
  const scopeTypeRaw = String(adj.scopeType || '').toLowerCase();
  const scopeType = scopeTypeRaw === 'coverage' ? 'coverage' : 'policy';
  const scopeRef = String(adj.scopeRef || '').trim();
  const schedulePresentationRaw = String(adj.schedulePresentation || '').toLowerCase();
  const schedulePresentation = schedulePresentationRaw === 'separate_line' ? 'separate_line' : 'inherent';
  const categoryRaw = String(adj.category || '').toUpperCase();
  const category = ['EXCLUSION', 'SUB_LIMIT', 'CONDITION_WARRANTY', 'OTHER'].includes(categoryRaw)
    ? categoryRaw
    : 'OTHER';
  const text = String(adj.text || '').trim();
  const name = String(adj.name || reason || `Adjustment ${idx + 1}`).trim();
  const id = String(adj.id || '').trim() || makeAdjustmentId();
  return {
    id,
    lineType,
    name,
    type,
    mode,
    value,
    reason,
    reasonText: reason,
    scopeType,
    scopeRef,
    schedulePresentation,
    endorsementId: adj.endorsementId ? String(adj.endorsementId) : null,
    category,
    text,
  };
}

export function normalizeAdjustments(adjs: Adjustment[]): Adjustment[] {
  return (adjs || []).map((adj, idx) => normalizeAdjustment(adj, idx));
}

export function needsPricingAdjustmentReason(qd: Record<string, unknown> | undefined): boolean {
  return parseAdjustments(asRecord(qd)).some((adj) => {
    const normalized = normalizeAdjustment(adj, 0);
    if (normalized.lineType === 'schedule_note') return false;
    return (
      (normalized.type === 'discount' || normalized.type === 'loading') &&
      Number.isFinite(Number(normalized.value)) &&
      Number(normalized.value) !== 0 &&
      !String(normalized.reasonText || normalized.reason || '').trim()
    );
  });
}

export function pricingScopeLabel(adj: Adjustment): string {
  if (String(adj.scopeType || '').toLowerCase() !== 'coverage') return 'Policy';
  const scopeRef = String(adj.scopeRef || '').toUpperCase();
  if (scopeRef === 'TPL') return 'TPL';
  if (scopeRef === 'OWN_DAMAGE') return 'Own Damage';
  return 'Coverage';
}

export function getNextAdjustmentName(qd: Record<string, unknown> | undefined): string {
  const normalized = normalizeAdjustments(parseAdjustments(asRecord(qd)));
  return `Adjustment ${normalized.length + 1}`;
}

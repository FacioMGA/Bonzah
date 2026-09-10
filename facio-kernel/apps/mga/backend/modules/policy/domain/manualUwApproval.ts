import { sha256Hex, stableStringify } from './hashes.js';

type UnknownRecord = object;

function parseRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function copyJson(value: unknown): UnknownRecord {
  return parseRecord(JSON.parse(JSON.stringify(parseRecord(value))));
}

/**
 * Coverage selection is persisted with operational provenance such as its
 * writer and last-save timestamp. Those values do not alter the cover an
 * underwriter approved, so they must not invalidate that approval. Keep the
 * risk fingerprint to the canonical selection intent only.
 */
function semanticCoverageSelection(value: unknown): UnknownRecord {
  const selection = parseRecord(value);
  return copyJson({
    programId: Reflect.get(selection, 'programId'),
    programCode: Reflect.get(selection, 'programCode'),
    selected: parseRecord(Reflect.get(selection, 'selected')),
    params: parseRecord(Reflect.get(selection, 'params')),
  });
}

/**
 * Manual approval is valid only for the underwriting inputs that can affect
 * the product decision. Program.updatedAt is deliberately excluded: opening
 * an unrelated configuration screen must not revoke a recorded decision.
 */
export function buildManualUwApprovalAuthority(args: {
  binderId: unknown;
  programId: unknown;
  /** Canonical BinderProductAuthority values that constrain this risk. */
  binderProductAuthority?: unknown;
  /** Published programme underwriting component used by the decision. */
  underwritingConfiguration?: unknown;
  /** Published programme workflow component used by the decision. */
  workflowConfiguration?: unknown;
  /** The canonical, rating-normalized MBE configuration. */
  normalizedMbeProductConfig: unknown;
}): UnknownRecord | null {
  const binderId = String(args.binderId || '').trim();
  const programId = String(args.programId || '').trim();
  if (!binderId || !programId) return null;
  return copyJson({
    binderId,
    programId,
    underwritingAuthority: {
      underwriting: args.underwritingConfiguration,
      // Rating resolves MBE configuration through its canonical normalizer.
      // Hash that semantic result, not the operational stored JSON that may
      // self-heal without changing the cover the underwriter approved.
      mbeProductConfig: args.normalizedMbeProductConfig,
      workflow: args.workflowConfiguration,
    },
    binderProductAuthority: args.binderProductAuthority,
  });
}

function deletePath(target: UnknownRecord, path: string): void {
  const parts = path.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return;
  let current: UnknownRecord = target;
  for (const part of parts.slice(0, -1)) {
    const next: unknown = Reflect.get(current, part);
    if (!next || typeof next !== 'object' || Array.isArray(next)) return;
    current = next;
  }
  Reflect.deleteProperty(current, parts[parts.length - 1]!);
}

/**
 * The underwriter's referral decision belongs to a specific risk. Customer
 * declarations that were outstanding at approval time are deliberately
 * excluded, but every other quote-data change requires a fresh referral.
 */
export function computeManualUwApprovedRiskHash(args: {
  quoteData: unknown;
  coverageSelection: unknown;
  authority: unknown;
  /** Canonical product-adapter UW analysis for the decision that was reviewed. */
  underwritingDecision?: unknown;
  customerCompletionPaths: readonly string[];
}): string {
  const approvedRisk = copyJson({
    quoteData: args.quoteData,
    coverageSelection: semanticCoverageSelection(args.coverageSelection),
    authority: args.authority,
    underwritingDecision: args.underwritingDecision,
  });
  for (const path of args.customerCompletionPaths) deletePath(approvedRisk, `quoteData.${path}`);
  return sha256Hex(stableStringify(approvedRisk));
}

export function isManualUwApprovalCurrent(args: {
  manualApproval: unknown;
  quoteData: unknown;
  coverageSelection: unknown;
  authority: unknown;
  underwritingDecision?: unknown;
  /** Current adapter-owned completion-only contract; a changed scope expires approval. */
  currentCustomerCompletionPaths?: readonly string[];
}): boolean {
  const approval = parseRecord(args.manualApproval);
  const approvedRiskHash = String(Reflect.get(approval, 'approvedRiskHash') || '').trim();
  const approvalPaths: unknown = Reflect.get(approval, 'customerCompletionPaths');
  const customerCompletionPaths = Array.isArray(approvalPaths)
    ? approvalPaths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
    : [];
  const currentCustomerCompletionPaths = args.currentCustomerCompletionPaths
    ? args.currentCustomerCompletionPaths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
    : null;
  if (!approvedRiskHash) return false;
  if (currentCustomerCompletionPaths) {
    const storedScope = [...new Set(customerCompletionPaths)].sort();
    const currentScope = [...new Set(currentCustomerCompletionPaths)].sort();
    if (storedScope.length !== currentScope.length || storedScope.some((path, index) => path !== currentScope[index])) {
      return false;
    }
  }
  return approvedRiskHash === computeManualUwApprovedRiskHash({
    quoteData: args.quoteData,
    coverageSelection: args.coverageSelection,
    authority: args.authority,
    underwritingDecision: args.underwritingDecision,
    customerCompletionPaths,
  });
}

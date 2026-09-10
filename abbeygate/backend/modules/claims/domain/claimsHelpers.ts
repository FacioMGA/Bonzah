import { parseRecord } from '../../../platform/json/parseRecord.js';
/** Policy shape for extractNamedDrivers (quoteData/driverInfo JSON) */
type PolicyWithQuoteData = { quoteData?: unknown; driverInfo?: unknown };

/**
 * Resolve the coverage restriction for a persisted policy. Reads
 * `quoteData.driverRestriction` first (canonical), then the projected
 * `driverInfo.driverRestriction` written by `buildDriverInfoFromQuoteData`.
 * Returns `null` for legacy policies that pre-date ABY-232 — callers
 * should treat that as "named mode" (the historical default).
 */
export function resolveDriverRestrictionFromPolicy(
    policy: PolicyWithQuoteData | null | undefined,
): 'POLICYHOLDER_ONLY' | 'NAMED_DRIVERS' | 'ANY_DRIVER_25_PLUS' | 'ANY_DRIVER_40_PLUS' | null {
    if (!policy) return null;
    const qd = parseRecord(policy.quoteData);
    const di = parseRecord(policy.driverInfo);
    const raw = qd?.driverRestriction ?? di?.driverRestriction;
    if (
        raw === 'POLICYHOLDER_ONLY'
        || raw === 'NAMED_DRIVERS'
        || raw === 'ANY_DRIVER_25_PLUS'
        || raw === 'ANY_DRIVER_40_PLUS'
    ) {
        return raw;
    }
    return null;
}

/**
 * Extract authorised drivers for a motor policy's FNOL driver picker.
 *
 * ABY-232 / ADR-0025: behaviour depends on the canonical
 * `driverRestriction` enum.
 *
 *   POLICYHOLDER_ONLY   → policyholder only
 *   NAMED_DRIVERS       → policyholder + named additional drivers
 *   ANY_DRIVER_25_PLUS  → policyholder only (open mode — the FNOL
 *   ANY_DRIVER_40_PLUS    form switches to an open-driver branch
 *                         where DOB is collected and age is verified
 *                         server-side in `validateGuidedFnolForm`)
 *
 * Legacy policies (no `driverRestriction`) fall back to the historical
 * behaviour of reading every shape that ever existed.
 */
export function extractNamedDriversFromPolicy(policy: PolicyWithQuoteData | null | undefined): Array<{ id: string; name: string }> {
    if (!policy) return [];

    const qd = parseRecord(policy.quoteData);
    const di = parseRecord(policy.driverInfo);
    const out: Array<{ id: string; name: string }> = [];
    const seen = new Set<string>();

    const push = (idRaw: unknown, nameRaw: unknown) => {
        const name = String(nameRaw ?? '').trim();
        if (!name) return;
        const id = String(idRaw ?? '').trim() || `driver-${name.toLowerCase()}`;
        const key = `${id}|${name.toLowerCase()}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ id, name });
    };

    const proposer = parseRecord(qd?.proposer);
    const policyholderName = [
        String(proposer.firstName ?? '').trim(),
        String(proposer.lastName ?? '').trim(),
    ].filter(Boolean).join(' ');
    if (policyholderName) push('policyholder-driver', policyholderName);

    const restriction = resolveDriverRestrictionFromPolicy(policy);

    // Open / policyholder-only modes: the named-drivers list is not
    // relevant for FNOL driver selection. The form switches to the
    // open-authorised-driver branch and validates age server-side.
    if (
        restriction === 'POLICYHOLDER_ONLY'
        || restriction === 'ANY_DRIVER_25_PLUS'
        || restriction === 'ANY_DRIVER_40_PLUS'
    ) {
        return out;
    }

    const fromArray = (raw: unknown) => {
        if (!Array.isArray(raw)) return;
        raw.forEach((item: unknown, idx: number) => {
            if (typeof item === 'string') {
                push(`driver-${idx}-${String(item ?? '').toLowerCase()}`, item);
                return;
            }
            const rec = parseRecord(item);
            const composedName = [
                String(rec.firstName ?? '').trim(),
                String(rec.lastName ?? '').trim(),
            ].filter(Boolean).join(' ');
            const name = rec.name ?? rec.fullName ?? rec.driverName ?? composedName;
            push(rec.id ?? `driver-${idx}-${String(name ?? '').toLowerCase()}`, name);
        });
    };

    fromArray(qd?.drivers);
    fromArray(qd?.namedDrivers);
    fromArray(qd?.additionalDrivers);
    fromArray(di?.drivers);
    fromArray(di?.namedDrivers);
    fromArray(di?.additionalDrivers);
    return out;
}

/**
 * clientFnol.model — Domain model / data extraction
 *
 * No React. No state. No validation.
 * Owns: named driver extraction, policy label building, record normalization.
 */
import type { NamedDriver } from '../model/clientFnol.types';
import { clampE164Phone } from '../views/clientFnol.helpers';

type UnknownRecord = Record<string, unknown>;
const asRecord = (v: unknown): UnknownRecord =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as UnknownRecord) : {};

function normalizeNamedDrivers(raw: unknown): NamedDriver[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((item, idx: number) => {
            if (typeof item === 'string') {
                const name = String(item || '').trim();
                return name ? { id: `driver-${idx}-${name.toLowerCase()}`, name } : null;
            }
            const rec = asRecord(item);
            const firstName = String(rec.firstName || '').trim();
            const lastName = String(rec.lastName || '').trim();
            const fallbackName = [firstName, lastName].filter(Boolean).join(' ').trim();
            const name = String(rec.name || rec.fullName || rec.driverName || fallbackName).trim();
            const phone = clampE164Phone(String(rec.phone || rec.telephone || rec.mobile || '').trim());
            const email = String(rec.email || '').trim();
            const dateOfBirth = String(rec.dateOfBirth || rec.dob || '').trim();
            const id = String(rec.id || '').trim() || `driver-${idx}-${name.toLowerCase()}`;
            if (!name) return null;
            return { id, name, phone: phone || undefined, email: email || undefined, dateOfBirth: dateOfBirth || undefined };
        })
        .filter(Boolean) as NamedDriver[];
}

export function extractNamedDriversForPolicy(selectedPolicy: unknown): NamedDriver[] {
    const p = asRecord(selectedPolicy);
    const qd = asRecord(p.quoteData);
    const di = asRecord(p.driverInfo);

    const candidates = [
        normalizeNamedDrivers(qd.drivers),
        normalizeNamedDrivers(qd.namedDrivers),
        normalizeNamedDrivers(qd.additionalDrivers),
        normalizeNamedDrivers(di.drivers),
        normalizeNamedDrivers(di.namedDrivers),
        normalizeNamedDrivers(di.additionalDrivers),
    ];
    const fromArray = candidates.find((x) => Array.isArray(x) && x.length > 0) || [];

    const proposer = asRecord(qd.proposer);
    const policyholderName = [String(proposer.firstName || '').trim(), String(proposer.lastName || '').trim()]
        .filter(Boolean)
        .join(' ');
    const policyholderPhone = String(proposer.phone || '').trim();
    const policyholderEmail = String(proposer.email || '').trim();
    const policyholderDateOfBirth = String(proposer.dateOfBirth || '').trim();
    const base: NamedDriver[] = policyholderName
        ? [{
            id: 'policyholder-driver',
            name: policyholderName,
            phone: policyholderPhone || undefined,
            email: policyholderEmail || undefined,
            dateOfBirth: policyholderDateOfBirth || undefined,
        }]
        : [];

    const merged = [...base, ...fromArray];
    const seen = new Set<string>();
    return merged.filter((d) => {
        const key = `${String(d.name || '').toLowerCase()}|${String(d.phone || '').toLowerCase()}`;
        if (!d.name || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function buildClientPolicyLabel(p: unknown): string {
    const policy = asRecord(p);
    const vi = asRecord(policy.vehicleInfo);
    const qd = asRecord(policy.quoteData);
    const make = String(vi.make || qd.make || '').trim();
    const model = String(vi.model || qd.model || '').trim();
    const reg = String(vi.registrationNumber || qd.registrationNumber || '').trim();
    const base = [make, model].filter(Boolean).join(' ') || 'Auto Insurance';
    return `${base}${reg ? ` · ${reg.toUpperCase()}` : ''}`;
}

/**
 * Reconciliation Utilities — Pure helper functions for the reconciliation HTTP layer.
 *
 * CHAMPS: Extracted from reconciliationRouter.ts to reduce god-file LOC.
 * These are stateless, reusable parsing and formatting functions.
 */

import type { Request, Response } from 'express';
import type { ApiResponse } from '../../../platform/types/index.js';

type ErrorBody = ApiResponse<null>;

// ─── HTTP Helpers ────────────────────────────────────────────────────

export function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

export function sendError(res: Pick<Response, 'status' | 'json'>, status: number, code: string, message: string) {
    const payload: ErrorBody = {
        success: false,
        error: { code, message },
    };
    return res.status(status).json(payload);
}

export function requireTenantId(req: Request, res: Pick<Response, 'status' | 'json'>): string | null {
    const tenantId = String(req.tenantId || '').trim();
    if (tenantId) return tenantId;
    sendError(res, 401, 'TENANT_REQUIRED', 'Authenticated tenant context is missing');
    return null;
}

export function reconciliationTenantWhere(tenantId: string): Record<string, unknown> {
    return {
        OR: [
            { policy: { accountId: tenantId } },
            { invoice: { policy: { accountId: tenantId } } },
        ],
    };
}

// ─── Date / Number Parsing ───────────────────────────────────────────

export const excelDateToJSDate = (serial: number) => {
    const utc_days = Math.floor(serial - 25569);
    const utc_value = utc_days * 86400;
    const date_info = new Date(utc_value * 1000);
    const fractional_day = serial - Math.floor(serial) + 0.0000001;
    let total_seconds = Math.floor(86400 * fractional_day);
    const seconds = total_seconds % 60;
    total_seconds -= seconds;
    const hours = Math.floor(total_seconds / (60 * 60));
    const minutes = Math.floor(total_seconds / 60) % 60;
    return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate(), hours, minutes, seconds);
};

export function parseAmount(raw: unknown): number | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    const s = String(raw).trim();
    if (!s) return null;
    const neg = /^\(.*\)$/.test(s);
    const inner = s.replace(/^\(|\)$/g, '').trim();
    const hasComma = inner.includes(',');
    const hasDot = inner.includes('.');
    let normalized = inner;
    if (hasComma && hasDot) {
        const lastComma = inner.lastIndexOf(',');
        const lastDot = inner.lastIndexOf('.');
        if (lastComma > lastDot) {
            normalized = inner.replace(/\./g, '').replace(/,/g, '.');
        } else {
            normalized = inner.replace(/,/g, '');
        }
    } else if (hasComma && !hasDot) {
        normalized = inner.replace(/,/g, '.');
    } else {
        normalized = inner;
    }
    const cleaned = normalized.replace(/[^\d.-]/g, '');
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return null;
    return neg ? -Math.abs(n) : n;
}

export function parseDateMaybe(raw: unknown): Date | null {
    if (raw === null || raw === undefined || raw === '') return null;
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
    if (typeof raw === 'number') {
        const d = excelDateToJSDate(raw);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const s = String(raw).trim();
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
}

// ─── Row Mapping / Column Normalization ──────────────────────────────

export function normalizeHeaderKey(k: string) {
    return String(k || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/\s+/g, '_');
}

export function toRowMap(row: unknown): Record<string, unknown> {
    if (!row || typeof row !== 'object') return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[normalizeHeaderKey(k)] = v;
    return out;
}

export function firstNonEmpty(row: Record<string, unknown>, keys: string[]) {
    for (const k of keys) {
        const v = row[k];
        if (v === null || v === undefined) continue;
        const s = String(v).trim();
        if (s) return v;
    }
    return undefined;
}

export function extractPolicyNumber(text: string): string | null {
    const s = String(text || '');
    // ADR-0034 — canonical formats: `ABQ/CC1000001`, `ABOLV/CC1000001` (tenant-coded);
    // also accept the pre-ADR-0034 single-tenant `ABQ1000001` / `ABOLV1000001` rows
    // that exist in CY's historical data. Bank-reconciliation narratives never
    // include forward slashes inside identifiers (the slash is a NACHA / SEPA
    // separator), so this regex is unambiguous against narrative text.
    const m = s.match(/\b(ABOLV\/[A-Z]{2}\d{7}|ABQ\/[A-Z]{2}\d{7}|ABOLV\d{7}|ABQ\d{7})\b/i);
    return m ? m[1].toUpperCase() : null;
}

// ─── Narrative Cleaning ──────────────────────────────────────────────

export const cleanNarrative = (narrative: string): string => {
    if (!narrative) return 'Direct Credit';

    let cleaned = narrative;
    cleaned = cleaned.replace(/\/OCMT\/[A-Z0-9.,]+\/\//g, ' ');
    cleaned = cleaned.replace(/\/VXR\/[A-Z0-9]+\/?/g, ' ');
    cleaned = cleaned.replace(/\/[A-Z]+\/[^/]+\//g, ' ');
    cleaned = cleaned.replace(/GB[0-9]{2}[A-Z]{4}[0-9]{14}/g, ' ');
    cleaned = cleaned.replace(/USD[0-9.,]+/g, ' ');
    cleaned = cleaned.replace(/[0-9]{6,}/g, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    if (cleaned.toLowerCase().includes('spm')) {
        const match = cleaned.match(/spm\s+([a-z]+)\s+([a-z]+)/i);
        if (match) return `SPM ${match[1]} ${match[2]}`;
    }

    if (cleaned.toLowerCase().includes('rpm')) {
        const match = cleaned.match(/rpm\s+([a-z]+)/i);
        if (match) return `RPM ${match[1]}`;
    }

    if (cleaned.toLowerCase().includes('netgain')) return 'Netgain Property Management';
    if (cleaned.toLowerCase().includes('hamilton')) return 'Managing Agency';
    if (cleaned.toLowerCase().includes('gateway')) return 'Gateway Platform';
    if (cleaned.toLowerCase().includes('fees')) return 'Fees Payment';

    const noise = ['EMPTY', 'NARRATIVE', 'LONDON', 'BARCLAYS', 'BANK', 'UK', 'PLC', 'WORKING', 'FROM', 'SOUTHWARD', 'FENCHURCH', 'PLACE'];
    const words = cleaned.split(' ').filter(w =>
        w.length > 2 &&
        !/^[0-9]+$/.test(w) &&
        !noise.includes(w.toUpperCase())
    );

    if (words.length > 0) return words.slice(0, 3).join(' ');

    return cleaned || 'Direct Credit';
};

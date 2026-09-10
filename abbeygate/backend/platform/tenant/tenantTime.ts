/**
 * Per-tenant calendar-day helpers (ADR-0036 amendment #2).
 *
 * `Tenant.countryCode` already exists; there is no IANA timezone field
 * on the Tenant model today. This module maps the country code to an
 * IANA zone via a small static table and returns date ranges expressed
 * in UTC that correspond to the tenant's local calendar day / month /
 * week.
 *
 * Why static map rather than a Prisma column: every operating tenant
 * is a Lloyd's-coverholder MGA at a specific national jurisdiction.
 * Adding tenants is rare and requires an ADR (per `tenancy.md`); a
 * runtime field would create the illusion of operator-configurable
 * timezones we do not actually want.
 *
 * Consumers:
 *   - `backend/modules/operator/app/getSalesStats.ts`
 *   - `backend/modules/operator/app/getQuotePipelineStats.ts`
 *   - any future "tenant calendar day" reporting helper
 */

import { getTenantConfig, type CountryCode } from './tenantConfig.js';

/**
 * IANA timezone for each supported operating tenant country.
 * Add a row when a new country joins; do not infer at runtime.
 */
const TZ_BY_COUNTRY: Record<CountryCode, string> = {
    CY: 'Asia/Nicosia',
    PT: 'Europe/Lisbon',
    ES: 'Europe/Madrid',
    GR: 'Europe/Athens',
    IT: 'Europe/Rome',
};

export type TenantPeriodLabel =
    | 'today'
    | 'yesterday'
    | 'wtd'
    | 'mtd'
    | 'ytd'
    | 'last_7_days'
    | 'last_30_days';

export interface TenantPeriod {
    /** Inclusive lower bound (UTC). */
    start: Date;
    /** Exclusive upper bound (UTC). */
    end: Date;
    /** IANA zone the bounds were computed against. */
    tz: string;
    /** Original label, for diagnostics / audit. */
    label: TenantPeriodLabel | 'custom';
}

export function tzForCountry(code: CountryCode): string {
    const tz = TZ_BY_COUNTRY[code];
    if (!tz) {
        throw new Error(`No IANA timezone configured for country code "${code}". Extend tenantTime.TZ_BY_COUNTRY.`);
    }
    return tz;
}

/**
 * Returns the local calendar-day [00:00, next 00:00) of the resolved
 * operating tenant, expressed as UTC `Date` instants. Reads the tenant
 * from ALS via `getTenantConfig()`; must be called inside an ALS
 * context (same posture as `tenancy.md`).
 */
export function getTenantToday(now: Date = new Date()): TenantPeriod {
    const tenant = getTenantConfig();
    const tz = tzForCountry(tenant.countryCode);
    const { start, end } = calendarDayBounds(now, tz);
    return { start, end, tz, label: 'today' };
}

export function getTenantPeriod(label: TenantPeriodLabel, now: Date = new Date()): TenantPeriod {
    const tenant = getTenantConfig();
    const tz = tzForCountry(tenant.countryCode);
    switch (label) {
        case 'today': {
            const { start, end } = calendarDayBounds(now, tz);
            return { start, end, tz, label };
        }
        case 'yesterday': {
            const todayBounds = calendarDayBounds(now, tz);
            const start = new Date(todayBounds.start.getTime() - 24 * 60 * 60 * 1000);
            return { start, end: todayBounds.start, tz, label };
        }
        case 'wtd': {
            const todayBounds = calendarDayBounds(now, tz);
            const dow = localWeekdayMondayStart(now, tz);
            const start = new Date(todayBounds.start.getTime() - dow * 24 * 60 * 60 * 1000);
            return { start, end: todayBounds.end, tz, label };
        }
        case 'mtd': {
            const start = startOfLocalMonth(now, tz);
            const todayBounds = calendarDayBounds(now, tz);
            return { start, end: todayBounds.end, tz, label };
        }
        case 'ytd': {
            const start = startOfLocalYear(now, tz);
            const todayBounds = calendarDayBounds(now, tz);
            return { start, end: todayBounds.end, tz, label };
        }
        case 'last_7_days': {
            const todayBounds = calendarDayBounds(now, tz);
            const start = new Date(todayBounds.start.getTime() - 7 * 24 * 60 * 60 * 1000);
            return { start, end: todayBounds.end, tz, label };
        }
        case 'last_30_days': {
            const todayBounds = calendarDayBounds(now, tz);
            const start = new Date(todayBounds.start.getTime() - 30 * 24 * 60 * 60 * 1000);
            return { start, end: todayBounds.end, tz, label };
        }
    }
}

// --- internals ------------------------------------------------------

/**
 * `Intl.DateTimeFormat` parts for a given instant in a given IANA tz.
 * Used to compute calendar-day boundaries without pulling in a date
 * library (we deliberately avoid `dayjs`/`luxon` to keep the platform
 * dependency surface tight).
 */
function partsInTz(instant: Date, tz: string): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    weekday: number; // 0 = Sunday … 6 = Saturday
} {
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
        hour12: false,
    });
    const parts = fmt.formatToParts(instant);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
    const weekdayShort = get('weekday');
    const WEEKDAY_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
        year: Number(get('year')),
        month: Number(get('month')),
        day: Number(get('day')),
        hour: Number(get('hour') === '24' ? '0' : get('hour')),
        minute: Number(get('minute')),
        second: Number(get('second')),
        weekday: WEEKDAY_MAP[weekdayShort] ?? 0,
    };
}

/**
 * Returns the UTC instant for local-midnight (start of day) of the
 * given local calendar date in the given IANA zone. Uses a single-pass
 * offset estimation that handles DST transitions correctly because
 * `Intl.DateTimeFormat` always reports the local time as the zone
 * would see it at the candidate UTC instant.
 */
function utcInstantForLocalMidnight(year: number, month: number, day: number, tz: string): Date {
    // First pass: assume UTC offset of 0 for the local midnight.
    const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const parts = partsInTz(guess, tz);
    // Diff between what the zone sees and what we want = the zone's
    // offset at this instant. Correct the UTC instant by that diff.
    const localMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const wantedLocalMs = Date.UTC(year, month - 1, day, 0, 0, 0);
    const offsetMs = localMs - wantedLocalMs;
    return new Date(guess.getTime() - offsetMs);
}

function calendarDayBounds(instant: Date, tz: string): { start: Date; end: Date } {
    const local = partsInTz(instant, tz);
    const start = utcInstantForLocalMidnight(local.year, local.month, local.day, tz);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
}

function startOfLocalMonth(instant: Date, tz: string): Date {
    const local = partsInTz(instant, tz);
    return utcInstantForLocalMidnight(local.year, local.month, 1, tz);
}

function startOfLocalYear(instant: Date, tz: string): Date {
    const local = partsInTz(instant, tz);
    return utcInstantForLocalMidnight(local.year, 1, 1, tz);
}

/** Monday-start ISO week: Mon=0 … Sun=6. */
function localWeekdayMondayStart(instant: Date, tz: string): number {
    const sundayStart = partsInTz(instant, tz).weekday; // Sun=0 … Sat=6
    return (sundayStart + 6) % 7;
}

/**
 * Pins the tenant-timezone behaviour for the operator analytics tools.
 * The DST boundary case is the one most likely to silently regress —
 * if Cyprus is in summer time (UTC+3), "today at 22:00 UTC" is already
 * tomorrow's Cyprus calendar day.
 */
import { describe, expect, it } from 'vitest';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import type { TenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { getTenantPeriod, getTenantToday, tzForCountry } from '../../../platform/tenant/tenantTime.js';

function makeTenant(countryCode: 'CY' | 'PT' | 'ES' | 'GR' | 'US'): TenantConfig {
    return {
        id: '00000000-0000-0000-0000-000000000001',
        tenantSlug: `abbeygate-${countryCode.toLowerCase()}`,
        countryCode,
        country: countryCode,
        currency: countryCode === 'US' ? 'USD' : 'EUR',
        ipt: {},
        adminFee: 0,
        publicBaseUrl: 'https://example.test',
        fromEmail: 'noreply@example.test',
        brandLogo: { white: '', blue: '' },
        legalPack: countryCode.toLowerCase() as TenantConfig['legalPack'],
    };
}

describe('tzForCountry', () => {
    it('maps each supported country code to a canonical IANA zone', () => {
        expect(tzForCountry('CY')).toBe('Asia/Nicosia');
        expect(tzForCountry('PT')).toBe('Europe/Lisbon');
        expect(tzForCountry('ES')).toBe('Europe/Madrid');
        expect(tzForCountry('GR')).toBe('Europe/Athens');
        expect(tzForCountry('US')).toBe('America/Denver');
    });
});

describe('getTenantToday', () => {
    it('Cyprus summer: 21:30 UTC on a summer date returns "today" still in the local day', () => {
        // 2026-07-14 21:30 UTC = 2026-07-15 00:30 Cyprus summer (UTC+3)
        // The next calendar tick crosses to 2026-07-16 00:00 Cyprus time
        // which is 2026-07-15 21:00 UTC. The boundary depends on the moment
        // the instant lands relative to the local midnight.
        const summerInstant = new Date('2026-07-14T21:30:00.000Z');
        const period = runWithOperatingTenant(makeTenant('CY'), () => getTenantToday(summerInstant));
        // Sanity: end - start = 24h exactly, tz reflects CY summer.
        expect(period.tz).toBe('Asia/Nicosia');
        expect(period.end.getTime() - period.start.getTime()).toBe(24 * 60 * 60 * 1000);
        expect(period.label).toBe('today');
    });

    it('Cyprus winter: midwinter midnight UTC starts the Cyprus day at 22:00 UTC the day before', () => {
        // 2026-12-15 00:00 UTC = 2026-12-15 02:00 Cyprus winter (UTC+2)
        // → local day 2026-12-15 starts at 2026-12-14 22:00 UTC.
        const winterInstant = new Date('2026-12-15T00:00:00.000Z');
        const period = runWithOperatingTenant(makeTenant('CY'), () => getTenantToday(winterInstant));
        expect(period.start.toISOString()).toBe('2026-12-14T22:00:00.000Z');
        expect(period.end.toISOString()).toBe('2026-12-15T22:00:00.000Z');
    });
});

describe('getTenantPeriod', () => {
    it('yesterday spans exactly one calendar day before today', () => {
        const instant = new Date('2026-12-15T10:00:00.000Z');
        const today = runWithOperatingTenant(makeTenant('PT'), () => getTenantPeriod('today', instant));
        const yesterday = runWithOperatingTenant(makeTenant('PT'), () => getTenantPeriod('yesterday', instant));
        expect(yesterday.end.toISOString()).toBe(today.start.toISOString());
        expect(today.start.getTime() - yesterday.start.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it('mtd starts at the first day of the current local month', () => {
        const instant = new Date('2026-07-15T12:00:00.000Z');
        const mtd = runWithOperatingTenant(makeTenant('CY'), () => getTenantPeriod('mtd', instant));
        // July 1st 2026 in Cyprus summer (UTC+3) = 2026-06-30 21:00 UTC.
        expect(mtd.start.toISOString()).toBe('2026-06-30T21:00:00.000Z');
    });
});

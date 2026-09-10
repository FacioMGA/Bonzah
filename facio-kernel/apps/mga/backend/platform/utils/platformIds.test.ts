import { describe, expect, it, vi } from 'vitest';
import { runWithOperatingTenant } from '../tenant/tenantAls.js';
import type { TenantConfig } from '../tenant/tenantConfig.js';
import {
  isReservedPolicyNumber,
  isReservedQuoteId,
  reserveNextCertificateNumber,
  reserveNextGreenCardSerial,
  reserveNextPolicyId,
  reserveNextQuoteId,
  shouldReassignPolicyNumberAtIssuance,
} from './platformIds.js';

function tenant(overrides: Partial<TenantConfig>): TenantConfig {
  return {
    id: 'tenant-test',
    tenantSlug: 'abbeygate-cy',
    countryCode: 'CY',
    country: 'Cyprus',
    currency: 'EUR',
    ipt: { flatFee: 0 },
    adminFee: 10,
    publicBaseUrl: 'https://abbeygate-cy.facio.io',
    fromEmail: 'cy@example.com',
    brandLogo: { white: 'https://example.com/white.png', blue: 'https://example.com/blue.png' },
    legalPack: 'cy',
    ...overrides,
  };
}

function txMock() {
  return {
    policy: {
      findFirst: vi.fn(async () => null),
    },
    // Global numeric-field floor read (certificateNumber / greenCardSerial) goes
    // through raw SQL so it bypasses the tenant extension and sees ALL tenants.
    $queryRawUnsafe: vi.fn(async () => [{ max: null }] as Array<{ max: string | null }>),
    policyNumberSequence: {
      upsert: vi.fn(async () => ({ next: 1_000_002 })),
      update: vi.fn(async () => ({ next: 1_000_003 })),
    },
  };
}

describe('platformIds tenant-scoped sequences', () => {
  it('embeds the active operating tenant country code in the quote identifier (ADR-0034)', async () => {
    const tx = txMock();
    tx.policyNumberSequence.upsert.mockResolvedValue({ next: 5_000_002 });

    const quoteId = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-cy', countryCode: 'CY' }), () =>
      reserveNextQuoteId(tx as never),
    );

    expect(quoteId).toBe('ABQ/CY5000001');
    expect(tx.policyNumberSequence.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'ABBEYGATE-CY:QUOTE:ABQ' },
    }));
  });

  it('keeps pre-ADR-0034 CY references while moving the next reservation into the 5,000,000 range', async () => {
    const tx = txMock();
    // Two findFirst calls: canonical tenant-coded scan (null) + unprefixed ABQ\d+ scan (hit).
    tx.policy.findFirst
      .mockResolvedValueOnce(null) // ABQ/CY... canonical-format scan finds nothing yet
      .mockResolvedValueOnce({ policyNumber: 'ABQ1000042' }); // pre-ADR-0034 CY row
    tx.policyNumberSequence.upsert.mockResolvedValue({ next: 1_000_002 });

    const policyId = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-cy', countryCode: 'CY' }), () =>
      reserveNextQuoteId(tx as never),
    );

    expect(policyId).toBe('ABQ/CY5000002');
    expect(tx.policyNumberSequence.update).toHaveBeenCalledWith({
      where: { key: 'ABBEYGATE-CY:QUOTE:ABQ' },
      data: { next: 5_000_003 },
    });
  });

  it('keeps canonical CY legacy references while moving the next reservation into the 5,000,000 range', async () => {
    const tx = txMock();
    tx.policy.findFirst
      .mockResolvedValueOnce({ policyNumber: 'ABQ/CY1000088' }) // prefixed scan hit
      .mockResolvedValueOnce(null); // unprefixed scan finds nothing newer
    tx.policyNumberSequence.upsert.mockResolvedValue({ next: 1_000_002 });

    const quoteId = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-cy', countryCode: 'CY' }), () =>
      reserveNextQuoteId(tx as never), // TODO(FAC-9034): owner=platform-tenant expires=2026-12-31 deletionPR=typed-vitest-prisma-mock vitest tx mock vs Prisma.TransactionClient — same pattern as the baseline tests in this file.
    );

    expect(quoteId).toBe('ABQ/CY5000002');
    expect(tx.policyNumberSequence.update).toHaveBeenCalledWith({
      where: { key: 'ABBEYGATE-CY:QUOTE:ABQ' },
      data: { next: 5_000_003 },
    });
  });

  // ADR-0092: Facio customer-facing numbers across CY/PT/GR start in the
  // 5,000,000 range. Existing 1,000,000-range rows retain their identifiers;
  // the counter moves future reservations above the new floor.
  it('jumps the PT default sequence into the 5,000,000 range above legacy 1,000,000-range rows', async () => {
    const tx = txMock();
    tx.policy.findFirst
      .mockResolvedValueOnce({ policyNumber: 'ABQ/PT1000088' }) // legacy-range PT row
      .mockResolvedValueOnce(null); // PT has no pre-ADR-0034 data
    tx.policyNumberSequence.upsert.mockResolvedValue({ next: 1_000_002 });

    const quoteId = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-pt', countryCode: 'PT' }), () =>
      reserveNextQuoteId(tx as never), // TODO(FAC-9034): owner=platform-tenant expires=2026-12-31 deletionPR=typed-vitest-prisma-mock vitest tx mock vs Prisma.TransactionClient — same pattern as the baseline tests in this file.
    );

    expect(quoteId).toBe('ABQ/PT5000002');
    expect(tx.policyNumberSequence.update).toHaveBeenCalledWith({
      where: { key: 'ABBEYGATE-PT:QUOTE:ABQ' },
      data: { next: 5_000_003 },
    });
  });

  it('starts a brand-new CY/PT/GR default counter at the 5,000,000-range floor', async () => {
    const tx = txMock();
    tx.policy.findFirst.mockResolvedValue(null);
    tx.policyNumberSequence.upsert.mockResolvedValue({ next: 5_000_002 });

    const policyId = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-pt', countryCode: 'PT' }), () =>
      reserveNextPolicyId(tx as never), // TODO(FAC-9034): owner=platform-tenant expires=2026-12-31 deletionPR=typed-vitest-prisma-mock vitest tx mock vs Prisma.TransactionClient — same pattern as the baseline tests in this file.
    );

    expect(policyId).toBe('ABOLV/PT5000001');
    expect(tx.policyNumberSequence.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'ABBEYGATE-PT:POLICY:ABOLV' },
      create: { key: 'ABBEYGATE-PT:POLICY:ABOLV', next: 5_000_002 },
    }));

    const txCy = txMock();
    txCy.policy.findFirst.mockResolvedValue(null);
    txCy.policyNumberSequence.upsert.mockResolvedValue({ next: 5_000_002 });
    const cyQuoteId = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-cy', countryCode: 'CY' }), () =>
      reserveNextQuoteId(txCy as never), // TODO(FAC-9034): owner=platform-tenant expires=2026-12-31 deletionPR=typed-vitest-prisma-mock vitest tx mock vs Prisma.TransactionClient — same pattern as the baseline tests in this file.
    );
    expect(cyQuoteId).toBe('ABQ/CY5000001');

    const txGr = txMock();
    txGr.policy.findFirst.mockResolvedValue(null);
    txGr.policyNumberSequence.upsert.mockResolvedValue({ next: 5_000_002 });
    const grQuoteId = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-gr', countryCode: 'GR' }), () =>
      reserveNextQuoteId(txGr as never), // TODO(FAC-9034): owner=platform-tenant expires=2026-12-31 deletionPR=typed-vitest-prisma-mock vitest tx mock vs Prisma.TransactionClient — same pattern as the baseline tests in this file.
    );
    expect(grQuoteId).toBe('ABQ/GR5000001');
  });

  it('leaves non-Abbeygate operating territories on the canonical start sequence', async () => {
    const tx = txMock();
    tx.policy.findFirst
      .mockResolvedValueOnce(null) // no canonical-format rows yet
      .mockResolvedValueOnce(null); // no pre-ADR-0034 rows for this tenant
    tx.policyNumberSequence.upsert.mockResolvedValue({ next: 1_000_002 });

    const quoteId = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-es', countryCode: 'ES' }), () =>
      reserveNextQuoteId(tx as never), // TODO(FAC-9034): owner=platform-tenant expires=2026-12-31 deletionPR=typed-vitest-prisma-mock vitest tx mock vs Prisma.TransactionClient — same pattern as the baseline tests in this file.
    );

    expect(quoteId).toBe('ABQ/ES1000001');
    expect(tx.policyNumberSequence.update).not.toHaveBeenCalled();
  });

  it('uses the active operating tenant country for certificate sequence keys', async () => {
    const tx = txMock();

    await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-es', countryCode: 'ES' }), () =>
      reserveNextCertificateNumber(tx as never),
    );

    expect(tx.policyNumberSequence.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'ABBEYGATE-ES:CERTIFICATE:ES' },
    }));
  });

  // Regression: ABY-122 / ABY-120 — payment finalisation crashed with
  // `Unique constraint failed on the fields: ('certificateNumber')` because the
  // per-tenant certificate counter was unaware of policies imported via BDX
  // (which carry their own certificate numbers from the source feed). The
  // counter must skip past the highest existing certificateNumber, exactly the
  // same way the policy/quote sequences floor against existing rows.
  it('floors the next certificate number above the highest existing policy.certificateNumber', async () => {
    const tx = txMock();
    tx.$queryRawUnsafe.mockResolvedValueOnce([{ max: '825001234' }]);
    tx.policyNumberSequence.upsert.mockResolvedValueOnce({ next: 825_000_002 });
    tx.policyNumberSequence.update.mockResolvedValueOnce({ next: 825_001_236 });

    const cert = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-cy', countryCode: 'CY' }), () =>
      reserveNextCertificateNumber(tx as never),
    );

    expect(cert).toBe('825001235');
    // Floor is read across ALL tenants with a numeric (bigint) ordering, via raw
    // SQL so the tenant extension cannot scope it to the current tenant.
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('"certificateNumber"::bigint'),
    );
    expect(tx.policyNumberSequence.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'ABBEYGATE-CY:CERTIFICATE:CY' },
      create: { key: 'ABBEYGATE-CY:CERTIFICATE:CY', next: 825_001_235 },
    }));
    expect(tx.policyNumberSequence.update).toHaveBeenCalledWith({
      where: { key: 'ABBEYGATE-CY:CERTIFICATE:CY' },
      data: { next: 825_001_236 },
    });
  });

  // Regression for the cross-tenant zombie: a tenant (PT) with no certificate
  // rows of its own MUST still floor above the GLOBAL max held by another tenant
  // (CY). Before the fix the tenant-scoped read returned null for PT, the floor
  // collapsed to START_SEQ, and the reserved number collided with a CY policy on
  // the global @unique constraint — payment captured, policy never issued.
  it('floors above the GLOBAL certificate max even for a tenant with none of its own', async () => {
    const tx = txMock();
    tx.$queryRawUnsafe.mockResolvedValueOnce([{ max: '825000129' }]); // CY's global max
    tx.policyNumberSequence.upsert.mockResolvedValueOnce({ next: 825_000_130 }); // fresh PT row created at floor+1
    tx.policyNumberSequence.update.mockResolvedValueOnce({ next: 825_000_131 });

    const cert = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-pt', countryCode: 'PT' }), () =>
      reserveNextCertificateNumber(tx as never),
    );

    // Strictly above the global max — not START_SEQ, which would collide with CY.
    expect(cert).toBe('825000130');
    expect(tx.policyNumberSequence.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'ABBEYGATE-PT:CERTIFICATE:PT' },
    }));
  });

  it('returns the counter value when no certificateNumber row exists yet', async () => {
    const tx = txMock();
    tx.$queryRawUnsafe.mockResolvedValueOnce([{ max: null }]);
    tx.policyNumberSequence.upsert.mockResolvedValueOnce({ next: 825_000_002 });

    const cert = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-cy', countryCode: 'CY' }), () =>
      reserveNextCertificateNumber(tx as never),
    );

    expect(cert).toBe('825000001');
    expect(tx.policyNumberSequence.update).not.toHaveBeenCalled();
  });

  it('floors the next green-card serial above the highest existing policy.greenCardSerial', async () => {
    const tx = txMock();
    tx.$queryRawUnsafe.mockResolvedValueOnce([{ max: '824007777' }]);
    tx.policyNumberSequence.upsert.mockResolvedValueOnce({ next: 824_000_002 });
    tx.policyNumberSequence.update.mockResolvedValueOnce({ next: 824_007_779 });

    const serial = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-cy', countryCode: 'CY' }), () =>
      reserveNextGreenCardSerial(tx as never),
    );

    expect(serial).toBe('824007778');
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('"greenCardSerial"::bigint'),
    );
  });
});

// ADR-0047 — carrier-branded, product-scoped numbering. Travel and Immigration
// (Health) get distinct namespaces on their own per-tenant counters; Motor/Home
// keep the ADR-0034 default.
describe('platformIds branded product schemes (ADR-0047)', () => {
  it('issues a Travel policy number as DIRECT/BRIT/ABG/<CC>/<SEQ> starting 5000010', async () => {
    const tx = txMock();
    tx.policyNumberSequence.upsert.mockResolvedValue({ next: 5_000_011 });

    const policyId = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-cy', countryCode: 'CY' }), () =>
      reserveNextPolicyId(tx as never, 'TRAVEL'),
    );

    expect(policyId).toBe('DIRECT/BRIT/ABG/CY/5000010');
    expect(tx.policyNumberSequence.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'ABBEYGATE-CY:POLICY:DIRECT/BRIT/ABG' },
      create: { key: 'ABBEYGATE-CY:POLICY:DIRECT/BRIT/ABG', next: 5_000_011 },
    }));
  });

  it('issues a Travel quote number with the /Q marker on its own counter', async () => {
    const tx = txMock();
    tx.policyNumberSequence.upsert.mockResolvedValue({ next: 5_000_011 });

    const quoteId = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-pt', countryCode: 'PT' }), () =>
      reserveNextQuoteId(tx as never, 'TRAVEL'),
    );

    expect(quoteId).toBe('DIRECT/BRIT/ABG/PT/Q/5000010');
    expect(tx.policyNumberSequence.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'ABBEYGATE-PT:QUOTE:DIRECT/BRIT/ABG/Q' },
    }));
  });

  it('issues an Immigration (Health) policy number as BRIT/ABG/<CC>/IM/<SEQ> starting 5001025', async () => {
    const tx = txMock();
    tx.policyNumberSequence.upsert.mockResolvedValue({ next: 5_001_026 });

    const policyId = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-cy', countryCode: 'CY' }), () =>
      reserveNextPolicyId(tx as never, 'HEALTH'),
    );

    expect(policyId).toBe('BRIT/ABG/CY/IM/5001025');
    expect(tx.policyNumberSequence.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'ABBEYGATE-CY:POLICY:BRIT/ABG/IM' },
      create: { key: 'ABBEYGATE-CY:POLICY:BRIT/ABG/IM', next: 5_001_026 },
    }));
  });

  it('floors a branded Travel counter above the highest existing branded row', async () => {
    const tx = txMock();
    tx.policy.findFirst.mockResolvedValueOnce({ policyNumber: 'DIRECT/BRIT/ABG/CY/5000042' });
    tx.policyNumberSequence.upsert.mockResolvedValue({ next: 5_000_011 });
    tx.policyNumberSequence.update.mockResolvedValue({ next: 5_000_044 });

    const policyId = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-cy', countryCode: 'CY' }), () =>
      reserveNextPolicyId(tx as never, 'TRAVEL'),
    );

    expect(policyId).toBe('DIRECT/BRIT/ABG/CY/5000043');
    expect(tx.policyNumberSequence.update).toHaveBeenCalledWith({
      where: { key: 'ABBEYGATE-CY:POLICY:DIRECT/BRIT/ABG' },
      data: { next: 5_000_044 },
    });
  });

  it('issues a Home policy number as BZ/<CC><SEQ> starting 5000001 (ADR-0047 extension)', async () => {
    const tx = txMock();
    tx.policyNumberSequence.upsert.mockResolvedValue({ next: 5_000_002 });

    const policyId = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-cy', countryCode: 'CY' }), () =>
      reserveNextPolicyId(tx as never, 'HOME'), // TODO(FAC-9034): owner=platform-tenant expires=2026-12-31 deletionPR=typed-vitest-prisma-mock vitest tx mock vs Prisma.TransactionClient — same pattern as the baseline tests in this file.
    );

    expect(policyId).toBe('BZ/CY5000001');
    expect(tx.policyNumberSequence.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'ABBEYGATE-CY:POLICY:BZ' },
      create: { key: 'ABBEYGATE-CY:POLICY:BZ', next: 5_000_002 },
    }));
  });

  it('brands a Home policy for PT as BZ/PT<SEQ> but leaves Home quotes on the ABQ default', async () => {
    const tx = txMock();
    tx.policyNumberSequence.upsert.mockResolvedValue({ next: 5_000_002 });

    const policyId = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-pt', countryCode: 'PT' }), () =>
      reserveNextPolicyId(tx as never, 'HOME'), // TODO(FAC-9034): owner=platform-tenant expires=2026-12-31 deletionPR=typed-vitest-prisma-mock vitest tx mock vs Prisma.TransactionClient — same pattern as the baseline tests in this file.
    );
    expect(policyId).toBe('BZ/PT5000001');

    const tx2 = txMock();
    tx2.policyNumberSequence.upsert.mockResolvedValue({ next: 5_000_002 });
    const quoteId = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-pt', countryCode: 'PT' }), () =>
      reserveNextQuoteId(tx2 as never, 'HOME'), // TODO(FAC-9034): owner=platform-tenant expires=2026-12-31 deletionPR=typed-vitest-prisma-mock vitest tx mock vs Prisma.TransactionClient — same pattern as the baseline tests in this file.
    );
    // Home has no branded QUOTE scheme -> ADR-0034 default prefix.
    expect(quoteId).toBe('ABQ/PT5000001');
  });
});

// ADR-0061 — Motor/Santam numbering. Policy numbers are branded `AB/ST/…`
// (Cyprus has no country token; PT/ES do) and split into two streams by issue
// origin: online sales start 5,000,100, manual entries start 1,000,100 — on
// independent per-tenant counters. Quotes are online-only, prefixed `Q/`.
describe('platformIds Motor/Santam schemes (ADR-0061)', () => {
  it('issues an ONLINE Cyprus motor policy as AB/ST/<seq> starting 5000100 (no country token)', async () => {
    const tx = txMock();
    tx.policyNumberSequence.upsert.mockResolvedValue({ next: 5_000_101 });

    const policyId = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-cy', countryCode: 'CY' }), () =>
      reserveNextPolicyId(tx as never, 'MOTOR', 'ONLINE'), // TODO(FAC-9034): owner=platform-tenant expires=2026-12-31 deletionPR=typed-vitest-prisma-mock vitest tx mock vs Prisma.TransactionClient — same pattern as the baseline tests in this file.
    );

    expect(policyId).toBe('AB/ST/5000100');
    expect(tx.policyNumberSequence.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'ABBEYGATE-CY:POLICY:AB/ST/ONLINE' },
      create: { key: 'ABBEYGATE-CY:POLICY:AB/ST/ONLINE', next: 5_000_101 },
    }));
  });

  it('issues a MANUAL Cyprus motor policy as AB/ST/<seq> starting 1000100 on its own counter', async () => {
    const tx = txMock();
    tx.policyNumberSequence.upsert.mockResolvedValue({ next: 1_000_101 });

    const policyId = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-cy', countryCode: 'CY' }), () =>
      reserveNextPolicyId(tx as never, 'MOTOR', 'MANUAL'), // TODO(FAC-9034): owner=platform-tenant expires=2026-12-31 deletionPR=typed-vitest-prisma-mock vitest tx mock vs Prisma.TransactionClient — same pattern as the baseline tests in this file.
    );

    expect(policyId).toBe('AB/ST/1000100');
    expect(tx.policyNumberSequence.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'ABBEYGATE-CY:POLICY:AB/ST/MANUAL' },
    }));
  });

  it('marks non-CY tenants with the country token (PT online, ES manual)', async () => {
    const txPt = txMock();
    txPt.policyNumberSequence.upsert.mockResolvedValue({ next: 5_000_101 });
    const ptOnline = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-pt', countryCode: 'PT' }), () =>
      reserveNextPolicyId(txPt as never, 'MOTOR', 'ONLINE'), // TODO(FAC-9034): owner=platform-tenant expires=2026-12-31 deletionPR=typed-vitest-prisma-mock vitest tx mock vs Prisma.TransactionClient — same pattern as the baseline tests in this file.
    );
    expect(ptOnline).toBe('AB/ST/PT/5000100');

    const txEs = txMock();
    txEs.policyNumberSequence.upsert.mockResolvedValue({ next: 1_000_101 });
    const esManual = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-es', countryCode: 'ES' }), () =>
      reserveNextPolicyId(txEs as never, 'MOTOR', 'MANUAL'), // TODO(FAC-9034): owner=platform-tenant expires=2026-12-31 deletionPR=typed-vitest-prisma-mock vitest tx mock vs Prisma.TransactionClient — same pattern as the baseline tests in this file.
    );
    expect(esManual).toBe('AB/ST/ES/1000100');
  });

  it('does not drag the manual counter up when an online row already exists (band-scoped floor)', async () => {
    const tx = txMock();
    // The manual floor scan is bounded below the online start, so it must query
    // with an `lt` bound and ignore the 5,000,000-range online row.
    tx.policy.findFirst.mockResolvedValueOnce(null);
    tx.policyNumberSequence.upsert.mockResolvedValue({ next: 1_000_101 });

    const policyId = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-cy', countryCode: 'CY' }), () =>
      reserveNextPolicyId(tx as never, 'MOTOR', 'MANUAL'), // TODO(FAC-9034): owner=platform-tenant expires=2026-12-31 deletionPR=typed-vitest-prisma-mock vitest tx mock vs Prisma.TransactionClient — same pattern as the baseline tests in this file.
    );

    expect(policyId).toBe('AB/ST/1000100');
    expect(tx.policy.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { policyNumber: expect.objectContaining({ startsWith: 'AB/ST/', lt: 'AB/ST/5000100' }) },
    }));
  });

  it('issues a Facio motor quote in the 5,000,000 range on the quote counter', async () => {
    const txCy = txMock();
    txCy.policyNumberSequence.upsert.mockResolvedValue({ next: 5_000_101 });
    const cyQuote = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-cy', countryCode: 'CY' }), () =>
      reserveNextQuoteId(txCy as never, 'MOTOR'), // TODO(FAC-9034): owner=platform-tenant expires=2026-12-31 deletionPR=typed-vitest-prisma-mock vitest tx mock vs Prisma.TransactionClient — same pattern as the baseline tests in this file.
    );
    expect(cyQuote).toBe('Q/5000100');
    expect(txCy.policyNumberSequence.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'ABBEYGATE-CY:QUOTE:Q' },
    }));

    const txPt = txMock();
    txPt.policyNumberSequence.upsert.mockResolvedValue({ next: 5_000_101 });
    const ptQuote = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-pt', countryCode: 'PT' }), () =>
      reserveNextQuoteId(txPt as never, 'MOTOR'), // TODO(FAC-9034): owner=platform-tenant expires=2026-12-31 deletionPR=typed-vitest-prisma-mock vitest tx mock vs Prisma.TransactionClient — same pattern as the baseline tests in this file.
    );
    expect(ptQuote).toBe('Q/PT/5000100');

    const txEs = txMock();
    txEs.policyNumberSequence.upsert.mockResolvedValue({ next: 1_000_101 });
    const esQuote = await runWithOperatingTenant(tenant({ tenantSlug: 'abbeygate-es', countryCode: 'ES' }), () =>
      reserveNextQuoteId(txEs as never, 'MOTOR'), // TODO(FAC-9034): owner=platform-tenant expires=2026-12-31 deletionPR=typed-vitest-prisma-mock vitest tx mock vs Prisma.TransactionClient — same pattern as the baseline tests in this file.
    );
    expect(esQuote).toBe('Q/ES/1000100');
  });
});

describe('platformIds canonical identifier predicates (ADR-0047)', () => {
  it('recognises quote identifiers across default and branded schemes', () => {
    expect(isReservedQuoteId('ABQ/CY1000001')).toBe(true);
    expect(isReservedQuoteId('ABQ1000042')).toBe(true); // pre-ADR-0034 legacy
    expect(isReservedQuoteId('DIRECT/BRIT/ABG/CY/Q/5000010')).toBe(true);
    expect(isReservedQuoteId('BRIT/ABG/CY/IM/Q/5001025')).toBe(true);
    expect(isReservedQuoteId('Q/1000100')).toBe(true); // Santam CY motor quote
    expect(isReservedQuoteId('Q/PT/1000100')).toBe(true); // Santam PT motor quote
    // Policy numbers and empties are not quotes
    expect(isReservedQuoteId('ABOLV/CY1000001')).toBe(false);
    expect(isReservedQuoteId('DIRECT/BRIT/ABG/CY/5000010')).toBe(false);
    expect(isReservedQuoteId('AB/ST/5000100')).toBe(false); // Santam policy, not a quote
    expect(isReservedQuoteId('')).toBe(false);
    expect(isReservedQuoteId(null)).toBe(false);
  });

  it('recognises policy identifiers across default and branded schemes', () => {
    expect(isReservedPolicyNumber('ABOLV/CY1000001')).toBe(true);
    expect(isReservedPolicyNumber('ABOLV1000042')).toBe(true); // pre-ADR-0034 legacy
    expect(isReservedPolicyNumber('DIRECT/BRIT/ABG/CY/5000010')).toBe(true);
    expect(isReservedPolicyNumber('BRIT/ABG/CY/IM/5001025')).toBe(true);
    expect(isReservedPolicyNumber('AB/ST/5000100')).toBe(true); // Santam CY online policy
    expect(isReservedPolicyNumber('AB/ST/1000100')).toBe(true); // Santam CY manual policy
    expect(isReservedPolicyNumber('AB/ST/PT/5000100')).toBe(true); // Santam PT policy
    expect(isReservedPolicyNumber('BZ/CY5000001')).toBe(true); // Home branded policy (ADR-0047 ext)
    expect(isReservedPolicyNumber('BZ/PT5000001')).toBe(true);
    // Quote numbers (incl. the branded /Q marker) are not policy numbers
    expect(isReservedPolicyNumber('ABQ/CY1000001')).toBe(false);
    expect(isReservedPolicyNumber('DIRECT/BRIT/ABG/CY/Q/5000010')).toBe(false);
    expect(isReservedPolicyNumber('BRIT/ABG/CY/IM/Q/5001025')).toBe(false);
    expect(isReservedPolicyNumber('Q/1000100')).toBe(false); // Santam quote, not a policy
    expect(isReservedPolicyNumber('')).toBe(false);
  });
});

describe('shouldReassignPolicyNumberAtIssuance (ADR-0071 HOME / ADR-0061 Motor)', () => {
  it('always upgrades quote ids to issued policy numbers', () => {
    expect(shouldReassignPolicyNumberAtIssuance('HOME', 'ABQ/CY1000001')).toBe(true);
    expect(shouldReassignPolicyNumberAtIssuance('MOTOR', 'ABQ/CY1000001')).toBe(true);
  });

  it('retains branded HOME (BZ) and Motor (AB/ST) policy numbers', () => {
    expect(shouldReassignPolicyNumberAtIssuance('HOME', 'BZ/CY5000001')).toBe(false);
    expect(shouldReassignPolicyNumberAtIssuance('MOTOR', 'AB/ST/5000100')).toBe(false);
  });

  it('retains historical ABOLV policy numbers for every product', () => {
    for (const productType of ['HOME', 'MOTOR', 'TRAVEL', 'HEALTH', 'BUSINESS']) {
      expect(shouldReassignPolicyNumberAtIssuance(productType, 'ABOLV/CY1000001')).toBe(false);
    }
  });

  it('retains Lloyd BDX BZ/ABG home numbers alongside ADR-0071 BZ/CC+SEQ', () => {
    expect(shouldReassignPolicyNumberAtIssuance('HOME', 'BZ/ABG/00005590SS')).toBe(false);
    expect(shouldReassignPolicyNumberAtIssuance('HOME', 'BZ/CY5000001')).toBe(false);
  });
});

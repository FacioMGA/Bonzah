import { describe, expect, it } from 'vitest';
import { isManualProposalRecord, readCanonicalBreakdownLines, resolvePremiumProductType } from './PremiumTab';

describe('PremiumTab manual proposal detection', () => {
  it('resolves product type from displayed policy while the selected policy hydrates', () => {
    expect(
      resolvePremiumProductType({
        selectedPortfolio: { id: 'pol-1' },
        displayedPortfolio: { productType: 'BUSINESS' },
      }),
    ).toBe('BUSINESS');
  });

  it('resolves product type from the selected program for fresh submissions', () => {
    expect(
      resolvePremiumProductType({
        selectedPortfolio: { id: 'pol-1' },
        selectedProgram: { productType: 'OPEN_MARKET', metadata: { productType: 'MOTOR' } },
      }),
    ).toBe('OPEN_MARKET');
  });

  it('treats Business-shaped quote data as manual before proposal rows exist', () => {
    expect(
      isManualProposalRecord('', {
        proposer: { email: 'client@example.com' },
        business: { typeOfBusiness: 'Retail' },
        coverage: { publicLiability: 'yes' },
      }, {}),
    ).toBe(true);
  });

  it('does not treat HOME quote data with risk + proposer as a manual proposal (ABY-497)', () => {
    expect(
      isManualProposalRecord('HOME', {
        proposer: { email: 'client@example.com', firstName: 'Alex' },
        property: { address: { line1: '1 Main St' } },
        risk: { previousClaims: 'None', noClaimsDiscount: '5+ Years' },
      }, { primaryOption: { annualPremium: 420 } }),
    ).toBe(false);
  });

  it('does not treat TRAVEL quote data with risk + proposer as a manual proposal (ABY-497)', () => {
    expect(
      isManualProposalRecord('TRAVEL', {
        proposer: { email: 'client@example.com', firstName: 'Alex' },
        trip: { destinationCountry: 'Spain' },
        risk: { hasPreviousTravelClaim: false },
      }, { primaryOption: { annualPremium: 120 } }),
    ).toBe(false);
  });

  it('treats unstamped Open Market intake as manual when risk details exist', () => {
    expect(
      isManualProposalRecord('', {
        proposer: { email: 'client@example.com' },
        risk: { lineOfBusiness: 'marine', description: 'Hull cover' },
      }, {}),
    ).toBe(true);
  });
});

describe('readCanonicalBreakdownLines', () => {
  // ADR-0035/0054 loadings and the ADR-0056 BDX declared-premium alignment
  // (kind `loading`/`discount`) are part of the price. Dropping them made the
  // detail rows sum to a different number than the total row.
  it('keeps loading and discount lines so detail rows sum to the total', () => {
    const lines = readCanonicalBreakdownLines({
      lines: [
        { code: 'base', label: 'Base premium', amount: 100, kind: 'base' },
        { code: 'loading.uwProfit', label: 'Premium adjustment', amount: 11, kind: 'loading' },
        { code: 'adjustment.bdxDeclaredAlignment', label: 'Bordereau declared premium alignment', amount: -40, kind: 'discount' },
        { code: 'weird', label: 'Unknown kind', amount: 5, kind: 'mystery' },
        { code: 'total', label: 'Total', amount: 71, kind: 'total' },
      ],
    });
    expect(lines.map((line) => line.code)).toEqual([
      'base',
      'loading.uwProfit',
      'adjustment.bdxDeclaredAlignment',
      'total',
    ]);
    expect(lines.find((line) => line.code === 'adjustment.bdxDeclaredAlignment')?.amount).toBe(-40);
  });
});

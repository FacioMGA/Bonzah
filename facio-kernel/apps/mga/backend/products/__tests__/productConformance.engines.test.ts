import { describe, expect, it } from 'vitest';
import { registerAllProducts } from '../registerProducts.js';
import { ProductRegistry } from '../../modules/policy/domain/ProductRegistry.js';
import { resolveProductEngines } from '../../modules/policy/domain/productEngines.js';
import { runWithOperatingTenant } from '../../platform/tenant/tenantAls.js';
import { getTenantConfig } from '../../platform/tenant/tenantConfig.js';
import { getTenantFixtures } from '../testHelpers/tenantFixtures.js';
import {
  ProductConfigurationError,
  resolveJurisdictionProductConfig,
} from '../../modules/jurisdiction/domain/productConfiguration.js';
import { fixtureProgrammeDefinition, fixtureRatingModelTables } from '../programDefinitionFixtures.js';

registerAllProducts();

function primaryAnnualPremium(quoteResponse: Record<string, unknown>): number {
  const primary = quoteResponse.primaryOption && typeof quoteResponse.primaryOption === 'object'
    ? quoteResponse.primaryOption as Record<string, unknown>
    : {};
  return Number(primary.annualPremium || primary.totalPremium || 0);
}

function normalizeOutcome(value: unknown): string {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const outcome = String(raw.outcome || raw.lane || '').trim().toLowerCase();
  if (outcome === 'accept' || outcome === 'green') return 'accept';
  if (outcome === 'referral' || outcome === 'refer' || outcome === 'yellow') return 'referral';
  if (outcome === 'decline' || outcome === 'red') return 'decline';
  return outcome;
}

// ---------------------------------------------------------------------------
// Tenant × product conformance matrix
// 4 tenants × 3 products = 12 assertions per PR
// ---------------------------------------------------------------------------

const tenants = getTenantFixtures();
const adapters = ProductRegistry.getInstance().getAllAdapters();

type MatrixEntry = {
  tenant: (typeof tenants)[number];
  adapter: (typeof adapters)[number];
};

/**
 * Some products are intentionally restricted to a subset of jurisdictions
 * (e.g. HEALTH Phase 1 — CY-only Brit Immigration Medical). The
 * jurisdiction config is the single source of truth: a (productCode,
 * countryCode) pair without a `CONFIGS` entry means the engines cannot
 * rate / issue in that tenant. Drop those combos from the conformance
 * matrix rather than asserting they fail; adding a config entry later
 * lights up the combo automatically.
 */
function jurisdictionSupported(productCode: string, tenant: (typeof tenants)[number]): boolean {
  try {
    resolveJurisdictionProductConfig({ productCode, tenant });
    return true;
  } catch (err) {
    if (err instanceof ProductConfigurationError) return false;
    throw err;
  }
}

const matrix: MatrixEntry[] = tenants.flatMap((tenant) =>
  adapters
    .filter((adapter) => jurisdictionSupported(adapter.productType, tenant))
    .map((adapter) => ({ tenant, adapter })),
);

describe('product engine conformance', () => {
  it.each(matrix)(
    '$tenant.tenantSlug × $adapter.productType engine conformance',
    async ({ tenant, adapter }) => {
      await runWithOperatingTenant(tenant, async () => {
        // Verify that the ALS context is correctly wired — getTenantConfig() must
        // return the per-tenant config (not the process-wide env-var singleton).
        const activeConfig = getTenantConfig();
        expect(activeConfig.tenantSlug).toBe(tenant.tenantSlug);
        expect(activeConfig.countryCode).toBe(tenant.countryCode);

        // IPT axis: every tenant must have an explicit IPT configuration
        // (either positive or explicitly zero). Cyprus binders (Home +
        // Travel) carry no policy-level IPT — the legacy schedules show
        // Local Taxes / Tax Fee = 0.00 — so `flatFee: 0` is a valid,
        // jurisdictionally-correct value, not an absence of config.
        const iptConfigured =
          typeof activeConfig.ipt.rate === 'number' ||
          typeof activeConfig.ipt.flatFee === 'number';
        expect(iptConfigured).toBe(true);

        const runtime = adapter.getRuntimeDefinition();
        expect(runtime).toBeTruthy();
        const fixtures = adapter.getGoldenFixtures();
        expect(fixtures.minimumValid).toBeTruthy();

        const engines = resolveProductEngines(runtime!.engines, {});
        expect(engines.rating.engineId).toBeTruthy();
        expect(['compiled', 'table', 'template']).toContain(engines.rating.kind);
        expect(engines.underwriting.engineId).toBeTruthy();
        expect(['compiled', 'table', 'template']).toContain(engines.underwriting.kind);
        expect(engines.wording.engineId).toBeTruthy();
        expect(['compiled', 'table', 'template']).toContain(engines.wording.kind);

        // Rating engine: premium must be positive under every jurisdiction.
        const fixtureTables = fixtureRatingModelTables(adapter.productType);
        const ratingModel = fixtureTables
          ? {
            id: `${adapter.productType.toLowerCase()}-fixture-model`,
            programId: 'fixture-program',
            version: 1,
            binderProductAuthorityId: 'fixture-authority',
            tables: fixtureTables,
          }
          : undefined;
        const rating = await engines.rating.calculate({
          productType: adapter.productType,
          quoteData: fixtures.minimumValid,
          context: { programDefinition: fixtureProgrammeDefinition(adapter.productType) },
          ...(ratingModel ? { ratingModel } : {}),
        });
        expect(Number(rating.premiumCalculation.premium)).toBeGreaterThan(0);

        // The public runtime evaluates UW from the same published definition
        // before it invokes its rating engine. Keep this cross-product check
        // on that spine rather than letting a rating engine invent a default.
        const uw = await engines.underwriting.evaluate({
          productType: adapter.productType,
          quoteData: fixtures.minimumValid,
          context: { programDefinition: fixtureProgrammeDefinition(adapter.productType) },
        });
        expect(['accept', 'referral', 'decline']).toContain(normalizeOutcome(uw.decision));

        const quote = await engines.rating.buildQuoteResponse({
          productType: adapter.productType,
          quoteData: fixtures.minimumValid,
          context: { programDefinition: fixtureProgrammeDefinition(adapter.productType) },
          uwDecision: uw.decision,
          ...(ratingModel ? { ratingModel } : {}),
        });
        expect(primaryAnnualPremium(quote.quoteResponse)).toBeGreaterThan(0);

        // Configurable UW engines must expose a validator for programme publication.
        if (engines.underwriting.validateProgramUwConfig) {
          expect(engines.underwriting.validateProgramUwConfig).toBeTypeOf('function');
        }

        // Wording engine: doc-pack job name must resolve under every jurisdiction.
        expect(engines.wording.getDocPackJobName()).toBeTruthy();

        // Issuance validation: must flag an empty object as invalid under every jurisdiction.
        const emptyValidation = await adapter.validateForIssuance({});
        expect(emptyValidation.valid).toBe(false);
        expect(
          emptyValidation.missingForIssuedPack.length + emptyValidation.schemaIssues.length,
        ).toBeGreaterThan(0);

        const issuable = fixtures.minimumIssuable || fixtures.minimumValid;
        const validValidation = await adapter.validateForIssuance(issuable);
        expect(validValidation.valid).toBe(true);
      });
    },
  );
});

// ---------------------------------------------------------------------------
// Greece (GR) go-live product parity with Cyprus (CY)
// Greece excludes HEALTH (ADR-0053) and the unoffered MOTOR line (ADR-0100).
// ---------------------------------------------------------------------------
describe('Greece (GR) product parity with Cyprus (CY)', () => {
  const cy = tenants.find((t) => t.countryCode === 'CY');
  const gr = tenants.find((t) => t.countryCode === 'GR');
  const productCodes = adapters.map((adapter) => adapter.productType);

  it('GR fixtures and CY fixtures both exist', () => {
    expect(cy).toBeTruthy();
    expect(gr).toBeTruthy();
  });

  it('GR supports CY products except HEALTH (ADR-0053) and MOTOR (ADR-0100)', () => {
    const cySupported = productCodes.filter((p) => jurisdictionSupported(p, cy!)).sort();
    const grSupported = productCodes.filter((p) => jurisdictionSupported(p, gr!)).sort();
    // HEALTH is Cyprus-only (Brit Immigration Medical); extending it to Greece
    // encodes a new regulatory interpretation and is blocked by ADR-0053.
    const expectedForGr = cySupported.filter((p) => p !== 'HEALTH' && p !== 'MOTOR');
    expect(grSupported).toEqual(expectedForGr);
  });

  it('HEALTH is CY-only until ADR-0053 is accepted', () => {
    expect(jurisdictionSupported('HEALTH', cy!)).toBe(true);
    expect(jurisdictionSupported('HEALTH', gr!)).toBe(false);
  });

  it('BUSINESS and OPEN_MARKET are enabled for GR (parity with CY)', () => {
    expect(jurisdictionSupported('BUSINESS', gr!)).toBe(true);
    expect(jurisdictionSupported('OPEN_MARKET', gr!)).toBe(true);
  });
});

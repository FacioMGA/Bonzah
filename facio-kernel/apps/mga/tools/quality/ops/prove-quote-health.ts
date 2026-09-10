#!/usr/bin/env tsx
/**
 * Quote-health canary — the "can a customer actually get a price right now?"
 * tracker (ADR-0066).
 *
 * The Aug 2026 outage taught us that a business-stopping condition (no online
 * quotes) can look completely healthy to crash-based monitoring: every request
 * returned a tidy HTTP 503, nothing threw, and no alert fired for days. This
 * canary closes that gap from the OTHER side: instead of waiting for an error,
 * it actively proves — on a schedule — that the product engine still produces a
 * price for a known-good application in each configured product. If it can't,
 * it alerts a human immediately and exits non-zero (a failed CronJob run).
 *
 * It is deliberately credit-free: it exercises the in-process product rating
 * path (`buildQuoteResponse` over the golden fixtures), NOT the paid Creditsafe
 * screening call — the sanctions fail-closed class is already surfaced to
 * Sentry from real traffic (sentry-alerts.md rule 6). Together the two layers
 * cover "customer cannot get a price" from both the engine side (this canary)
 * and the compliance-gate side (the fail-closed signal).
 */

type ProductAdapter = {
  productType: string;
  displayName: string;
  getGoldenFixtures: () => {
    minimumIssuable?: Record<string, unknown>;
    minimumValid: Record<string, unknown>;
  };
  buildQuoteResponse: (
    quoteData: Record<string, unknown>,
    context: Record<string, unknown>,
  ) => Promise<{ quoteResponse: unknown }>;
};

type RuntimeDeps = {
  registerAllProducts: () => void;
  ProductRegistry: {
    getInstance: () => { getAllAdapters: () => ProductAdapter[] };
  };
  buildTenantConfigFromEnv: () => { id: string; tenantSlug: string; country: string };
  runWithOperatingTenant: <T>(tenantConfig: unknown, fn: () => Promise<T>) => Promise<T>;
  dispatchCustomerEmailTrigger: (input: {
    trigger: 'UW_INFO_REQUESTED';
    entityType: 'ACCOUNT';
    entityId: string;
    toEmail: string;
    variables: Record<string, unknown>;
    idempotencySeed?: string;
    forceSystemOnly?: boolean;
  }) => Promise<{ messageId?: string; skipped?: boolean; reason?: string }>;
};

async function importFirst<T>(specifiers: string[]): Promise<T> {
  const errors: unknown[] = [];
  for (const specifier of specifiers) {
    try {
      return (await import(specifier)) as T;
    } catch (error) {
      errors.push(error);
      const code = String((error as { code?: string })?.code || '');
      if (code !== 'ERR_MODULE_NOT_FOUND') throw error;
    }
  }
  throw new AggregateError(errors, `Unable to load module from candidates: ${specifiers.join(', ')}`);
}

async function loadRuntimeDeps(): Promise<RuntimeDeps> {
  const productsModule = await importFirst<{ registerAllProducts: () => void }>([
    '../../../backend/products/registerProducts.js',
    '../../../backend/dist/products/registerProducts.js',
  ]);
  const registryModule = await importFirst<{ ProductRegistry: RuntimeDeps['ProductRegistry'] }>([
    '../../../backend/modules/policy/domain/ProductRegistry.js',
    '../../../backend/dist/modules/policy/domain/ProductRegistry.js',
  ]);
  const tenantConfigModule = await importFirst<{ buildTenantConfigFromEnv: RuntimeDeps['buildTenantConfigFromEnv'] }>([
    '../../../backend/platform/tenant/tenantConfigForCli.js',
    '../../../backend/dist/platform/tenant/tenantConfigForCli.js',
  ]);
  const tenantAlsModule = await importFirst<{ runWithOperatingTenant: RuntimeDeps['runWithOperatingTenant'] }>([
    '../../../backend/platform/tenant/tenantAls.js',
    '../../../backend/dist/platform/tenant/tenantAls.js',
  ]);
  const emailTriggerModule = await importFirst<{ dispatchCustomerEmailTrigger: RuntimeDeps['dispatchCustomerEmailTrigger'] }>([
    '../../../backend/modules/communications/app/customerEmailTriggerService.js',
    '../../../backend/dist/modules/communications/app/customerEmailTriggerService.js',
  ]);
  return {
    registerAllProducts: productsModule.registerAllProducts,
    ProductRegistry: registryModule.ProductRegistry,
    buildTenantConfigFromEnv: tenantConfigModule.buildTenantConfigFromEnv,
    runWithOperatingTenant: tenantAlsModule.runWithOperatingTenant,
    dispatchCustomerEmailTrigger: emailTriggerModule.dispatchCustomerEmailTrigger,
  };
}

const {
  registerAllProducts,
  ProductRegistry,
  buildTenantConfigFromEnv,
  runWithOperatingTenant,
  dispatchCustomerEmailTrigger,
} = await loadRuntimeDeps();

// A non-empty link is REQUIRED by the internal alert template
// (`UW_INFO_REQUEST.variablesSchema['uw.url'] = 'required'`). Passing an
// empty string makes `validateVariables` treat it as missing and the whole
// dispatch is silently skipped — which is exactly how this canary's alert
// used to no-op. Point it at the runbook so the alert both queues AND tells
// the responder where to go.
const RUNBOOK_URL = String(
  process.env.QUOTE_HEALTH_RUNBOOK_URL ||
    'https://github.com/FacioMGA/abbeygate/blob/main/docs/operate/quote-health-canary.md',
).trim();

const PREMIUM_KEY = /premium|totalpayable|grosspremium|totalprice|amountdue|total\b|price\b/i;

/**
 * Walk a quote response for any positive numeric premium-like value. A price of
 * zero or a missing premium on a known-good application is treated as a
 * pricing failure, not a healthy quote.
 */
function hasPositivePremium(value: unknown, depth = 0): boolean {
  if (depth > 6 || value == null || typeof value !== 'object') return false;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (PREMIUM_KEY.test(key) && Number.isFinite(num) && num > 0) return true;
    if (raw && typeof raw === 'object' && hasPositivePremium(raw, depth + 1)) return true;
  }
  return false;
}

type ProductHealth = { productType: string; priced: boolean; error: string | null };

const tenant = buildTenantConfigFromEnv();
const alertTo = String(process.env.QUOTE_HEALTH_ALERT_TO || process.env.ISSUANCE_PROOF_ALERT_TO || '').trim();
const productFilter = new Set(
  String(process.env.QUOTE_HEALTH_PRODUCTS || 'MOTOR,HOME,TRAVEL')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
);

async function priceProduct(adapter: ProductAdapter): Promise<ProductHealth> {
  try {
    const fixture = adapter.getGoldenFixtures().minimumValid;
    const quoteData = structuredClone(fixture) as Record<string, unknown>;
    const { quoteResponse } = await runWithOperatingTenant(tenant, () =>
      adapter.buildQuoteResponse(quoteData, {}),
    );
    if (!quoteResponse || typeof quoteResponse !== 'object') {
      return { productType: adapter.productType, priced: false, error: 'no quoteResponse returned' };
    }
    if (!hasPositivePremium(quoteResponse)) {
      return { productType: adapter.productType, priced: false, error: 'quoteResponse carried no positive premium' };
    }
    return { productType: adapter.productType, priced: true, error: null };
  } catch (error) {
    return {
      productType: adapter.productType,
      priced: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function sendFailureAlert(failures: ProductHealth[]): Promise<void> {
  if (!alertTo) return;
  const lines = failures.map((f) => `- ${f.productType}: ${f.error}`);
  const message = [
    'CRITICAL: online quoting is DOWN for at least one product.',
    `Tenant: ${tenant.tenantSlug} (${tenant.country})`,
    '',
    'Products that failed to price a known-good application:',
    ...lines,
    '',
    'This means new-business sales are blocked. See docs/operate/quote-health-canary.md.',
  ].join('\n');
  const result = await runWithOperatingTenant(tenant, () =>
    dispatchCustomerEmailTrigger({
      trigger: 'UW_INFO_REQUESTED',
      entityType: 'ACCOUNT',
      entityId: alertTo.toLowerCase(),
      toEmail: alertTo,
      variables: {
        customer: { firstName: 'team' },
        uw: { message, url: RUNBOOK_URL },
      },
      idempotencySeed: `quote-health:${failures.map((f) => f.productType).join(',')}:${new Date().toISOString().slice(0, 13)}`,
      forceSystemOnly: true,
    }),
  );
  // Fail loud: a skipped dispatch means the human alert never queued, which is
  // the whole failure mode this canary exists to prevent. Surface it so the
  // CronJob run is unambiguously red rather than pretending it alerted.
  if (result.skipped) {
    throw new Error(`quote-health alert was NOT queued: ${result.reason || 'dispatch skipped'}`);
  }
}

async function main(): Promise<void> {
  registerAllProducts();
  const adapters = ProductRegistry.getInstance()
    .getAllAdapters()
    .filter((a) => productFilter.size === 0 || productFilter.has(a.productType.toUpperCase()));

  const results: ProductHealth[] = [];

  // A configured product with no registered adapter is a FAILURE, not a
  // silent pass. Without this, losing (say) the Travel adapter would leave
  // Motor + Home to price fine and the canary would declare all-healthy even
  // though Travel quoting is unavailable.
  const matched = new Set(adapters.map((a) => a.productType.toUpperCase()));
  for (const wanted of productFilter) {
    if (!matched.has(wanted)) {
      results.push({
        productType: wanted,
        priced: false,
        error: 'no product adapter registered for this configured product',
      });
    }
  }

  if (adapters.length === 0 && productFilter.size === 0) {
    throw new Error('No product adapters registered at all');
  }

  for (const adapter of adapters) {
    results.push(await priceProduct(adapter));
  }

  const failures = results.filter((r) => !r.priced);
  const summary = results.map((r) => `${r.productType}=${r.priced ? 'OK' : 'FAIL'}`).join(' ');
  console.log(`[quote-health] tenant=${tenant.tenantSlug} ${summary}`);

  if (failures.length > 0) {
    for (const f of failures) console.error(`[quote-health] ${f.productType}: ${f.error}`);
    await sendFailureAlert(failures);
    process.exitCode = 1;
    return;
  }
  console.log('[quote-health] all products priced a known-good application — quoting is healthy.');
}

await main();

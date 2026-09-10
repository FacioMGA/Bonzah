import { signingSecretErrors } from './signingSecrets.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../db/connection.js';
import { getPolicyListRegistry } from '../../modules/policy/infra/projections/policyListRegistry.js';
import { isStorageTemplatePath, readTemplateUploadMode } from './templateUploadMode.js';
import { getIntegrationStatuses } from './integrationHealth.js';

import { logger } from '../utils/logger.js';
type OptionalDocxRequirement = {
  name: string;
  envVar: string;
  settingsKey?: 'localCertificateTemplatePath' | 'localQuoteTemplatePath' | 'localInvoiceTemplatePath';
};

// DOCX templates are optional in the new architecture (underwriter-editable lane).
// If configured, we validate they exist; but we do not fail startup if missing.
const OPTIONAL_DOCX: OptionalDocxRequirement[] = [
  { name: 'certificate_docx', envVar: 'DOCGEN_CERTIFICATE_TEMPLATE_PATH', settingsKey: 'localCertificateTemplatePath' },
  { name: 'quote_docx', envVar: 'DOCGEN_QUOTE_TEMPLATE_PATH', settingsKey: 'localQuoteTemplatePath' },
  { name: 'invoice_docx', envVar: 'DOCGEN_INVOICE_TEMPLATE_PATH', settingsKey: 'localInvoiceTemplatePath' },
];

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

// HTML templates are required for the fast-path (B2C) generation lane.
//
// ADR-0019 / ABY-97 — Home + Travel templates were silently absent
// from the production image (Dockerfile.api only COPYed motor
// templates). The customer wizard polled `pending` forever because
// every home/travel issuance threw ENOENT inside the worker and the
// missing audit-row gap meant no `failed` outcome was emitted.
// Listing them here makes the API/worker fail loudly at boot in any
// environment where the build/copy plumbing is broken.
const REQUIRED_HTML_TEMPLATES: Array<{ name: string; relPath: string }> = [
  { name: 'motor_certificate_html', relPath: '../../products/motor/documents/templates/certificate.html' },
  { name: 'motor_schedule_html', relPath: '../../products/motor/documents/templates/schedule.html' },
  { name: 'motor_endorsements_html', relPath: '../../products/motor/documents/templates/endorsements.html' },
  { name: 'invoice_html', relPath: '../../products/motor/documents/templates/invoice.html' },
  // Home pack omits a standalone Certificate template on purpose: the
  // Schedule's first page is the Lloyd's policy jacket, so a sibling
  // Certificate would duplicate the same cover under a different
  // filename. See the matching comment in
  // `backend/products/home/documents/documentPackContract.ts`.
  { name: 'home_schedule_html', relPath: '../../products/home/documents/templates/schedule.html' },
  { name: 'home_statement_of_fact_html', relPath: '../../products/home/documents/templates/statement-of-fact.html' },
  { name: 'travel_certificate_html', relPath: '../../products/travel/documents/templates/certificate.html' },
  { name: 'travel_schedule_html', relPath: '../../products/travel/documents/templates/schedule.html' },
  { name: 'travel_ipid_html', relPath: '../../products/travel/documents/templates/ipid.html' },
  { name: 'travel_medical_card_html', relPath: '../../products/travel/documents/templates/medical-card.html' },
];

// ADR-0019 / ABY-97 — `staticPdf` doc-pack entries (HOME IPID, policy
// wording, Europ Assistance booklet) resolve their paths via
// `documentPackContract.ts` walking up to `<repo_root>/artifacts/...`.
// In a built image, "repo_root" is the working directory the process
// was launched from. If the COPY in Dockerfile.api is wrong, the worker
// throws ENOENT during issuance — which the new ADR-0019 audit path
// turns into `customerOutcome: 'failed'` for the user, but boot-time
// validation lets us catch the misconfiguration before any policy is
// ever issued.
const REQUIRED_STATIC_PDFS: Array<{ name: string; relPath: string }> = [
  {
    name: 'motor_ipid_portugal_static_pdf',
    relPath: '../../products/motor/documents/static/Abbeygate_Motor_Portugal_IPID_LIC_Santam_August2026.pdf',
  },
  {
    name: 'travel_ipid_annual_static_pdf',
    relPath: '../../products/travel/documents/static/Brit_Travel_AnnualMultiTrip_IPID.pdf',
  },
  {
    name: 'health_ipid_static_pdf',
    relPath: '../../products/health/documents/static/BritImmigrationHealthIPID.pdf',
  },
  {
    name: 'health_policy_wording_static_pdf',
    relPath: '../../products/health/documents/static/Abbeygate_Immigration_Health_Wording.pdf',
  },
  {
    name: 'motor_policy_wording_cyprus_static_pdf',
    relPath: '../../products/motor/documents/static/Abbeygate_Motor_Cyprus_Policy_Wording_AB-S-1-2026.pdf',
  },
  {
    name: 'motor_policy_wording_portugal_static_pdf',
    relPath: '../../products/motor/documents/static/Abbeygate_Motor_Portugal_Policy_Wording_AB-S-1-2026.pdf',
  },
  {
    name: 'motor_policy_wording_spain_static_pdf',
    relPath: '../../products/motor/documents/static/Abbeygate_Motor_Spain_Policy_Wording_AB-S-1-2026.pdf',
  },
  {
    name: 'home_ipid_static_pdf',
    relPath: '../../products/home/documents/static/BeazleyHome_IPID_CyprusGreeceWithSubsidence2023.pdf',
  },
  {
    name: 'home_ipid_spain_portugal_static_pdf',
    relPath: '../../products/home/documents/static/BeazleyHome_IPID_SpainAndPortugal.pdf',
  },
  {
    name: 'home_policy_wording_cyprus_nonuk_static_pdf',
    relPath: '../../products/home/documents/static/Beazley_Lloyds_Home_Policy_Wording_Cyprus_(CyprusDomiciled).pdf',
  },
  // ADR-0048 — tenant + domicile-aware Home wordings. Every configured
  // wording must exist at boot so a missing asset fails loudly before any
  // Home policy is issued (rather than emitting the wrong territory's wording).
  {
    name: 'home_policy_wording_cyprus_uk_static_pdf',
    relPath: '../../products/home/documents/static/LloydsHomePolicyWordingCyprus(UKDomiciled)_2024.pdf',
  },
  {
    name: 'home_policy_wording_portugal_nonuk_static_pdf',
    relPath: '../../products/home/documents/static/Beazley_Home_Portugal_Domiciled_Policy_Wording_Amended_Clean.pdf',
  },
  {
    name: 'home_policy_wording_portugal_uk_static_pdf',
    relPath: '../../products/home/documents/static/Beazley_Home_Portugal_UK_Domiciled_Policy_Wording_Amended_Clean.pdf',
  },
  {
    name: 'home_policy_wording_greece_nonuk_static_pdf',
    relPath: '../../products/home/documents/static/Abbeygate_Home_Greece_Domiciled.pdf',
  },
  {
    name: 'home_policy_wording_greece_uk_static_pdf',
    relPath: '../../products/home/documents/static/Abbeygate_Home_Greece_UK_Domiciled.pdf',
  },
  {
    name: 'home_europ_assistance_static_pdf',
    relPath: '../../products/home/documents/static/NDP82515223207-04-2026.pdf',
  },
  {
    name: 'travel_policy_wording_static_pdf',
    relPath: '../../products/travel/documents/static/Brit_Travel_Policy_Wording_Amended_Clean.pdf',
  },
  // ADR-0047 — tenant terms-of-business PDFs attached to every outbound
  // customer email for CY + PT. `tenantTermsAttachment.ts` reads these
  // synchronously on the send path; a missing asset threw ENOENT and blocked
  // ALL customer emails for those territories across every product. Fail
  // loudly at boot instead of at first send.
  {
    name: 'tenant_terms_cyprus_static_pdf',
    relPath: '../../modules/communications/infra/adapters/static/TermsAndConditions_CY.pdf',
  },
  {
    name: 'tenant_terms_portugal_static_pdf',
    relPath: '../../modules/communications/infra/adapters/static/TermsAndConditions_PT.pdf',
  },
];

function isProd(): boolean {
  return (process.env.NODE_ENV || 'development') === 'production';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isCreditsafeEnabled(): boolean {
  const raw = String(process.env.CREDITSAFE_ENABLED || '').trim().toLowerCase();
  if (!raw) return false;
  return !['0', 'false', 'no', 'off', 'disabled'].includes(raw);
}

function checkFileReadable(relOrAbsPath: string): { ok: boolean; resolved: string; reason?: string } {
  const resolved = path.isAbsolute(relOrAbsPath)
    ? relOrAbsPath
    : path.resolve(moduleDir, relOrAbsPath);

  if (!fs.existsSync(resolved)) return { ok: false, resolved, reason: 'missing' };
  try {
    const st = fs.statSync(resolved);
    if (!st || st.size === 0) return { ok: false, resolved, reason: 'empty' };
    return { ok: true, resolved };
  } catch (e: unknown) {
    return { ok: false, resolved, reason: e instanceof Error ? e.message : 'stat_failed' };
  }
}

async function readLatestSettingsWithTimeout(timeoutMs = 3000): Promise<Record<string, unknown> | null> {
  // Tenant settings are checked when a workspace is selected; startup has no MGA scope.
  if (process.env.KERNEL_PLATFORM_MODE === 'true') return null;
  try {
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    });
    const settingsPromise = prisma.settings.findFirst({ orderBy: { updatedAt: 'desc' } }) // guard:cross-tenant-intentional — legacy standalone deployment only; platform returns above
      .then((settings) => asRecord(settings))
      .catch((error: unknown) => {
        logger.warn(`[StartupValidation] Failed to load settings during startup validation: ${String(error instanceof Error ? error.message : error)}`);
        return null;
      });
    return await Promise.race([settingsPromise, timeout]);
  } catch (error: unknown) {
    logger.warn(`[StartupValidation] Unexpected settings lookup failure during startup validation: ${String(error instanceof Error ? error.message : error)}`);
    return null;
  }
}

export async function validateStartupConfig(): Promise<void> {
  const templateUploadMode = readTemplateUploadMode();
  logger.info('[StartupValidation] Starting startup validation checks');
  const settings = await readLatestSettingsWithTimeout();
  if (!settings) {
    logger.warn('[StartupValidation] Settings lookup timed out or returned nothing; continuing with environment-only startup validation.');
  }
  const storageProvider = String(process.env.STORAGE_PROVIDER || 'local').trim().toLowerCase();
  const storageConnectionString = String(process.env.STORAGE_CONNECTION_STRING || '').trim();
  const storageContainerName = String(process.env.STORAGE_CONTAINER_NAME || '').trim();

  const errors: string[] = [];
  const warnings: string[] = [];

  errors.push(...signingSecretErrors(process.env));
  const inboundWebhookSecret = String(process.env.INBOUND_WEBHOOK_SECRET || '').trim();
  const sendgridEventPublicKey = String(process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY || '').trim();
  const externalDeliveryEnabled = process.env.KERNEL_PLATFORM_MODE !== 'true' || process.env.KERNEL_EXTERNAL_DELIVERY_ENABLED === 'true';
  if (isProd() && externalDeliveryEnabled && !inboundWebhookSecret) {
    errors.push('[StartupValidation] INBOUND_WEBHOOK_SECRET is required in production for inbound webhook authentication.');
  }
  if (isProd() && externalDeliveryEnabled && !sendgridEventPublicKey) {
    errors.push('[StartupValidation] SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY is required in production for SendGrid event webhook verification.');
  }

  // 0b) Production AKS must keep durable files off pod-local storage.
  if (isProd() && storageProvider !== 'azure') {
    errors.push('[StartupValidation] STORAGE_PROVIDER must be set to azure in production. Pod-local document storage is not permitted.');
  }
  if (isProd() && templateUploadMode !== 'storage') {
    errors.push('[StartupValidation] TEMPLATE_UPLOAD_MODE must be storage in production. Disk-backed templates are not permitted.');
  }
  const allowStubBehaviorEmbeddings = String(process.env.ALLOW_STUB_EMBEDDINGS_IN_PRODUCTION || '').trim().toLowerCase() === 'true';
  const behaviorEnabled = process.env.KERNEL_PLATFORM_MODE !== 'true' || process.env.KERNEL_BEHAVIOR_EMBEDDINGS_ENABLED === 'true';
  if (isProd() && behaviorEnabled && !String(process.env.OPENAI_API_KEY || '').trim() && !allowStubBehaviorEmbeddings) {
    errors.push('[StartupValidation] OPENAI_API_KEY is required for production behavior embeddings. Set ALLOW_STUB_EMBEDDINGS_IN_PRODUCTION=true only for an explicitly approved degraded run.');
  }
  if (storageProvider === 'azure') {
    if (!storageConnectionString && !process.env.KERNEL_STORAGE_ACCOUNT) {
      const msg = '[StartupValidation] STORAGE_CONNECTION_STRING is required when STORAGE_PROVIDER=azure.';
      if (isProd()) errors.push(msg);
      else warnings.push(msg);
    }
    if (!storageContainerName) {
      const msg = '[StartupValidation] STORAGE_CONTAINER_NAME is required when STORAGE_PROVIDER=azure.';
      if (isProd()) errors.push(msg);
      else warnings.push(msg);
    }
  }

  // 1) Required HTML templates (fail-fast in prod)
  for (const t of REQUIRED_HTML_TEMPLATES) {
    const chk = checkFileReadable(t.relPath);
    if (!chk.ok) {
      const msg = `[StartupValidation] Missing required HTML template '${t.name}' (${chk.reason}). Path: ${t.relPath} → ${chk.resolved}`;
      if (isProd()) errors.push(msg);
      else warnings.push(msg);
    }
  }

  // 1b) Required static PDF assets (ADR-0019 / ABY-97).
  for (const t of REQUIRED_STATIC_PDFS) {
    const chk = checkFileReadable(t.relPath);
    if (!chk.ok) {
      const msg = `[StartupValidation] Missing required static PDF '${t.name}' (${chk.reason}). Path: ${t.relPath} → ${chk.resolved}`;
      if (isProd()) errors.push(msg);
      else warnings.push(msg);
    }
  }

  // 2) Optional DOCX templates (warn-only if configured but missing)
  for (const r of OPTIONAL_DOCX) {
    const settingsRecord = asRecord(settings);
    const fromSettings = r.settingsKey ? settingsRecord[r.settingsKey] : '';
    const candidate = String(process.env[r.envVar] || fromSettings || '').trim();
    if (!candidate) continue;
    if (templateUploadMode === 'storage' && !isStorageTemplatePath(candidate)) {
      errors.push(`[StartupValidation] ${r.envVar} must be a storage URI in TEMPLATE_UPLOAD_MODE=storage. Current value '${candidate}' is legacy disk path. Re-upload the template.`);
      continue;
    }
    if (templateUploadMode === 'disk' && isStorageTemplatePath(candidate)) {
      errors.push(`[StartupValidation] ${r.envVar} must be a disk path in TEMPLATE_UPLOAD_MODE=disk. Current value '${candidate}' is a storage URI.`);
      continue;
    }
    if (templateUploadMode === 'storage') {
      continue;
    }
    const chk = checkFileReadable(candidate);
    if (!chk.ok) {
      const msg = `[StartupValidation] Optional DOCX template missing/invalid (${chk.reason}). ${r.envVar}=${candidate} → ${chk.resolved}. Re-upload template.`;
      if (isProd()) errors.push(msg);
      else warnings.push(msg);
    }
  }

  // 3) Recommendations / bandit flags sanity
  const recsEnabled = String(process.env.RECS_ENABLED_PUBLIC_AUTO || 'true').toLowerCase() !== 'false';
  const recsPct = Number(process.env.RECS_ENABLED_PERCENT ?? 1);
  if (recsEnabled && !(Number.isFinite(recsPct) && recsPct >= 0 && recsPct <= 1)) {
    warnings.push(`[StartupValidation] RECS_ENABLED_PERCENT must be between 0 and 1. Got: ${String(process.env.RECS_ENABLED_PERCENT)}`);
  }
  const provider = String(process.env.RECS_PROVIDER || 'frequency').toLowerCase();
  if (recsEnabled && provider === 'remote' && !String(process.env.RECS_REMOTE_URL || '').trim()) {
    warnings.push('[StartupValidation] RECS_PROVIDER=remote but RECS_REMOTE_URL is not set (recs will degrade to empty probabilities).');
  }
  if (recsEnabled && provider !== 'remote' && !String(process.env.RECS_ARTIFACT_PATH || '').trim()) {
    warnings.push('[StartupValidation] RECS_ARTIFACT_PATH not set (frequency provider will return zero probabilities).');
  }
  const banditEnabled = String(process.env.RECS_BANDIT_ENABLED || '').toLowerCase() === 'true';
  const banditPct = Number(process.env.RECS_BANDIT_PERCENT ?? 1);
  if (banditEnabled && !(Number.isFinite(banditPct) && banditPct >= 0 && banditPct <= 1)) {
    warnings.push(`[StartupValidation] RECS_BANDIT_PERCENT must be between 0 and 1. Got: ${String(process.env.RECS_BANDIT_PERCENT)}`);
  }

  // 5) Creditsafe sanctions provider (fail closed when enabled but misconfigured)
  const creditsafeEnabled = isCreditsafeEnabled();
  if (creditsafeEnabled) {
    const baseUrl = String(process.env.CREDITSAFE_BASE_URL || '').trim();
    const username = String(process.env.CREDITSAFE_USERNAME || '').trim();
    const password = String(process.env.CREDITSAFE_PASSWORD || '').trim();
    if (!baseUrl || !username || !password) {
      errors.push('[StartupValidation] Creditsafe sanctions screening is enabled but CREDITSAFE_BASE_URL/CREDITSAFE_USERNAME/CREDITSAFE_PASSWORD are not fully configured.');
    }
    const threshold = Number(process.env.CREDITSAFE_THRESHOLD || 90);
    if (![75, 80, 85, 90, 95, 100].includes(threshold)) {
      errors.push(`[StartupValidation] CREDITSAFE_THRESHOLD must be one of 75,80,85,90,95,100. Got '${String(process.env.CREDITSAFE_THRESHOLD || '')}'.`);
    }
    const datasets = String(process.env.CREDITSAFE_DATASETS || 'SAN-CURRENT').trim();
    if (!datasets) {
      errors.push('[StartupValidation] CREDITSAFE_DATASETS must include at least one dataset (e.g. SAN-CURRENT).');
    }
  }

  // 6) Policy list registry contract
  try {
    const reg = getPolicyListRegistry();
    if (!Number.isFinite(Number(reg.registryVersion)) || Number(reg.registryVersion) <= 0) {
      errors.push('[StartupValidation] policy-list-registry.json has invalid registryVersion.');
    }
  } catch (e: unknown) {
    errors.push(`[StartupValidation] policy-list-registry.json is invalid: ${String(e instanceof Error ? e.message : e)}`);
  }

  // 7) Provider integrations (CardCorp, Creditsafe, …) — print a loud, prefixed
  // line per integration so deploy logs surface a missing K8s secret key the
  // moment the pod boots, not at the first checkout/screening attempt. We do
  // not throw: some non-prod environments intentionally run without CardCorp.
  for (const integration of getIntegrationStatuses()) {
    if (integration.configured) {
      logger.info(`[StartupValidation] Integration '${integration.id}' (${integration.name}) configured.`);
      continue;
    }
    const detail = `env: ${integration.envVars.join(', ')}`;
    const message =
      `[StartupValidation] Integration '${integration.id}' (${integration.name}) is NOT configured (${detail}). ` +
      `Checkout/refund/screening calls that depend on it will return 501 NOT_CONFIGURED until the secret is set.`;
    if (integration.required) {
      // Surface as an error in the warnings stream so it appears in red in
      // most log shippers, but do not throw — keeping the pod up lets the new
      // /health/integrations endpoint report status to ops dashboards.
      logger.error(message);
    } else {
      warnings.push(message);
    }
  }

  warnings.forEach((w) => logger.warn(w));
  if (errors.length) {
    errors.forEach((e) => logger.error(e));
    throw new Error(`Startup validation failed (${errors.length} errors).`);
  }
  logger.info('[StartupValidation] Startup validation checks completed');
}

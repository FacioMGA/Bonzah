import { CreditsafeSanctionsProvider, DEFAULT_BLOCKING_DATASETS } from '../infra/creditsafeSanctionsProvider.js';
import { CreditsafeClient } from '../infra/creditsafeClient.js';
import { SanctionsRepository } from '../infra/sanctionsRepository.js';
import { SanctionsService } from './sanctionsService.js';
import type { SanctionSearchProvider } from '../domain/sanctionsProvider.js';

function parseThreshold(raw: string | undefined): 75 | 80 | 85 | 90 | 95 | 100 {
  const n = Number(raw || 90);
  if (n === 75 || n === 80 || n === 85 || n === 90 || n === 95 || n === 100) return n;
  return 90;
}

/**
 * Default Creditsafe KYC Protect AML dataset selection. Per Lloyd's
 * binder sanctions clauses (LMA3100 family) and MLR 2017 reg 28(11)
 * CDD obligations, we screen against **every** AML category the
 * provider offers, not just the active sanctions list:
 *
 *   SAN-CURRENT     current sanctions
 *   SAN-FORMER      former sanctions (kept for audit & due diligence)
 *   PEP-CURRENT     current Politically Exposed Persons (all tiers)
 *   PEP-FORMER      former PEPs
 *   PEP-LINKED      PEP by association
 *   AM              adverse media
 *   ENF             enforcement actions
 *   INS             insolvency
 *   DD              disqualified directors
 *   POI             profile of interest
 *
 * Each dataset costs zero extra Creditsafe credits at the search level
 * (credit is per search, not per dataset). Surface area for false
 * positives grows, which is why the BO underwriting + premium tabs show
 * the top-hit row and full PDF for human triage rather than auto-clear.
 *
 * The smoke verifier (`tools/smoke/sanctions-screening-verify.mjs`)
 * deliberately stays on `SAN-CURRENT` only — see the comment there.
 */
const DEFAULT_AML_DATASETS = [
  'SAN-CURRENT',
  'SAN-FORMER',
  'PEP-CURRENT',
  'PEP-FORMER',
  'PEP-LINKED',
  'AM',
  'ENF',
  'INS',
  'DD',
  'POI',
] as const;

function parseDatasets(raw: string | undefined): string[] {
  const value = String(raw || '').trim();
  if (!value) return [...DEFAULT_AML_DATASETS];
  return value.split(',').map((x) => x.trim()).filter(Boolean);
}

function parseBlockingDatasets(raw: string | undefined): string[] {
  const value = String(raw || '').trim();
  if (!value) return [...DEFAULT_BLOCKING_DATASETS];
  return value.split(',').map((x) => x.trim()).filter(Boolean);
}

function isCreditsafeEnabled(): boolean {
  const raw = String(process.env.CREDITSAFE_ENABLED || '').trim().toLowerCase();
  if (!raw) return false;
  return !['0', 'false', 'no', 'off', 'disabled'].includes(raw);
}

const disabledProvider: SanctionSearchProvider = {
  async searchIndividual() {
    return {
      provider: 'creditsafe',
      outcome: 'clear',
      blocking: false,
      hitCount: 0,
      providerStatus: 'disabled',
      providerRiskRating: 'disabled',
      raw: { disabled: true },
    };
  },
  async downloadIndividualSearchPdf() {
    return null;
  },
};

let service: SanctionsService | null = null;

export function getSanctionsService(): SanctionsService {
  if (service) return service;

  const baseUrl = String(process.env.CREDITSAFE_BASE_URL || '').trim().replace(/\/+$/, '');
  const username = String(process.env.CREDITSAFE_USERNAME || '').trim();
  const password = String(process.env.CREDITSAFE_PASSWORD || '').trim();
  const threshold = parseThreshold(process.env.CREDITSAFE_THRESHOLD);
  const datasets = parseDatasets(process.env.CREDITSAFE_DATASETS);
  const blockingDatasets = parseBlockingDatasets(process.env.CREDITSAFE_BLOCKING_DATASETS);
  const provider = isCreditsafeEnabled() && baseUrl && username && password
    ? new CreditsafeSanctionsProvider(
      new CreditsafeClient({
        baseUrl,
        username,
        password,
        timeoutMs: Math.max(1000, Number(process.env.CREDITSAFE_TIMEOUT_MS || 10000)),
        tokenTtlMs: 10 * 60 * 1000,
      }),
      { threshold, datasets, blockingDatasets }
    )
    : disabledProvider;
  const repository = new SanctionsRepository();
  service = new SanctionsService({
    provider,
    repository,
    threshold,
    datasets,
  });
  return service;
}

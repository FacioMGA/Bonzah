#!/usr/bin/env node
/**
 * One-time re-link of collapsed BDX-imported policyholders (ADR-0056 backlog).
 *
 * Context
 * -------
 * The 2026-07-30 BDX reconciliation (ADR-0056) found that the Home and Travel
 * mappers stamped ONE shared placeholder proposer email
 * (`bdx-import@import.local`) on every imported row, and
 * `materializeCustomerAccountForPolicy` (autoAttach) dedupes holders by email —
 * so ~8,900 imported policies were re-linked onto the first holder carrying the
 * placeholder (7,494 on one name, 1,388 on another). That is why the BO policy
 * list / search shows thousands of policies under a single name (e.g. Sophie's
 * "Sevastides Panayiotis" with ~7,499), while the policy DETAIL still shows the
 * correct client — the correct identity was never lost: it is preserved per
 * policy in `policy.quoteData.proposer.*`.
 *
 * ADR-0056 fixed RECURRENCE (per-certificate synthetic emails + placeholder
 * emails excluded from dedupe). It explicitly left "the 7,209 misattributed
 * holder names" as an open remediation item. This script is that remediation.
 *
 * What it does
 * ------------
 * Scans PolicyHolders whose stored contact email is a `@import.local`
 * placeholder. A policy under such a holder is re-linked onto its OWN
 * correctly-named holder — reconstructed from the canonical identity extractor
 * `customerContactFromQuoteData(policy.quoteData)` — when it is collapsed (the
 * holder carries >1 policy) OR mis-named (the holder name does not match the
 * policy's own proposer). Policies that share a real tax id (NIF) within the run
 * collapse onto one new holder; policies with no NIF each get their own holder
 * (we never guess that two un-identified rows are the same person). A policy
 * that is already a correct 1:1 holder (one policy, name already matches) is
 * left untouched, so the run is idempotent and safe to re-run for remnants.
 *
 * For every moved policy it refreshes the BO projections through the CANONICAL,
 * tenant-scoped enqueue helpers inside the same transaction:
 *   - `enqueuePolicyListIndexUpdate(tx, policyId)` — immediate discoverability
 *     row (RLS-safe via the scoped tx) + POLICY.INDEX_UPDATE for the full row.
 *   - `enqueueAccountProjectionRefreshByAccountId(tx, holderId)` for BOTH the
 *     original collapse holder and the new target, so Accounts360 / Account
 *     Intelligence recompute for both sides.
 *
 * It NEVER fabricates identity: a policy whose proposer has no name is reported
 * and left untouched (no-defensive-fallbacks). Placeholder emails are never used
 * to match or merge holders.
 *
 * Safety
 * ------
 * - Dry-run by default: prints the full plan and counts, writes nothing.
 * - `--apply` requires `CONFIRM_APPLY=1` AND a fresh DB backup (verify on a copy
 *   and confirm counts first — this rewrites `policies.policyHolderId`).
 * - Tenant resolved via the canonical `buildTenantConfigFromEnv()`; all reads
 *   and writes go through `tenantScopedPrisma` (RLS). Per-policy transaction.
 *
 * Usage
 * -----
 *   npm run build   # (backend) — this script imports from backend/dist
 *   node tools/migrations/relink_collapsed_bdx_policyholders.mjs                 # dry-run (all products)
 *   node tools/migrations/relink_collapsed_bdx_policyholders.mjs --product HOME  # dry-run, Home only
 *   CONFIRM_APPLY=1 node tools/migrations/relink_collapsed_bdx_policyholders.mjs --product HOME --apply
 *
 * Env
 * ---
 *   COUNTRY_CODE / TENANT_SLUG  consumed by buildTenantConfigFromEnv (default abbeygate-cy)
 *   CONFIRM_APPLY               must equal "1" for --apply to write
 */
import { runWithOperatingTenant } from '../../backend/dist/platform/tenant/tenantAls.js';
import { buildTenantConfigFromEnv } from '../../backend/dist/platform/tenant/tenantConfigForCli.js';
import { prisma, tenantScopedPrisma } from '../../backend/dist/platform/db/connection.js';
import { customerContactFromQuoteData } from '../../backend/dist/modules/policy/app/customerAccountMaterialization.js';
import { enqueuePolicyListIndexUpdate } from '../../backend/dist/modules/policy/infra/projections/policyListIndex.js';
import { enqueueAccountProjectionRefreshByAccountId } from '../../backend/dist/modules/accounts360/app/accountProjectionRefresh.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const productIdx = args.indexOf('--product');
const PRODUCT = productIdx >= 0 ? String(args[productIdx + 1] || '').trim().toUpperCase() : '';
const PLACEHOLDER_SUFFIX = '@import.local';

function fail(message) { console.error(`\u2717 ${message}`); process.exit(1); }
function info(message) { console.log(`\u2022 ${message}`); }
function ok(message) { console.log(`\u2713 ${message}`); }

function parseContact(value) {
  if (!value) return {};
  if (typeof value === 'string') { try { return JSON.parse(value) || {}; } catch { return {}; } }
  return typeof value === 'object' ? value : {};
}

function isPlaceholderEmail(email) {
  return String(email || '').trim().toLowerCase().endsWith(PLACEHOLDER_SUFFIX);
}

/** All holders whose stored contact email is a `@import.local` placeholder. */
async function findPlaceholderHolders() {
  const holders = await tenantScopedPrisma.policyHolder.findMany({
    where: { contact: { contains: PLACEHOLDER_SUFFIX } },
    select: { id: true, name: true, segment: true, contact: true, _count: { select: { policies: true } } },
  });
  return holders
    .filter((h) => isPlaceholderEmail(parseContact(h.contact).email) && h._count.policies >= 1)
    .map((h) => ({ id: h.id, name: String(h.name || '').trim(), segment: h.segment, policyCount: h._count.policies }));
}

/**
 * A policy needs re-linking when its current placeholder holder is collapsed
 * (>1 policy) or mis-named (holder name != the policy's own proposer name).
 */
function decidePolicy(policy, holder) {
  const contact = customerContactFromQuoteData(policy.quoteData);
  if (!contact.name) return { action: 'skip_no_name', contact };
  const collapsed = holder.policyCount > 1;
  const misnamed = holder.name !== contact.name;
  if (!collapsed && !misnamed) return { action: 'skip_already_correct', contact };
  return { action: 'split', contact };
}

async function run() {
  // Canonical CLI tenant resolution (same mechanism the POLICY.INDEX_RECONCILE
  // worker uses): reads COUNTRY_CODE / TENANT_SLUG inside the sanctioned helper.
  const tenantConfig = buildTenantConfigFromEnv();

  await runWithOperatingTenant(tenantConfig, async () => {
    info(`Tenant:  ${tenantConfig.id} (${tenantConfig.tenantSlug})`);
    info(`Product: ${PRODUCT || 'ALL'}`);
    info(`Mode:    ${APPLY ? 'APPLY (will write)' : 'DRY-RUN (no writes)'}`);

    if (APPLY && process.env.CONFIRM_APPLY !== '1') {
      fail('Refusing to --apply without CONFIRM_APPLY=1. Verify on a copy, confirm counts, take a fresh backup, then set CONFIRM_APPLY=1.');
    }

    const holders = await findPlaceholderHolders();
    if (holders.length === 0) {
      ok('No placeholder-email holders found. Nothing to do.');
      return;
    }
    const holderById = new Map(holders.map((h) => [h.id, h]));
    const collapseHolders = holders.filter((h) => h.policyCount > 1);
    info(`Placeholder-email holders: ${holders.length} (of which ${collapseHolders.length} carry >1 policy)`);
    if (collapseHolders.length) {
      console.table(collapseHolders.slice(0, 10).map((h) => ({ id: h.id, name: h.name, policies: h.policyCount })));
    }

    const policyWhere = {
      policyHolderId: { in: holders.map((h) => h.id) },
      ...(PRODUCT ? { productType: PRODUCT } : {}),
    };
    const policies = await tenantScopedPrisma.policy.findMany({
      where: policyWhere,
      select: { id: true, policyNumber: true, productType: true, policyHolderId: true, quoteData: true },
      orderBy: { createdAt: 'asc' },
    });
    info(`Policies under placeholder holders${PRODUCT ? ` (product=${PRODUCT})` : ''}: ${policies.length}`);

    // Plan (no writes).
    const byProduct = {};
    let toSplit = 0;
    let alreadyCorrect = 0;
    let noName = 0;
    const nifSeen = new Set();
    let splitWithoutNif = 0;
    const sample = [];
    for (const policy of policies) {
      const holder = holderById.get(policy.policyHolderId);
      const { action, contact } = decidePolicy(policy, holder);
      byProduct[policy.productType] = (byProduct[policy.productType] || 0) + 1;
      if (action === 'skip_no_name') { noName += 1; continue; }
      if (action === 'skip_already_correct') { alreadyCorrect += 1; continue; }
      toSplit += 1;
      if (contact.nif) nifSeen.add(contact.nif); else splitWithoutNif += 1;
      if (sample.length < 5) {
        sample.push({ policyNumber: policy.policyNumber, product: policy.productType, from: holder.name, to: contact.name, nif: contact.nif || '(none)' });
      }
    }
    const estimatedNewHolders = nifSeen.size + splitWithoutNif;

    console.log('\nProduct breakdown of scanned policies:');
    console.table(byProduct);
    console.table({
      'policies.scanned': policies.length,
      'policies.toSplit': toSplit,
      'policies.alreadyCorrect (skip)': alreadyCorrect,
      'policies.noProposerName (skip)': noName,
      'distinct NIFs among splits': nifSeen.size,
      'splits without NIF (own holder each)': splitWithoutNif,
      'estimated new holders': estimatedNewHolders,
    });
    if (sample.length) { console.log('\nSample (first 5 to split):'); console.table(sample); }

    if (!APPLY) {
      ok('Dry-run complete. Re-run with --apply (and CONFIRM_APPLY=1) after verifying counts on a copy.');
      return;
    }

    // APPLY.
    info('Applying re-link \u2026');
    const nifToHolderId = new Map();
    let relinked = 0;
    let processed = 0;
    for (const policy of policies) {
      const holder = holderById.get(policy.policyHolderId);
      const { action, contact } = decidePolicy(policy, holder);
      processed += 1;
      if (action !== 'split') continue;

      const holderData = {
        name: contact.name,
        segment: holder.segment || null,
        address: contact.addressText || null,
        contact: JSON.stringify(contact.contact),
      };
      const oldHolderId = policy.policyHolderId;

      await tenantScopedPrisma.$transaction(async (tx) => {
        let targetHolderId = contact.nif ? nifToHolderId.get(contact.nif) : undefined;
        if (!targetHolderId) {
          const created = await tx.policyHolder.create({ data: holderData, select: { id: true } });
          targetHolderId = created.id;
          if (contact.nif) nifToHolderId.set(contact.nif, targetHolderId);
        }
        await tx.policy.update({ where: { id: policy.id }, data: { policyHolderId: targetHolderId } });
        // Canonical, tenant-scoped projection refresh (RLS-safe via tx).
        await enqueuePolicyListIndexUpdate(tx, policy.id);
        await enqueueAccountProjectionRefreshByAccountId(tx, oldHolderId);
        await enqueueAccountProjectionRefreshByAccountId(tx, targetHolderId);
      });
      relinked += 1;
      if (relinked % 500 === 0) info(`  \u2026 ${processed}/${policies.length} scanned (${relinked} re-linked)`);
    }
    ok(`Re-linked ${relinked} policy/policies. Skipped ${alreadyCorrect} already-correct and ${noName} with no proposer identity.`);
    info('Projection updates (policy-list index + Accounts360 + Account Intelligence) were enqueued per policy and will be processed by the workers.');
  });
}

run()
  .catch((error) => { console.error(error); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });

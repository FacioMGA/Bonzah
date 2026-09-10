import type { EndorsementGroup } from '../../modules/policy/domain/productContracts.js';
import type { EndorsementTemplate } from '../../modules/mbe/domain/types.js';
import { loadHealthBaseCover, loadHealthGhsExtension } from './pricing/data/loader.js';

// Defer rate-card reads until the catalog is first requested. Module
// load is hot during API/worker boot; an eager `readFileSync` at the
// top level would crash the whole backend if the JSON file is missing
// (e.g. a Docker build that forgot to copy it). The loader caches the
// parsed JSON, so the first MBE consumer pays the I/O cost; every
// subsequent call returns the frozen object.

/**
 * MBE endorsement catalog for HEALTH. Hand-curated like Travel (not
 * manifest-synthesised) because we need the GHS-conditional rule.
 *
 *  - HEALTH-BASE-COVER            — always on (`enabledByDefault: true`).
 *  - HEALTH-GHS-EXTENSION         — auto-on via `selectedWhen` rule pointing
 *    at `ghs.isBeneficiary`. No premium effect; schedule view-model
 *    reads this template's params for the Extended Cover block.
 *  - HEALTH-GESY-CLAIMS-CONDITION — auto-on via the same `selectedWhen`
 *    rule. Endorsement No. 141: Section A claims require documentary
 *    evidence that GESY was approached and declined before the Company
 *    admits or pays. No premium effect; printed in the schedule's
 *    ENDORSEMENTS section.
 *
 * The cover templates share the rate-card JSON for amounts so the schedule
 * PDF, the wizard cover summary, and the BO Coverage tab all show the
 * same numbers. The amounts live in `brit-health-2026.json` — they are
 * data, not branching here.
 */

/**
 * Endorsement No. 141 wording — single source of truth for the MBE
 * template `legal_text` AND the schedule PDF (mirrors the shared
 * CV1020 sanctions-clause pattern: structured const + heading line so
 * the printed document and the catalog can never drift).
 */
export const GESY_CLAIMS_CONDITION = {
  code: 'HEALTH-GESY-CLAIMS-CONDITION',
  headingLine: 'NO. 141 – GENERAL HEALTH SYSTEM (G.H.S. / GESY) CLAIMS CONDITION',
  intro: 'It is hereby declared and agreed that:',
  clauses: [
    'a) this Endorsement shall apply only where the Insured Person has confirmed that he or she is entitled to receive treatment and/or assistance under the General Health System, known as G.H.S. / GESY;',
    'b) this Policy is issued on the basis that the Insured Person is, or has confirmed that he or she is, a beneficiary of G.H.S. / GESY;',
    'c) the cover provided under Section A of this Policy remains subject to the sums insured, limits, excesses, terms, conditions and exclusions stated in the Schedule and in the Policy Wording;',
    'd) prior to the Company admitting or paying any claim under Section A of this Policy, the Policyholder and/or the Insured Person must provide documentary evidence, satisfactory to the Company, showing that G.H.S. / GESY was approached in respect of the relevant illness, accident, treatment or expense and that G.H.S. / GESY declined, refused or was unable to provide assistance or treatment, together with the reason given;',
    'e) where immediate emergency treatment made it impracticable to obtain such evidence before treatment, the Policyholder and/or the Insured Person must provide such documentary evidence as soon as reasonably practicable and, in any event, as part of the claim submission;',
    'f) in the absence of such documentary evidence, the Company shall have no liability to admit or pay the claim under Section A of this Policy.',
  ],
  closing: 'All other terms, conditions, exclusions, limits and endorsements of this Policy remain unaltered.',
} as const;

const GESY_CLAIMS_CONDITION_LEGAL_TEXT = [
  GESY_CLAIMS_CONDITION.intro,
  ...GESY_CLAIMS_CONDITION.clauses,
  GESY_CLAIMS_CONDITION.closing,
].join('\n');
let cachedTemplates: EndorsementTemplate[] | null = null;

function buildHealthEndorsementTemplates(): EndorsementTemplate[] {
  const baseCover = loadHealthBaseCover();
  const ghsExtension = loadHealthGhsExtension();
  return [
    {
      id: 'tmpl-health-base-cover',
      program_code: 'abbeygate_health',
      code: 'HEALTH-BASE-COVER',
      title: 'Inbound Individual Medical Insurance',
      summary: 'Base Section A cover — inpatient and outpatient care, daily hospitalisation, childbirth, and repatriation. Excess varies by insured age band.',
      type: 'COVERAGE',
      scope: 'POLICY',
      jurisdiction: ['CY'],
      legal_text:
        'Section A — Inbound Individual Medical Insurance. Maximum inpatient liability EUR ' +
        `${baseCover.inpatientPerIllness.toLocaleString('en-IE')} per Illness or Accident and EUR ${baseCover.inpatientPerPeriod.toLocaleString('en-IE')} per Period of Insurance. ` +
        `Outpatient maximum per Illness EUR ${baseCover.outpatientPerIllness.toLocaleString('en-IE')}; per Period EUR ${baseCover.outpatientPerPeriod.toLocaleString('en-IE')}; ` +
        `co-insurance ${baseCover.coinsurancePercent}%. ` +
        'Daily room and food, childbirth lump-sum benefit, and transportation of remains as per the Schedule. Excess deductible varies by Insured age band as per the Schedule.',
      parameters_schema: {
        type: 'object',
        properties: {
          inpatientPerIllness: { type: 'number' },
          inpatientPerPeriod: { type: 'number' },
          dailyRoomRegular: { type: 'number' },
          dailyRoomEmergency: { type: 'number' },
          childbirthLumpSum: { type: 'number' },
          repatriationLimit: { type: 'number' },
          outpatientPerIllness: { type: 'number' },
          outpatientPerPeriod: { type: 'number' },
          outpatientExcess: { type: 'number' },
          coinsurancePercent: { type: 'number' },
        },
        required: [],
      },
      default_params: {
        inpatientPerIllness: baseCover.inpatientPerIllness,
        inpatientPerPeriod: baseCover.inpatientPerPeriod,
        dailyRoomRegular: baseCover.dailyRoomRegular,
        dailyRoomEmergency: baseCover.dailyRoomEmergency,
        childbirthLumpSum: baseCover.childbirthLumpSum,
        repatriationLimit: baseCover.repatriationLimit,
        outpatientPerIllness: baseCover.outpatientPerIllness,
        outpatientPerPeriod: baseCover.outpatientPerPeriod,
        outpatientExcess: baseCover.outpatientExcess,
        coinsurancePercent: baseCover.coinsurancePercent,
      },
      rules: {
        prerequisites: [],
        exclusions: [],
        effects: [],
        approval: { requires_underwriter: false },
      },
      option_defaults: { enabledByDefault: true },
      ui: { group: 'core', help_text: 'Base Section A cover. Excess varies by insured age band.', form_fields: [] },
      document_template: 'health-base-cover.html',
      requires_underwriter_approval: false,
      allowed_with: [],
      disallowed_with: [],
    },
    {
      id: 'tmpl-health-ghs-extension',
      program_code: 'abbeygate_health',
      code: 'HEALTH-GHS-EXTENSION',
      title: 'GESY Doctor Visits + Medications Extension',
      summary: 'Doctor visits, medications, and Death by Accident / Repatriation extension, available only to GESY beneficiaries. Standard outpatient cover is included in base Section A.',
      type: 'COVER_EXTENSION',
      scope: 'POLICY',
      jurisdiction: ['CY'],
      legal_text:
        'Extended cover — available only where the Insured Person is a beneficiary of the General Healthcare System (G.H.S.). ' +
        `Per doctor visit EUR ${ghsExtension.doctorVisit.toLocaleString('en-IE')}; doctor visits per Period EUR ${ghsExtension.doctorVisitsPerPeriod.toLocaleString('en-IE')}; ` +
        `medications EUR ${ghsExtension.medications.toLocaleString('en-IE')}. No additional premium.`,
      parameters_schema: {
        type: 'object',
        properties: {
          doctorVisit: { type: 'number' },
          doctorVisitsPerPeriod: { type: 'number' },
          medications: { type: 'number' },
        },
        required: [],
      },
      default_params: {
        doctorVisit: ghsExtension.doctorVisit,
        doctorVisitsPerPeriod: ghsExtension.doctorVisitsPerPeriod,
        medications: ghsExtension.medications,
      },
      rules: {
        prerequisites: [],
        exclusions: [],
        effects: [],
        approval: { requires_underwriter: false },
      },
      option_defaults: {
        enabledByDefault: false,
        // Auto-include the extension whenever the proposer indicates they
        // are a GHS beneficiary. The wizard ghs.isBeneficiary toggle and
        // the BO UW field share this path — MBE auto-resolution lights up
        // the extension block on the schedule without any per-product
        // branching in shared code.
        selectedWhen: [{ path: 'ghs.isBeneficiary', equals: true }],
      },
      ui: { group: 'extensions', help_text: 'No premium impact — available only to GESY beneficiaries.', form_fields: [] },
      document_template: 'health-ghs-extension.html',
      requires_underwriter_approval: false,
      allowed_with: [],
      disallowed_with: [],
    },
    {
      id: 'tmpl-health-gesy-claims-condition',
      program_code: 'abbeygate_health',
      code: GESY_CLAIMS_CONDITION.code,
      title: 'No. 141 – General Health System (G.H.S. / GESY) Claims Condition',
      summary: 'Section A claims require documentary evidence that GESY was approached and declined, refused or was unable to assist before the Company admits or pays.',
      type: 'CONDITION',
      scope: 'POLICY',
      jurisdiction: ['CY'],
      legal_text: GESY_CLAIMS_CONDITION_LEGAL_TEXT,
      parameters_schema: { type: 'object', properties: {}, required: [] },
      default_params: {},
      rules: {
        prerequisites: [],
        exclusions: [],
        effects: [],
        approval: { requires_underwriter: false },
      },
      option_defaults: {
        enabledByDefault: false,
        // Same trigger as HEALTH-GHS-EXTENSION: the wizard ghs.isBeneficiary
        // toggle (data-capture confirmation) auto-applies the claims
        // condition — no premium effect, schedule prints the wording.
        selectedWhen: [{ path: 'ghs.isBeneficiary', equals: true }],
      },
      ui: { group: 'conditions', help_text: 'Auto-applied for GESY beneficiaries. Section A claims need evidence GESY declined before payment.', form_fields: [] },
      document_template: 'health-gesy-claims-condition.html',
      requires_underwriter_approval: false,
      allowed_with: [],
      disallowed_with: [],
    },
  ];
}

/**
 * Lazy proxy exposing the canonical template list. Each property access
 * (`.length`, indexed reads, `.find()`, spread) triggers a one-time
 * build that resolves the rate-card JSON. Subsequent reads return the
 * cached array. `HealthProductAdapter` and the MBE bootstrap can keep
 * the existing array-shaped API without paying a startup I/O cost.
 */
export const HEALTH_ENDORSEMENT_TEMPLATES: EndorsementTemplate[] = new Proxy([] as EndorsementTemplate[], {
  get(_target, prop, receiver) {
    if (!cachedTemplates) cachedTemplates = buildHealthEndorsementTemplates();
    return Reflect.get(cachedTemplates, prop, receiver);
  },
  // Without a `has` trap, `k in proxy` falls through to the EMPTY target
  // array, so every Array.prototype method that does a HasProperty check
  // per index (`map`, `filter`, `some`, `forEach`, …) silently skips all
  // elements — `filter` returned [] and the MBE normalizer saw an empty
  // health catalog. `find`/spread/for-of don't do that check, which is why
  // the breakage never surfaced in adapter `get(code)` lookups.
  has(_target, prop) {
    if (!cachedTemplates) cachedTemplates = buildHealthEndorsementTemplates();
    return Reflect.has(cachedTemplates, prop);
  },
  ownKeys() {
    if (!cachedTemplates) cachedTemplates = buildHealthEndorsementTemplates();
    return Reflect.ownKeys(cachedTemplates);
  },
  getOwnPropertyDescriptor(_target, prop) {
    if (!cachedTemplates) cachedTemplates = buildHealthEndorsementTemplates();
    return Object.getOwnPropertyDescriptor(cachedTemplates, prop);
  },
}) as EndorsementTemplate[];

export const HEALTH_ENDORSEMENT_GROUPS: EndorsementGroup[] = [
  { id: 'core', title: 'Core', templates: ['HEALTH-BASE-COVER'] },
  { id: 'extensions', title: 'Extensions', templates: ['HEALTH-GHS-EXTENSION'] },
  { id: 'conditions', title: 'Conditions', templates: ['HEALTH-GESY-CLAIMS-CONDITION'] },
];

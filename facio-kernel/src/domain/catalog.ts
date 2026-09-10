import type { z } from 'zod';
import type { categorySchema } from '../contracts/configuration.js';

type Category = z.infer<typeof categorySchema>;
const visible = { ui: true, api: true, mcp: true };
const owner = 'Platform Engineering (delivery owner unassigned)';

/** Visibility describes discovery and gaps; it does not imply execution support. */
export const catalog: Category[] = [
  {
    id: 'tenant',
    name: 'Tenant definition',
    support: 'partial',
    description:
      'Identity, locale, currency, time zone and residency metadata. Subscription, domains, retention and deployment enforcement are not implemented.',
    requirementIds: ['TEN-002', 'TEN-006', 'TEN-008'],
    owner,
    milestone: 'M3',
    surfaces: visible,
    validation: true,
    simulation: false,
  },
  {
    id: 'operatingEntities',
    name: 'Operating entities',
    support: 'partial',
    description:
      'Entity identities and declared territories constrain activated insurance product territories. Licence, regulated role, account, tax and business-calendar contracts are not implemented.',
    requirementIds: ['TEN-002'],
    owner,
    milestone: 'M3',
    surfaces: visible,
    validation: true,
    simulation: false,
  },
  {
    id: 'partyDistribution',
    name: 'Party and distribution',
    support: 'missing',
    description:
      'Party roles, appointments, broker hierarchy, agreements and distribution permissions require implementation.',
    requirementIds: ['PBR-006'],
    owner,
    milestone: 'M3 inventory; delivery unplanned',
    surfaces: visible,
    validation: false,
    simulation: false,
  },
  {
    id: 'products',
    name: 'Product definitions',
    support: 'partial',
    description:
      'Versioned scalar and repeated risks, conditional questions, scoped limits, aggregates and excess layers share one insurance definition. Explicit whole-term or daily rating, underwriting, service and cancellation rules are evaluated against retained releases; a renewal selects a fresh active definition. Draft simulation, customer-approved rules and provider issuance remain unavailable.',
    requirementIds: ['PRD-002', 'PRD-003', 'PRD-004', 'PRD-006', 'PRD-007', 'PRD-010', 'PRD-012'],
    owner,
    milestone: 'M3',
    surfaces: visible,
    validation: true,
    simulation: true,
  },
  {
    id: 'programmesBinders',
    name: 'Programmes and binders',
    support: 'missing',
    description:
      'Capacity, authority, territorial limits, commission, referrals and reporting obligations require implementation.',
    requirementIds: ['PRD-009'],
    owner,
    milestone: 'M3 inventory; delivery unplanned',
    surfaces: visible,
    validation: false,
    simulation: false,
  },
  {
    id: 'processes',
    name: 'Process definitions',
    support: 'partial',
    description:
      'Versioned stages, transition metadata, references and graph validation. Configured process execution, approvals, timers and simulation are not implemented. Separate insurance, independent review, document, finance and internal FNOL applications enforce their own canonical permissions and state transitions.',
    requirementIds: ['PBR-001', 'PBR-003', 'PBR-009', 'PBR-010', 'PBR-011'],
    owner,
    milestone: 'M3',
    surfaces: visible,
    validation: true,
    simulation: false,
  },
  {
    id: 'jurisdictions',
    name: 'Jurisdiction packs',
    support: 'missing',
    description:
      'Local questions, wording, taxes, fees, eligibility, disclosure and reporting rules require implementation.',
    requirementIds: ['PRD-006', 'TEN-002'],
    owner,
    milestone: 'M3 inventory; delivery unplanned',
    surfaces: visible,
    validation: false,
    simulation: false,
  },
  {
    id: 'finance',
    name: 'Finance definitions',
    support: 'missing',
    description:
      'Editable customer finance definitions remain unavailable. The bounded synthetic runtime uses exact Rust allocation, balanced external-premium control and separate commission receivables, partial receipts and immutable reversals. Customer accounting bases, tax, fees, instalments, invoicing and live settlement require implementation and acceptance.',
    requirementIds: ['PRD-006', 'PBR-007', 'DOM-006'],
    owner,
    milestone: 'M3 inventory; M1/M2 finance slice in September sprints',
    surfaces: visible,
    validation: false,
    simulation: false,
  },
  {
    id: 'documents',
    name: 'Document packs',
    support: 'missing',
    description:
      'Editable customer document-pack configuration remains unavailable. Registered synthetic PDF/HTML packs retain exact policy, service, template and byte-hash evidence with durable jobs and retries. Approved customer clauses, numbering, signatures and delivery remain unconfigured.',
    requirementIds: ['PRD-007', 'PBR-008'],
    owner,
    milestone: 'M3 inventory; delivery unplanned',
    surfaces: visible,
    validation: false,
    simulation: false,
  },
  {
    id: 'integrations',
    name: 'Integration profiles',
    support: 'partial',
    description:
      'Editable metadata retains adapter identifiers and secret-free connection references. A separate durable quote-evidence runtime implements attempts, retries, authenticated ingress and reconciliation for registered adapters. The hosted training adapter is synthetic; customer mappings, connection health, pricing authority, payment and screening remain unconfigured.',
    requirementIds: ['PBR-007', 'CFG-008'],
    owner,
    milestone: 'M3',
    surfaces: visible,
    validation: true,
    simulation: false,
  },
  {
    id: 'reporting',
    name: 'Reporting contracts',
    support: 'missing',
    description:
      'Editable customer reporting contracts remain unavailable. Scoped synthetic insurance and financial reports retain effective and recorded cutoffs, separate currencies, exact source/capacity lineage and matching CSV output. Approved customer/BDX mappings, schedules, submissions and regulatory acceptance remain open.',
    requirementIds: ['PRD-012'],
    owner,
    milestone: 'M3 inventory; delivery unplanned',
    surfaces: visible,
    validation: false,
    simulation: false,
  },
  {
    id: 'experience',
    name: 'Experience profiles',
    support: 'missing',
    description:
      'Tenant branding, navigation, enabled surfaces, terminology, roles and product rendering configuration require implementation.',
    requirementIds: ['PBR-005', 'PRD-011'],
    owner,
    milestone: 'M3 inventory; M4 specification',
    surfaces: visible,
    validation: false,
    simulation: false,
  },
  {
    id: 'tenantRelease',
    name: 'Tenant releases',
    support: 'partial',
    description:
      'Hosted sandbox activation and rollback select immutable bundles of configuration, attached requirements and operating policies. Existing insurance records retain their original release. Signed production publication, approvals and customer migration remain unimplemented.',
    requirementIds: ['PBR-002', 'CFG-006', 'TEN-007', 'AC-009', 'AC-010'],
    owner,
    milestone: 'M3 inspection; delivery unplanned',
    surfaces: visible,
    validation: false,
    simulation: false,
  },
];

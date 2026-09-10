import path from 'path';
import { fileURLToPath } from 'url';
import { homeManifest } from '@facio/products';
import {
  assertProductDocumentPackContract,
  requiredIssuedDocTypesFromContract,
  type ProductDocumentPackContract,
} from '../../shared/documents/productDocumentPackContract.js';
import { resolveHomePolicyWording, resolveHomeIpid } from './policyWording.js';

// Anchors only — the emitted wording/IPID are resolved per tenant (and,
// for the wording, domicile) at generation time (ADR-0048). See the
// HOME_POLICY_WORDING_PDF / HOME_IPID_PDF entries.
const HOME_POLICY_WORDING_ANCHOR = resolveHomePolicyWording('CY', 'NON_UK');
const HOME_IPID_ANCHOR = resolveHomeIpid('CY');

const DOCS_DIR = path.dirname(fileURLToPath(import.meta.url));
// ADR-0017 / ABY-97 — `staticPdf` assets live under the product folder
// (sibling of `templates/`), per CHAMPS canonical-ownership and to
// satisfy `tools/quality/check-root-hygiene.mjs` which hard-bans
// tracking under `artifacts/`. Resolved relative to this file so the
// path is stable in source AND in the dist/* tree (Dockerfile.api
// COPYs `documents/static` alongside `documents/templates`).
const HOME_STATIC_DIR = path.join(DOCS_DIR, 'static');

export const HOME_DOCUMENT_PACK_CONTRACT: ProductDocumentPackContract = {
  productType: 'HOME',
  // Home pack omits a standalone "Certificate" doc on purpose: the Schedule's
  // first page is the Lloyd's policy jacket (legacy Abbeygate artifact LBS0004J
  // generic policy jacket), so a sibling Certificate would duplicate the same
  // cover content under a different filename. Motor still issues a separate
  // certificate because the motor certificate (Form B / Green Card pack) is a
  // distinct regulatory artifact required by road-traffic acts; home has no
  // equivalent requirement.
  entries: [
    {
      mode: 'template',
      docType: 'HOME_SCHEDULE_PDF',
      label: homeManifest.documentTypes.HOME_SCHEDULE_PDF,
      filename: 'Home_Schedule_{policyNumber}.pdf',
      template: 'schedule.html',
      draftPrefix: true,
      endorsementVersionedFilename: true,
      // The generated footer includes the UMR and page number. Reserve enough
      // bottom clearance for it so the final cover limits on a full page stay
      // readable (ABQ Home schedule production review, 2026-08-31).
      assetVersion: 'home-schedule:v4-footer-clearance',
      margin: { top: '14mm', bottom: '20mm', left: '10mm', right: '10mm' },
      scope: { docPacks: ['ISSUED_POLICY_PACK', 'DRAFT_POLICY_PACK', 'QUOTE_PACK', 'ENDORSEMENT_PACK'], requiredForIssuedPack: true, emailAttachment: true },
    },
    {
      mode: 'template',
      docType: 'HOME_STATEMENT_OF_FACT_PDF',
      label: homeManifest.documentTypes.HOME_STATEMENT_OF_FACT_PDF,
      filename: 'Home_Statement_of_Fact_{policyNumber}.pdf',
      template: 'statement-of-fact.html',
      draftPrefix: true,
      assetVersion: 'home-statement-of-fact:v1',
      scope: { docPacks: ['ISSUED_POLICY_PACK', 'DRAFT_POLICY_PACK', 'QUOTE_PACK'], requiredForIssuedPack: true, emailAttachment: true },
    },
    {
      // ADR-0048 — the emitted IPID is resolved per tenant territory in
      // `generateHomeDocPack`'s selectDocs via `resolveHomeIpid` (Greece has
      // its own IPID; Cyprus/Portugal share the combined Cyprus/Greece IPID).
      // This entry is the schema anchor only; its filename/path/version are
      // overridden at selection time.
      mode: 'staticPdf',
      docType: 'HOME_IPID_PDF',
      label: homeManifest.documentTypes.HOME_IPID_PDF,
      filename: HOME_IPID_ANCHOR.filename,
      staticPdfPath: HOME_IPID_ANCHOR.staticPdfPath,
      assetVersion: HOME_IPID_ANCHOR.assetVersion,
      scope: { docPacks: ['ISSUED_POLICY_PACK'], requiredForIssuedPack: true, emailAttachment: true },
    },
    {
      // ADR-0048 — the actual Home policy wording is resolved per (tenant
      // territory × client domicile) in `generateHomeDocPack`'s selectDocs
      // via `resolveHomePolicyWording`. This contract entry is only the
      // schema anchor that declares the doc type as required-for-issued +
      // email-attached; its `filename` / `staticPdfPath` / `assetVersion`
      // are ALWAYS overridden at selection time. The anchor points at the
      // Cyprus non-UK wording purely to satisfy the contract assertion
      // (absolute .pdf path); it is never emitted as-is.
      mode: 'staticPdf',
      docType: 'HOME_POLICY_WORDING_PDF',
      label: homeManifest.documentTypes.HOME_POLICY_WORDING_PDF,
      filename: HOME_POLICY_WORDING_ANCHOR.filename,
      staticPdfPath: HOME_POLICY_WORDING_ANCHOR.staticPdfPath,
      assetVersion: HOME_POLICY_WORDING_ANCHOR.assetVersion,
      scope: { docPacks: ['ISSUED_POLICY_PACK'], requiredForIssuedPack: true, emailAttachment: true },
    },
    {
      mode: 'staticPdf',
      docType: 'HOME_EUROP_ASSISTANCE_PDF',
      label: homeManifest.documentTypes.HOME_EUROP_ASSISTANCE_PDF,
      filename: 'Home_Europ_Assistance_Information.pdf',
      staticPdfPath: path.join(HOME_STATIC_DIR, 'NDP82515223207-04-2026.pdf'),
      assetVersion: 'europ-assistance-home-information:2026-04-07',
      scope: { docPacks: ['ISSUED_POLICY_PACK'], requiredForIssuedPack: true, emailAttachment: true },
    },
  ],
};

assertProductDocumentPackContract(HOME_DOCUMENT_PACK_CONTRACT, homeManifest.documentTypes);

export const HOME_REQUIRED_ISSUED_DOC_TYPES = requiredIssuedDocTypesFromContract(HOME_DOCUMENT_PACK_CONTRACT);

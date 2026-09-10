/**
 * identifierExtraction — pull business-object identifiers out of email
 * text (ADR-0044). Pure domain, deterministic regex only.
 *
 * Deterministic linkage hints attached by the source always win; this
 * extractor is the fallback when a message arrives with no explicit hint.
 */

export interface ExtractedEmailIdentifiers {
  claimReference?: string;
  policyReference?: string;
  vehicleRegistration?: string;
}

const CLAIM_LABELLED = /claim(?:\s*(?:no\.?|number|ref(?:erence)?))?\s*[:#-]?\s*([A-Z]{2,4}[-/][A-Z0-9]{2,}(?:[-/][A-Z0-9]{2,})?)/i;
const CLAIM_BARE = /\b((?:CY-[A-Z]{2,4}-\d{2,})|(?:ABB[-/]VL[-/]\d{3,}))\b/i;
const POLICY_LABELLED = /policy(?:\s*(?:no\.?|number))?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{4,})/i;
const UMR = /\b(B\d{3,4}[A-Z0-9]{5,})\b/;
const VEHICLE_LABELLED = /(?:reg(?:istration)?|plate|vehicle\s*reg)\s*[:#-]?\s*([A-Z0-9]{4,8})/i;

function firstMatch(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  return m ? m[1].trim().toUpperCase() : undefined;
}

export function extractEmailIdentifiers(text: string): ExtractedEmailIdentifiers {
  const haystack = String(text || '');
  const out: ExtractedEmailIdentifiers = {};

  const claim = firstMatch(haystack, CLAIM_LABELLED) ?? firstMatch(haystack, CLAIM_BARE);
  if (claim) out.claimReference = claim;

  const policy = firstMatch(haystack, POLICY_LABELLED) ?? firstMatch(haystack, UMR);
  if (policy) out.policyReference = policy;

  const vehicle = firstMatch(haystack, VEHICLE_LABELLED);
  if (vehicle) out.vehicleRegistration = vehicle;

  return out;
}

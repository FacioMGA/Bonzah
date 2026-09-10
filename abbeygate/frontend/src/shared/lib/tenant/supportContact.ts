/**
 * Tenant-aware customer support contact details for public wizard surfaces.
 *
 * Derived from the browser host via `getOperatingCountryFromHost` (see
 * `operatingCountry.ts` for the tenancy contract caveats). Every customer
 * surface that shows a phone number or contact email MUST resolve it here —
 * hardcoded Cyprus numbers on the Portugal site were a PT go-live blocker
 * (Peter Sheppard / Matt Pickering, 24 Jul 2026).
 *
 * `assistance` is the number shown next to "Need assistance?" prompts;
 * `office` is the general office/queries line. Cyprus intentionally uses two
 * different numbers; the other territories use a single line for both.
 * Unknown hosts (localhost, previews) fall back to Cyprus — the pre-existing
 * behaviour of every call site.
 */
import { getOperatingCountryFromHost } from './operatingCountry';

export interface SupportContact {
  /** "Need assistance?" line — display form, e.g. "+351 289 369 254". */
  assistanceDisplay: string;
  /** `tel:` href value for the assistance line. */
  assistanceTel: string;
  /** General office / queries line — display form. */
  officeDisplay: string;
  /** `tel:` href value for the office line. */
  officeTel: string;
  /** Customer contact email for the territory. */
  email: string;
}

const CY_CONTACT: SupportContact = {
  assistanceDisplay: '+357 26 934 455',
  assistanceTel: '+35726934455',
  officeDisplay: '+357 26 819175',
  officeTel: '+35726819175',
  email: 'sales@abbeygate.cy',
};

const SUPPORT_CONTACT_BY_COUNTRY: Record<string, SupportContact> = {
  CY: CY_CONTACT,
  PT: {
    assistanceDisplay: '+351 289 369 254',
    assistanceTel: '+351289369254',
    officeDisplay: '+351 289 369 254',
    officeTel: '+351289369254',
    email: 'portugal@abbeygate.pt',
  },
  GR: {
    assistanceDisplay: '+30 211 2345 774',
    assistanceTel: '+302112345774',
    officeDisplay: '+30 211 2345 774',
    officeTel: '+302112345774',
    email: 'greece@abbeygate.gr',
  },
  ES: { ...CY_CONTACT, email: 'spain@abbeygate.es' },
};

export function getSupportContact(hostname?: string): SupportContact {
  const code = getOperatingCountryFromHost(hostname);
  return (code && SUPPORT_CONTACT_BY_COUNTRY[code]) || CY_CONTACT;
}

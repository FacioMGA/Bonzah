import { getSelectedTenant } from './runtimeProfile';

export interface SupportContact {
  assistanceDisplay: string;
  assistanceTel: string;
  officeDisplay: string;
  officeTel: string;
  email: string;
}

/** Exact selected-tenant content; no inferred country or customer contact fallback. */
export function getSupportContact(_hostname?: string): SupportContact {
  const contact = getSelectedTenant()?.profile.runtimeSettings?.contact;
  const phone = contact?.phone || '';
  const tel = phone.replace(/[^+0-9]/g, '');
  return {
    assistanceDisplay: phone,
    assistanceTel: tel,
    officeDisplay: phone,
    officeTel: tel,
    email: contact?.email || '',
  };
}

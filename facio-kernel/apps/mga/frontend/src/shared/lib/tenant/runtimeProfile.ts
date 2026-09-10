/** Read-only projection of the server-selected operating tenant. Never an authorization source. */
export type TenantRuntimeSettings = {
  schemaVersion: 'tenant-runtime-v1';
  contact: { email: string; phone: string };
  routing: {
    underwritingReferralTo: string[];
    underwritingReferralCc: string[];
    onlinePolicyConfirmationCopies: string[];
  };
  branding: {
    displayName: string;
    legalName: string;
    addressLines: string[];
    legalLines: string[];
    regulatorLine: string | null;
    websiteUrl: string | null;
    websiteLabel: string | null;
    primaryColor?: string;
    secondaryColor?: string;
  };
};

export type TenantProfile = {
  countryCode: string;
  country: string;
  currency: string;
  legalPack: string;
  publicBaseUrl: string;
  fromEmail: string;
  brandLogo: { white: string; blue: string };
  defaultBrokerName?: string | null;
  locale?: string;
  timeZone?: string;
  legalName?: string;
  declaredRole?: 'MGA' | 'BROKER' | 'COVERHOLDER';
  defaultNationality?: string;
  defaultDriversLicenseCountry?: string;
  priorityCountries?: string[];
  allowedRiskCountries?: string[];
  runtimeSettings: TenantRuntimeSettings | null;
  ipt?: { rate?: number; flatFee?: number };
  adminFee?: number;
  [key: string]: unknown;
};

export type SelectedTenant = {
  id: string;
  tenantSlug: string;
  displayName: string;
  role: string;
  accountScopeId: string | null;
  profile: TenantProfile;
};

let selected: SelectedTenant | null = null;
const subscribers = new Set<() => void>();

export function getSelectedTenant(): SelectedTenant | null {
  return selected;
}
export function subscribeTenant(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function safeBrandUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  if (/[\u0000-\u001f\u007f]/.test(text)) return null;
  if (text.startsWith('/') && !text.startsWith('//') && !text.includes('\\')) return text;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function installSelectedTenant(tenant: SelectedTenant): void {
  if (
    !tenant.id ||
    !tenant.tenantSlug ||
    !tenant.profile?.countryCode ||
    !tenant.profile.currency ||
    tenant.profile.runtimeSettings?.schemaVersion !== 'tenant-runtime-v1'
  ) {
    throw new Error('The server has not supplied a complete operating tenant profile.');
  }
  selected = structuredClone(tenant);
  const color = tenant.profile.runtimeSettings.branding.primaryColor;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.operatingTenant = tenant.id;
    document.title = tenant.profile.runtimeSettings.branding.displayName + ' · FacioMGA';
    const primary = color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#334155';
    const secondaryColor = tenant.profile.runtimeSettings.branding.secondaryColor;
    const secondary =
      secondaryColor && /^#[0-9a-f]{6}$/i.test(secondaryColor) ? secondaryColor : '#64748b';
    const rgb = (hex: string, shade = 1) =>
      [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * shade)).join(' ');
    document.documentElement.style.setProperty('--tenant-brand-primary', primary);
    document.documentElement.style.setProperty('--tenant-brand-secondary', secondary);
    document.documentElement.style.setProperty('--tenant-brand-primary-rgb', rgb(primary));
    document.documentElement.style.setProperty('--tenant-brand-dark-rgb', rgb(primary, 0.75));
    document.documentElement.style.setProperty('--tenant-brand-deep-rgb', rgb(primary, 0.35));
    document.documentElement.style.setProperty('--tenant-brand-secondary-rgb', rgb(secondary));
    document.documentElement.style.setProperty('--ui-focus', rgb(primary));
    document.documentElement.lang = tenant.profile.locale || 'en';
  }
  subscribers.forEach((listener) => listener());
}

export function clearSelectedTenant(): void {
  selected = null;
  if (typeof document !== 'undefined') {
    delete document.documentElement.dataset.operatingTenant;
    document.title = 'Facio Platform';
    [
      '--tenant-brand-primary',
      '--tenant-brand-secondary',
      '--tenant-brand-primary-rgb',
      '--tenant-brand-dark-rgb',
      '--tenant-brand-deep-rgb',
      '--tenant-brand-secondary-rgb',
      '--ui-focus',
    ].forEach((key) => document.documentElement.style.removeProperty(key));
  }
  subscribers.forEach((listener) => listener());
}

export function getTenantDisplayName(): string {
  return (
    selected?.profile.runtimeSettings?.branding.displayName ||
    selected?.displayName ||
    'Facio Platform'
  );
}

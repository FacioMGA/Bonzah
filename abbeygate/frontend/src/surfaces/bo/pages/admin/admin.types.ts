export type UserRow = {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  team?: string;
  isActive?: boolean;
  lastLogin?: string | null;
  updatedAt?: string | null;
  mfaEnabled?: boolean;
  phone?: string;
};

export type EffectiveUser = {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'UNDERWRITER' | 'CUSTOMER';
  team: string;
  isActive: boolean;
  status: 'Active' | 'Disabled';
  lastLogin: string | null;
  mfa: 'Enabled' | 'Disabled';
  phone: string;
};

export type AuditEntry = {
  at: string;
  actor: string;
  action: string;
  detail: string;
};

export type InviteForm = {
  name: string;
  email: string;
  role: 'UNDERWRITER' | 'ADMIN' | 'CUSTOMER';
  team: string;
};

export type RolePreset = {
  name: string;
  bullets: string[];
};

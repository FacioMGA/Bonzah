export type AppUser = {
  id?: string;
  name: string;
  role: string;
  email?: string;
  primaryAccountId?: string | null;
  effectivePermissions?: string[];
};

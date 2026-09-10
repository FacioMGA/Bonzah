import type { RolePreset } from './admin.types';

export const ROLE_PRESETS: RolePreset[] = [
  {
    name: 'Underwriting/Ops (UNDERWRITER)',
    bullets: [
      'Ingest declarations, run validation, draft invoices',
      'Generate policy documents and monthly packs',
      'Cannot finalize settlement or change authority',
    ],
  },
  {
    name: 'Admin (ADMIN)',
    bullets: [
      'Full access + authority changes + template activation',
      'Can invite/disable users and change roles',
      'Can approve out-of-authority exceptions',
    ],
  },
  {
    name: 'Customer (CUSTOMER)',
    bullets: [
      'View only access to their own policies',
      'Cannot edit or bind',
    ],
  },
];

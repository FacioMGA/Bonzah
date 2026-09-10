import type { StaffDirectoryPerson } from '@/src/shared/api/boApiClient';
import type { UserRecord } from '@/src/modules/accessControl/model/types';

export function filterStaffDirectoryForAssign(
  staff: StaffDirectoryPerson[],
  query: string,
  limit = 8,
): UserRecord[] {
  const needle = String(query || '').trim().toLowerCase();
  if (needle.length < 2) return [];

  return staff
    .filter((person) => {
      const name = String(person.name || '').toLowerCase();
      const email = String(person.email || '').toLowerCase();
      return name.includes(needle) || email.includes(needle);
    })
    .slice(0, limit)
    .map((person) => ({
      id: person.id,
      name: person.name,
      firstName: null,
      lastName: null,
      email: person.email,
      phone: null,
      role: 'UNDERWRITER' as const,
      userType: 'INTERNAL' as const,
      isActive: true,
      mfaEnabled: false,
      lastLogin: null,
      createdAt: '',
      inviteToken: null,
      inviteExpiresAt: null,
      suspendedAt: null,
      suspendedReason: null,
      invitedById: null,
      accessAssignments: [],
    }));
}

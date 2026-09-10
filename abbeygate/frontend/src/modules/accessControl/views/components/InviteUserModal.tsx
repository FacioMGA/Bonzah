/**
 * InviteUserModal
 *
 * Full-featured invite form: firstName, lastName, phone, role, userType, note.
 * Uses the shared PhoneInputField component for international phone number entry.
 */
import React from 'react';
import { PhoneInputField } from '@/src/shared/ui/primitives/PhoneInputField';
import type { E164Number } from 'libphonenumber-js';
import type { AccessRole } from '../../model/types';
import { accessControlApiClient } from '../../api/accessControlApiClient';

type Role = 'UNDERWRITER' | 'ADMIN' | 'CUSTOMER';
type UserType = 'INTERNAL' | 'BROKER' | 'CUSTOMER' | 'PARTNER';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

const ROLE_OPTIONS: { value: Role; label: string; description: string }[] = [
  { value: 'ADMIN', label: 'Administrator', description: 'Full platform access' },
  { value: 'UNDERWRITER', label: 'Underwriter / Ops', description: 'Operational access' },
  { value: 'CUSTOMER', label: 'Customer', description: 'Self-service portal' },
];

const USER_TYPE_OPTIONS: { value: UserType; label: string }[] = [
  { value: 'INTERNAL', label: 'Internal Staff' },
  { value: 'BROKER', label: 'Broker / Agent' },
  { value: 'PARTNER', label: 'Partner' },
  { value: 'CUSTOMER', label: 'Customer' },
];

export function InviteUserModal({ onClose, onSuccess }: Props) {
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState<E164Number | undefined>(undefined);
  const [role, setRole] = React.useState<Role>('UNDERWRITER');
  const [userType, setUserType] = React.useState<UserType>('INTERNAL');
  const [note, setNote] = React.useState('');
  const [availableRoles, setAvailableRoles] = React.useState<AccessRole[]>([]);
  const [initialAccessRoleId, setInitialAccessRoleId] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void accessControlApiClient.listRoles()
      .then((response) => setAvailableRoles(response.roles))
      .catch(() => setAvailableRoles([]));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await accessControlApiClient.inviteUser({
        email: email.trim(),
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        phone: phone || undefined,
        role,
        userType,
        assignmentRoleIds: initialAccessRoleId ? [initialAccessRoleId] : undefined,
        note: note.trim() || undefined,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invite. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Invite User</h2>
            <p className="text-sm text-gray-500 mt-0.5">An invite link will be sent to their email.</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form body */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5 space-y-4 max-h-[65vh] overflow-y-auto">
            {/* Name row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">First Name</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  placeholder="Jane"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Last Name</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  placeholder="Smith"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Email Address <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="user@example.com"
                required
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Phone Number</label>
              <div className="text-sm">
                <PhoneInputField
                  value={phone}
                  onChange={(val: E164Number | undefined) => setPhone(val)}
                  defaultCountry="GB"
                  placeholder="+44 20 7946 0958"
                />
              </div>
            </div>

            {/* Role & Type row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Role</label>
                <select
                  value={role}
                  onChange={e => setRole(e.target.value as Role)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all appearance-none"
                >
                  {ROLE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">User Type</label>
                <select
                  value={userType}
                  onChange={e => setUserType(e.target.value as UserType)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all appearance-none"
                >
                  {USER_TYPE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Role description hint */}
            <p className="text-xs text-gray-400 -mt-1 px-0.5">
              {ROLE_OPTIONS.find(o => o.value === role)?.description}
            </p>

            {/* Internal Note */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Initial Access Role</label>
              <select
                value={initialAccessRoleId}
                onChange={(e) => setInitialAccessRoleId(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all appearance-none"
              >
                <option value="">No additional assignment</option>
                {availableRoles.map((roleOption) => (
                  <option key={roleOption.id} value={roleOption.id}>{roleOption.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Internal Note</label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Optional — won't be sent to the user"
                rows={2}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-semibold text-gray-600 hover:text-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Sending…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Send Invite
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

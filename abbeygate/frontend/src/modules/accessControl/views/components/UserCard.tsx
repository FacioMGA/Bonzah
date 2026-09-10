import React, { useState } from 'react';
import type { UserRecord } from '../../model/types';
import { deriveUserStatus } from '../../model/types';

/**
 * UserCard — Mobile card for the accessControl users list.
 *
 * Matches PolicyCard anatomy: full-width button, rounded-2xl border,
 * hover shadow, stagger animation via animationDelay.
 */

// ── Colour palettes ────────────────────────────────────────────────────────

const STATUS_TONE = {
  active:    { bg: 'bg-emerald-50', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  suspended: { bg: 'bg-amber-50',   dot: 'bg-amber-500',   text: 'text-amber-700' },
  pending:   { bg: 'bg-slate-100',  dot: 'bg-slate-400',   text: 'text-slate-500' },
};

const ROLE_COLOUR: Record<string, string> = {
  ADMIN:       'bg-violet-100 text-violet-700',
  UNDERWRITER: 'bg-sky-100 text-sky-700',
  CUSTOMER:    'bg-teal-100 text-teal-700',
};

const USER_TYPE_LABEL: Record<string, string> = {
  INTERNAL: 'Internal',
  BROKER:   'Broker',
  CUSTOMER: 'Customer',
  PARTNER:  'Partner',
};

// ── Avatar helpers ─────────────────────────────────────────────────────────

const AVATAR_COLOURS = [
  'bg-violet-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500', 'bg-indigo-500', 'bg-teal-500', 'bg-orange-500',
];

function avatarColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLOURS[Math.abs(hash) % AVATAR_COLOURS.length];
}

function initials(user: { firstName?: string | null; lastName?: string | null; name?: string | null; email: string }): string {
  if (user.firstName && user.lastName) return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  const n = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.name || user.email;
  const parts = n.trim().split(' ');
  return parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : n.slice(0, 2).toUpperCase();
}
function fullName(user: { firstName?: string | null; lastName?: string | null; name?: string | null; email: string }): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.name || user.email;
}


function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: '2-digit' });
}

// ── Component ──────────────────────────────────────────────────────────────

type UserCardProps = {
  user: UserRecord;
  index: number;
  onClick?: (user: UserRecord) => void;
};

export function UserCard({ user, index, onClick }: UserCardProps) {
  const status = deriveUserStatus(user);
  const tone = STATUS_TONE[status];
  const bgColour = avatarColor(user.email);
  const initText = initials(user);
  const nameText = fullName(user);
  const roleColour = ROLE_COLOUR[user.role] ?? 'bg-slate-100 text-slate-600';
  const typeLabel = USER_TYPE_LABEL[user.userType] ?? user.userType;
  const roleChips = user.accessAssignments.slice(0, 2).map((a) => a.role.name);
  const overflow = user.accessAssignments.length > 2 ? user.accessAssignments.length - 2 : 0;

  return (
    <button
      type="button"
      onClick={() => onClick?.(user)}
      className="w-full text-left bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md active:scale-[0.98] transition-all duration-200 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary animate-[card-appear_250ms_ease-out_both]"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Row 1 */}
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-full ${bgColour} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
          {initText}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 truncate">{nameText}</p>
          <p className="text-xs text-slate-500 truncate">{user.email}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${tone.bg} ${tone.text} shrink-0`}>
          <span className={`w-1.5 h-1.5 rounded-full ${tone.dot} ${status === 'pending' ? 'animate-pulse' : ''}`} />
          {status === 'active' ? 'Active' : status === 'suspended' ? 'Suspended' : 'Pending'}
        </span>
      </div>

      {/* Row 2: role chips + type badge */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${roleColour}`}>
          {user.role}
        </span>
        <span className="text-[10px] font-medium text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
          {typeLabel}
        </span>
        {roleChips.map((chip) => (
          <span key={chip} className="text-[10px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
            {chip}
          </span>
        ))}
        {overflow > 0 && (
          <span className="text-[10px] font-medium bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
            +{overflow}
          </span>
        )}
        {user.mfaEnabled && (
          <span title="MFA enabled" className="text-emerald-600">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14a1 1 0 11-2 0 1 1 0 012 0zm0-7a1 1 0 10-2 0v3a1 1 0 102 0V7z" clipRule="evenodd" />
            </svg>
          </span>
        )}
      </div>

      {/* Row 3: last seen */}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-slate-400">Last login: {relativeTime(user.lastLogin)}</span>
      </div>
    </button>
  );
}

// ── Kebab menu actions (used inside drawer) ────────────────────────────────

type UserAction = 'suspend' | 'reactivate' | 'revoke' | 'reset-password' | 'copy-id';

type UserActionMenuProps = {
  user: UserRecord;
  onAction: (action: UserAction) => void;
};

export function UserActionMenu({ user, onAction }: UserActionMenuProps) {
  const [open, setOpen] = useState(false);
  const status = deriveUserStatus(user);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-700"
        title="User actions"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-8 w-44 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1 text-sm">
          {status === 'active' && (
            <button
              className="w-full text-left px-4 py-2 hover:bg-amber-50 text-amber-700 transition-colors"
              onClick={() => { setOpen(false); onAction('suspend'); }}
            >Suspend</button>
          )}
          {status === 'suspended' && (
            <button
              className="w-full text-left px-4 py-2 hover:bg-emerald-50 text-emerald-700 transition-colors"
              onClick={() => { setOpen(false); onAction('reactivate'); }}
            >Reactivate</button>
          )}
          <button
            className="w-full text-left px-4 py-2 hover:bg-slate-50 text-slate-700 transition-colors"
            onClick={() => { setOpen(false); onAction('revoke'); }}
          >Revoke All Sessions</button>
          <button
            className="w-full text-left px-4 py-2 hover:bg-slate-50 text-slate-700 transition-colors"
            onClick={() => { setOpen(false); onAction('reset-password'); }}
          >Send Password Reset</button>
          <div className="border-t border-slate-100 my-1" />
          <button
            className="w-full text-left px-4 py-2 hover:bg-slate-50 text-slate-400 text-xs transition-colors"
            onClick={() => { setOpen(false); navigator.clipboard.writeText(user.id); onAction('copy-id'); }}
          >Copy User ID</button>
        </div>
      )}
    </div>
  );
}

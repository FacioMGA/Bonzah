import React from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/src/shared/ui';
import type { AppUser } from '@/src/shared/types/session';

type ClientAccountMenuProps = {
  user: AppUser;
  onLogout: () => void;
};

export function ClientAccountMenu({ user, onLogout }: ClientAccountMenuProps) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const userInitial = String(user.name || 'U').charAt(0).toUpperCase();

  React.useEffect(() => {
    if (!isOpen) return undefined;
    const onDocMouseDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={menuRef}>
      <Button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        variant="ghost"
        size="sm"
        className="group flex items-center gap-3 p-0 bg-transparent hover:bg-transparent active:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-primary rounded-xl"
      >
        <div className="text-right hidden sm:block">
          <div className="text-sm font-black text-white leading-none group-hover:text-sky-100 transition-colors">
            {user.name || 'User'}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-blue-100 font-black">
            Account
          </div>
        </div>
        <div className="h-10 w-10 rounded-full border border-white/70 bg-white/15 text-white font-black flex items-center justify-center shadow-sm backdrop-blur-[1px] transition-all">
          {userInitial}
        </div>
      </Button>
      {isOpen && (
        <div
          role="menu"
          aria-label="Account menu"
          className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-2xl border border-slate-100 py-2 z-50"
        >
          <div className="px-4 py-3 border-b border-slate-100">
            <div className="text-sm font-black text-slate-900 truncate">{user.name || 'User'}</div>
            <div className="text-[11px] text-slate-500 font-medium truncate">Account</div>
          </div>
          <Button
            type="button"
            onClick={() => {
              setIsOpen(false);
              navigate('/client/account');
            }}
            variant="ghost"
            size="sm"
            className="w-full justify-start text-left rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 bg-transparent"
          >
            My Profile
          </Button>
          <Button
            type="button"
            onClick={() => {
              setIsOpen(false);
              onLogout();
            }}
            variant="ghost"
            size="sm"
            className="w-full justify-start text-left rounded-xl px-3 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 bg-transparent"
          >
            Logout
          </Button>
        </div>
      )}
    </div>
  );
}

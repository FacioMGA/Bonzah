import { TenantBrand } from '@/src/shared/lib/tenant/TenantBrand';
import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { canAccessConfigureMode } from '@/src/modules/auth/session';
import {
  CONFIGURE_NAV_SECTIONS,
  OPERATE_NAV_ITEMS,
  WORKSPACE_SETTINGS_ENTRY,
  isNavItemActive,
} from '@/src/surfaces/bo/navigation';
import { useBoMode } from '@/src/surfaces/bo/mode';
import type { AppUser } from '@/src/shared/types/session';

interface SidebarProps {
  user?: AppUser | null;
}

const Sidebar: React.FC<SidebarProps> = ({ user }) => {
  const { pathname } = useLocation();
  const { mode } = useBoMode();
  const canConfigure = canAccessConfigureMode(user);

  const renderNavLink = (item: { name: string; path: string; icon?: string; matchPrefix?: string }, emphasis: 'operate' | 'configure' | 'ghost' = 'operate') => {
    const active = isNavItemActive(pathname, item);
    const baseClass = emphasis === 'configure'
      ? active
        ? 'bg-violet-600 text-white shadow-xl shadow-violet-900/40'
        : 'text-slate-300 hover:bg-white/5 hover:text-white'
      : emphasis === 'ghost'
        ? active
          ? 'bg-white/10 text-white'
          : 'text-slate-300 hover:bg-white/5 hover:text-white'
        : active
          ? 'bg-brand-primary text-white shadow-xl shadow-black/30'
          : 'text-slate-400 hover:bg-brand-dark/40 hover:text-slate-200';

    return (
      <NavLink
        key={item.name}
        to={item.path}
        className={`flex items-center px-5 py-3.5 rounded-2xl text-[15px] font-bold tracking-tight transition-all duration-300 ${baseClass}`}
      >
        {item.icon && (
          <svg className="mr-4 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
          </svg>
        )}
        {item.name}
      </NavLink>
    );
  };

  return (
    <aside className={`w-72 flex flex-col h-screen sticky top-0 shrink-0 shadow-2xl z-40 overflow-y-auto border-r ${
      mode === 'configure'
        ? 'bg-slate-950 border-slate-800'
        : 'bg-brand-deep border-brand-dark/30'
    }`}>
      <NavLink to="/" className="px-8 py-10 pb-6 flex items-center" aria-label="Go to dashboard" title="Dashboard">
        <TenantBrand inverse className="h-16 w-auto" />
      </NavLink>

      <div className="flex flex-1 flex-col px-4 pb-6">
        <nav className="flex-1 space-y-3 mt-2">
          {mode === 'configure' ? (
            <div className="space-y-6">
              {CONFIGURE_NAV_SECTIONS.map((section) => (
                <section key={section.title} className="space-y-2">
                  <div className="px-2 text-[11px] font-black uppercase tracking-widest text-slate-500">
                    {section.title}
                  </div>
                  <div className="space-y-2">
                    {section.items.map((item) => renderNavLink(item, 'configure'))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            OPERATE_NAV_ITEMS.map((item) => renderNavLink(item, 'operate'))
          )}
        </nav>

        <div className="border-t border-white/10 pt-4">
          {mode === 'operate' && canConfigure && (
            renderNavLink(WORKSPACE_SETTINGS_ENTRY, 'ghost')
          )}
          {mode === 'configure' && (
            renderNavLink({ ...WORKSPACE_SETTINGS_ENTRY, name: 'Back to Operations', path: '/' }, 'ghost')
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;


import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/src/shared/ui';
import { canAccessConfigureMode } from '@/src/modules/auth/session';
import { useBoMode } from '@/src/surfaces/bo/mode';

interface User {
    name: string;
    role: string;
    email?: string;
}

interface ProfileMenuProps {
    user: User;
    onLogout: () => void;
}

const ProfileMenu: React.FC<ProfileMenuProps> = ({ user, onLogout }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();
    const { mode } = useBoMode();

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const internalRoles = ['ADMIN', 'UNDERWRITER', 'Program Administrator'];
    const canConfigure = canAccessConfigureMode(user);
    const isClientUser = !internalRoles.includes(user.role);

    return (
        <div className="relative" ref={dropdownRef}>
            <Button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                variant="ghost"
                size="sm"
                className="flex items-center space-x-4 focus:outline-none group"
            >
                <div className="flex flex-col items-end">
                    <span className="text-sm font-bold text-slate-800 leading-none group-hover:text-slate-600 transition-colors">
                        {user.name || 'User'}
                    </span>
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                        {user.role || 'Member'}
                    </span>
                </div>
                <div className="w-10 h-10 rounded-full bg-slate-100 border-2 border-white shadow-sm flex items-center justify-center overflow-hidden hover:ring-2 hover:ring-slate-200 transition-all">
                    {user.name ? (
                        <div className="w-full h-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-lg">
                            {user.name.charAt(0).toUpperCase()}
                        </div>
                    ) : (
                        <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user.name || 'User'}`} alt="avatar" />
                    )}
                </div>
            </Button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-2xl border border-slate-100 py-2 z-50 transform origin-top-right transition-all">
                    <div className="px-4 py-3 border-b border-slate-100">
                        <p className="text-sm font-bold text-slate-900">{user.name}</p>
                        <p className="text-[11px] text-slate-500 font-medium truncate">{user.email || user.role}</p>
                    </div>

                    <div className="py-1">
                        {isClientUser && (
                            <Button
                                type="button"
                                onClick={() => {
                                    setIsOpen(false);
                                    navigate('/client');
                                }}
                                variant="ghost"
                                size="sm"
                                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center space-x-2 font-medium"
                            >
                                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                                </svg>
                                <span>Client portal</span>
                            </Button>
                        )}
                        {canConfigure && (
                            <Button
                                type="button"
                                onClick={() => {
                                    setIsOpen(false);
                                    navigate(mode === 'configure' ? '/' : '/configure/users');
                                }}
                                variant="ghost"
                                size="sm"
                                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center space-x-2 font-medium"
                            >
                                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                <span>{mode === 'configure' ? 'Back to Operations' : 'Workspace Settings'}</span>
                            </Button>
                        )}

                        <Button
                            type="button"
                            onClick={() => {
                                setIsOpen(false);
                                navigate('/personnel-file');
                            }}
                            variant="ghost"
                            size="sm"
                            className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center space-x-2 font-medium"
                        >
                            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A8.966 8.966 0 0112 15c2.21 0 4.236.8 5.804 2.121M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <span>My Profile / HR</span>
                        </Button>

                        <Button
                            type="button"
                            onClick={() => {
                                setIsOpen(false);
                                navigate('/change-password');
                            }}
                            variant="ghost"
                            size="sm"
                            className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center space-x-2 font-medium"
                        >
                            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c1.105 0 2-.895 2-2V7a2 2 0 10-4 0v2c0 1.105.895 2 2 2zm6 0H6a2 2 0 00-2 2v5a2 2 0 002 2h12a2 2 0 002-2v-5a2 2 0 00-2-2z" />
                            </svg>
                            <span>Change Password</span>
                        </Button>

                        <Button
                            type="button"
                            onClick={() => {
                                setIsOpen(false);
                                onLogout();
                            }}
                            variant="ghost"
                            size="sm"
                            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center space-x-2 font-medium"
                        >
                            <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                            </svg>
                            <span>Logout</span>
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProfileMenu;

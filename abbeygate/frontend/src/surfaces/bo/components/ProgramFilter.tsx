import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { boClient as api } from '@/src/surfaces/bo/api/boClient';
import { Filter, ChevronDown, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Button } from '@/src/shared/ui';

interface ProgramFilterProps {
    value: string | null;
    onChange: (programId: string | null) => void;
}

type ProgramOption = {
    id: string;
    name: string;
};

function toProgramOption(value: unknown): ProgramOption | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const name = typeof record.name === 'string' ? record.name : '';
    if (!id || !name) return null;
    return { id, name };
}

export const ProgramFilter: React.FC<ProgramFilterProps> = ({ value, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    const { data: programs = [], isLoading } = useQuery<ProgramOption[]>({
        queryKey: ['programs', 'list'],
        queryFn: async () => {
            const res = await api.listPrograms();
            if (!res.success || !Array.isArray(res.data)) return [];
            return res.data.map(toProgramOption).filter((program): program is ProgramOption => Boolean(program));
        },
        staleTime: 5 * 60 * 1000,
    });

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedProgram = programs.find((p) => p.id === value);

    return (
        <div className="relative" ref={containerRef}>
            <motion.div
                whileTap={{ scale: 0.98 }}
            >
                <Button
                    type="button"
                    onClick={() => setIsOpen(!isOpen)}
                    variant="secondary"
                    size="md"
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl hover:border-slate-300 hover:bg-slate-50 transition shadow-sm text-sm font-semibold text-slate-700"
                >
                    <Filter className="w-4 h-4 text-slate-400" />
                    <span>{selectedProgram ? selectedProgram.name : 'All Programs'}</span>
                    <ChevronDown className={twMerge("w-4 h-4 text-slate-400 transition-transform", isOpen && "rotate-180")} />
                </Button>
            </motion.div>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.95 }}
                        transition={{ duration: 0.1 }}
                        className="absolute left-0 top-full mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden z-50 origin-top-left"
                    >
                        <div className="p-2 space-y-1 max-h-80 overflow-y-auto">
                            <Button
                                type="button"
                                onClick={() => {
                                    onChange(null);
                                    setIsOpen(false);
                                }}
                                variant="ghost"
                                size="sm"
                                className={clsx(
                                    "w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center justify-between group",
                                    !value ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                )}
                            >
                                <span>All Programs</span>
                                {!value && <Check className="w-4 h-4 text-brand-primary" />}
                            </Button>

                            <div className="h-px bg-slate-100 my-1" />

                            {isLoading ? (
                                <div className="px-3 py-2 text-xs text-slate-400">Loading programs...</div>
                            ) : (
                                programs.map((program) => (
                                    <Button
                                        type="button"
                                        key={program.id}
                                        onClick={() => {
                                            onChange(program.id);
                                            setIsOpen(false);
                                        }}
                                        variant="ghost"
                                        size="sm"
                                        className={clsx(
                                            "w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center justify-between",
                                            value === program.id ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                        )}
                                    >
                                        <span className="truncate">{program.name}</span>
                                        {value === program.id && <Check className="w-4 h-4 text-brand-primary" />}
                                    </Button>
                                ))
                            )}

                            {programs.length === 0 && !isLoading && (
                                <div className="px-3 py-2 text-xs text-slate-400">No programs found.</div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

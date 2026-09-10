import React from 'react';
import { Button } from '@/src/shared/ui';
import { Select } from '@/src/shared/ui';
import { Textarea } from '@/src/shared/ui';

interface FollowUpDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    activeContextLabel: string;
    followUpNote: string;
    setFollowUpNote: (v: string) => void;
    followUpType: string;
    setFollowUpType: (v: string) => void;
    onAddToBatch: () => void;
}

export function FollowUpDrawer({
    isOpen,
    onClose,
    activeContextLabel,
    followUpNote,
    setFollowUpNote,
    followUpType,
    setFollowUpType,
    onAddToBatch,
}: FollowUpDrawerProps) {
    if (!isOpen) return null;

    return (
        <>
            <div className="fixed inset-0 bg-brand-primary-deep/40 backdrop-blur-sm z-[60]" onClick={onClose}></div>
            <div className="fixed top-0 right-0 h-full w-[450px] bg-white shadow-[-20px_0_50px_rgba(0,0,0,0.1)] z-[70] animate-in slide-in-from-right duration-300 p-10 flex flex-col">
                <div className="flex items-center justify-between mb-10">
                    <h3 className="text-2xl font-black text-slate-800 tracking-tighter">Add Follow-up</h3>
                    <Button type="button" variant="link" size="none" onClick={onClose} className="text-slate-400 hover:text-slate-800">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                    </Button>
                </div>

                <div className="space-y-8 flex-1">
                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Context (Parent Question)</label>
                        <p className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-sm font-bold text-slate-600 italic">
                            "{activeContextLabel}"
                        </p>
                    </div>

                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Follow-up Type</label>
                        <Select
                            value={followUpType}
                            onChange={(e) => setFollowUpType(e.target.value)}
                            className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-4 font-bold text-slate-800 focus:border-brand-primary outline-none transition-all"
                        >
                            <option>Ask for more detail</option>
                            <option>Resolve inconsistency</option>
                            <option>Evidence required (Upload)</option>
                            <option>Conditional question set</option>
                        </Select>
                    </div>

                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Question Content</label>
                        <Textarea
                            rows={4}
                            value={followUpNote}
                            onChange={(e) => setFollowUpNote(e.target.value)}
                            placeholder="E.g. Please provide a breakdown of income by geographic region..."
                            className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-4 font-bold text-slate-800 focus:border-brand-primary outline-none transition-all resize-none"
                        />
                    </div>
                </div>

                <div className="pt-10 space-y-3">
                    <Button
                        type="button"
                        variant="primary"
                        size="md"
                        onClick={onAddToBatch}
                        className="w-full bg-brand-primary text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-brand-primary/20 hover:bg-brand-primary-dark transition-all"
                    >
                        Add to Request Batch
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="md"
                        onClick={onClose}
                        className="w-full bg-white border-2 border-slate-100 text-slate-400 py-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:border-slate-300 transition-all bg-transparent"
                    >
                        Cancel
                    </Button>
                </div>
            </div>
        </>
    );
}
